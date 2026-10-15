BEGIN;

-- Read-only assessment shared by the command and reloadable contract evidence.
-- No historical rows are reconciled by this migration.
CREATE FUNCTION app.contract_end_release_assessment(p_tenant uuid,p_contract uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE c contracts%ROWTYPE;s sales_cases%ROWTYPE;u units%ROWTYPE;reasons jsonb:='[]';
BEGIN
  SELECT * INTO c FROM contracts WHERE tenant_id=p_tenant AND id=p_contract;
  IF c.id IS NULL THEN RETURN NULL;END IF;
  IF c.contract_type NOT IN ('rs','sbk','ks') OR c.current_status NOT IN ('cancelled','terminated') THEN RETURN NULL;END IF;
  SELECT * INTO s FROM sales_cases WHERE tenant_id=p_tenant AND id=c.sales_case_id;
  SELECT * INTO u FROM units WHERE tenant_id=p_tenant AND id=c.unit_id;
  IF s.id IS NULL OR u.id IS NULL OR s.project_id<>c.project_id OR s.unit_id<>c.unit_id THEN
    reasons:=reasons||jsonb_build_array(jsonb_build_object('code','INVALID_CONTEXT','message','Obchodní vazby nejsou úplné. Kontaktujte administrátora.'));
  END IF;
  IF s.status IS DISTINCT FROM 'active' THEN
    reasons:=reasons||jsonb_build_array(jsonb_build_object('code','HISTORICAL_CASE','message','Obchod již není aktivní. Historické případy je nutné vypořádat samostatně s administrátorem.'));
  END IF;
  IF c.ended_at IS NULL OR c.ended_at>now() THEN
    reasons:=reasons||jsonb_build_array(jsonb_build_object('code','NOT_EFFECTIVE','message','Ukončení smlouvy dosud nenabylo účinnosti. Vyčkejte na účinné ukončení.'));
  END IF;
  IF EXISTS(SELECT 1 FROM contracts other WHERE other.tenant_id=p_tenant AND other.unit_id=c.unit_id AND other.id<>c.id
    AND other.current_status NOT IN ('cancelled','terminated')) THEN
    reasons:=reasons||jsonb_build_array(jsonb_build_object('code','OTHER_CONTRACT','message','Jednotka má další platnou nebo rozpracovanou smlouvu. Nejprve vyřešte její další trvání.'));
  END IF;
  -- Native model has no cadastral/ownership clearance evidence. Never infer it from cancellation.
  IF u.commercial_status IN ('sold','handed_over') OR EXISTS(
    SELECT 1 FROM contracts k WHERE k.tenant_id=p_tenant AND k.unit_id=c.unit_id AND k.contract_type='ks'
    AND (k.signed_at IS NOT NULL OR EXISTS(SELECT 1 FROM contract_versions v WHERE v.tenant_id=k.tenant_id AND v.contract_id=k.id AND v.signed_at IS NOT NULL))) THEN
    reasons:=reasons||jsonb_build_array(jsonb_build_object('code','OWNERSHIP_UNVERIFIED','message','Nelze ověřit možnost dalšího prodeje po kupní smlouvě nebo převodu vlastnictví. Administrátor musí nejprve doložit právní stav; automatické uvolnění není dostupné.'));
  END IF;
  IF u.commercial_status='blocked' THEN
    reasons:=reasons||jsonb_build_array(jsonb_build_object('code','UNIT_BLOCKED','message','Jednotka je samostatně blokovaná. Nejprve prověřte a vyřešte důvod blokace.'));
  END IF;
  IF EXISTS(SELECT 1 FROM unit_handovers h WHERE h.tenant_id=p_tenant AND h.unit_id=c.unit_id AND h.status<>'cancelled') THEN
    reasons:=reasons||jsonb_build_array(jsonb_build_object('code','HANDOVER_EXISTS','message','Jednotka má naplánované nebo dokončené předání. Nejprve prověřte předání a právní stav.'));
  END IF;
  IF EXISTS(SELECT 1 FROM sales_cases other WHERE other.tenant_id=p_tenant AND other.unit_id=c.unit_id AND other.id<>c.sales_case_id AND other.status='active') THEN
    reasons:=reasons||jsonb_build_array(jsonb_build_object('code','OTHER_CASE','message','Jednotka má jiný aktivní obchod. Nejprve prověřte souběžné obchodní případy.'));
  END IF;
  IF EXISTS(SELECT 1 FROM unit_holds h WHERE h.tenant_id=p_tenant AND h.unit_id=c.unit_id AND h.status='active'
    AND NOT (h.sales_case_id=c.sales_case_id AND h.hold_type='reservation' AND EXISTS(
      SELECT 1 FROM contracts r WHERE r.tenant_id=p_tenant AND r.sales_case_id=c.sales_case_id AND r.contract_type='rs'
      AND r.current_status IN ('cancelled','terminated') AND r.ended_at<=now() AND h.idempotency_key='signed-rs-reservation:'||r.id))) THEN
    reasons:=reasons||jsonb_build_array(jsonb_build_object('code','OTHER_HOLD','message','Jednotku chrání další blokace nebo předrezervace. Nejprve ověřte její oprávněnost a případně ji samostatně ukončete.'));
  END IF;
  IF NOT EXISTS(SELECT 1 FROM contracts b JOIN contract_versions v ON v.tenant_id=b.tenant_id AND v.contract_id=b.id
    WHERE b.tenant_id=p_tenant AND b.sales_case_id=c.sales_case_id AND b.contract_type IN ('rs','sbk','ks') AND v.signed_at IS NOT NULL) THEN
    reasons:=reasons||jsonb_build_array(jsonb_build_object('code','NO_SIGNED_COMMITMENT','message','Zrušení rozpracované smlouvy neukončuje obchod. Pokračujte u jednotky v aktivním jednání.'));
  END IF;
  RETURN jsonb_build_object('state',CASE WHEN jsonb_array_length(reasons)>0 THEN 'blocked' ELSE 'eligible' END,'reasons',reasons,'salesCaseId',c.sales_case_id,'unitId',c.unit_id);
END $$;

CREATE OR REPLACE FUNCTION app.transition_unit_commercial_status(
  p_tenant_id uuid,p_unit_id uuid,p_to_status text,p_command text,p_reason text,p_actor_membership_id uuid
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE old_unit_status text;project uuid;actor uuid;event_id uuid:=gen_random_uuid();allowed boolean:=false;
BEGIN
  SELECT commercial_status,project_id INTO old_unit_status,project FROM units WHERE tenant_id=p_tenant_id AND id=p_unit_id FOR UPDATE;
  SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant_id AND id=p_actor_membership_id AND status='active';
  IF old_unit_status IS NULL OR actor IS NULL THEN RAISE EXCEPTION 'unit or active actor membership not found';END IF;
  allowed:=CASE p_command
    WHEN 'createPreReservation' THEN old_unit_status='available' AND p_to_status='pre_reserved' AND EXISTS(SELECT 1 FROM unit_holds WHERE tenant_id=p_tenant_id AND unit_id=p_unit_id AND status='active' AND hold_type='pre_reservation' AND starts_at<=now() AND expires_at>now())
    WHEN 'createReservation' THEN old_unit_status='available' AND p_to_status='reserved' AND EXISTS(SELECT 1 FROM unit_holds WHERE tenant_id=p_tenant_id AND unit_id=p_unit_id AND status='active' AND hold_type='reservation' AND starts_at<=now() AND expires_at>now())
    WHEN 'confirmReservation' THEN old_unit_status='pre_reserved' AND p_to_status='reserved' AND EXISTS(SELECT 1 FROM unit_holds WHERE tenant_id=p_tenant_id AND unit_id=p_unit_id AND status='active' AND hold_type='reservation' AND starts_at<=now() AND expires_at>now())
    WHEN 'expireHold' THEN old_unit_status IN ('pre_reserved','reserved') AND p_to_status='available' AND NOT EXISTS(SELECT 1 FROM unit_holds WHERE tenant_id=p_tenant_id AND unit_id=p_unit_id AND status='active' AND starts_at<=now() AND expires_at>now())
    WHEN 'cancelPreReservation' THEN old_unit_status='pre_reserved' AND p_to_status='available' AND NOT EXISTS(SELECT 1 FROM unit_holds WHERE tenant_id=p_tenant_id AND unit_id=p_unit_id AND status='active' AND starts_at<=now() AND expires_at>now())
    WHEN 'cancelReservation' THEN old_unit_status='reserved' AND p_to_status='available' AND NOT EXISTS(SELECT 1 FROM unit_holds WHERE tenant_id=p_tenant_id AND unit_id=p_unit_id AND status='active' AND starts_at<=now() AND expires_at>now())
    WHEN 'activateFuturePurchaseContract' THEN old_unit_status IN ('available','pre_reserved','reserved') AND p_to_status='contracted' AND EXISTS(SELECT 1 FROM contracts contract WHERE contract.tenant_id=p_tenant_id AND contract.unit_id=p_unit_id AND contract.contract_type='sbk' AND contract.current_status='signed')
    WHEN 'confirmFinalContractEffective' THEN old_unit_status IN ('available','pre_reserved','reserved','contracted') AND p_to_status='sold' AND EXISTS(SELECT 1 FROM contracts contract WHERE contract.tenant_id=p_tenant_id AND contract.unit_id=p_unit_id AND contract.contract_type='ks' AND contract.current_status='signed')
    WHEN 'blockUnit' THEN old_unit_status IN ('available','pre_reserved','reserved') AND p_to_status='blocked' AND NOT EXISTS(SELECT 1 FROM unit_holds WHERE tenant_id=p_tenant_id AND unit_id=p_unit_id AND status='active' AND starts_at<=now() AND expires_at>now())
    WHEN 'unblockUnit' THEN old_unit_status='blocked' AND p_to_status='available'
    WHEN 'compensateContract' THEN old_unit_status IN ('pre_reserved','reserved','contracted') AND p_to_status='available'
      AND app.has_project_permission(p_tenant_id,p_actor_membership_id,project,'contract.manage')
      AND NOT app.has_effective_signed_contract(p_tenant_id,p_unit_id)
      AND NOT EXISTS(SELECT 1 FROM contracts WHERE tenant_id=p_tenant_id AND unit_id=p_unit_id AND current_status NOT IN ('cancelled','terminated'))
      AND NOT EXISTS(SELECT 1 FROM sales_cases WHERE tenant_id=p_tenant_id AND unit_id=p_unit_id AND status='active')
      AND NOT EXISTS(SELECT 1 FROM unit_holds WHERE tenant_id=p_tenant_id AND unit_id=p_unit_id AND status='active')
      AND EXISTS(SELECT 1 FROM sales_cases WHERE tenant_id=p_tenant_id AND unit_id=p_unit_id AND status='cancelled' AND closed_at IS NOT NULL)
      AND NOT EXISTS(SELECT 1 FROM contracts k WHERE k.tenant_id=p_tenant_id AND k.unit_id=p_unit_id AND k.contract_type='ks' AND (k.signed_at IS NOT NULL OR EXISTS(SELECT 1 FROM contract_versions v WHERE v.tenant_id=k.tenant_id AND v.contract_id=k.id AND v.signed_at IS NOT NULL)))
    ELSE false END;
  IF NOT allowed THEN RAISE EXCEPTION 'commercial status command % violates source invariants',p_command;END IF;
  PERFORM set_config('app.commercial_status_command','on',true);
  UPDATE units SET commercial_status=p_to_status WHERE tenant_id=p_tenant_id AND id=p_unit_id;
  INSERT INTO unit_commercial_status_events(id,tenant_id,project_id,unit_id,from_status,to_status,command,reason,recorded_by_membership_id)
  VALUES(event_id,p_tenant_id,project,p_unit_id,old_unit_status,p_to_status,p_command,p_reason,p_actor_membership_id);
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data)
  VALUES(p_tenant_id,actor,'unit.commercial_status_changed','unit',p_unit_id,jsonb_build_object('commercialStatus',old_unit_status),jsonb_build_object('commercialStatus',p_to_status,'command',p_command));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant_id,'unit',p_unit_id,'unit.commercial_status_changed.v1',jsonb_build_object('unitId',p_unit_id,'from',old_unit_status,'to',p_to_status,'command',p_command));
  RETURN event_id;
END $$;

CREATE OR REPLACE FUNCTION app.transition_contract_status(
  p_tenant uuid,p_contract uuid,p_to text,p_reason text,p_actor_membership uuid
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE old_state text;project uuid;actor uuid;event_id uuid:=gen_random_uuid();allowed boolean:=false;required_permission text:='contract.manage';latest_version uuid;contract_type text;reason_text text:=COALESCE(NULLIF(btrim(p_reason),''),'Změna stavu smlouvy');
BEGIN
  PERFORM app.lock_workflow_unit(p_tenant,(SELECT unit_id FROM contracts WHERE tenant_id=p_tenant AND id=p_contract));
  SELECT current_status,project_id,contracts.contract_type INTO old_state,project,contract_type FROM contracts WHERE tenant_id=p_tenant AND id=p_contract FOR UPDATE;
  SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF old_state IS NULL OR actor IS NULL THEN RAISE EXCEPTION 'contract or actor not found';END IF;
  IF p_to='signed' THEN RAISE EXCEPTION 'signed status is reached only by the signature command';END IF;
  IF p_to='signing' THEN RAISE EXCEPTION 'signing is no longer a workflow status';END IF;
  allowed:=CASE old_state
    WHEN 'draft' THEN p_to IN ('sent','cancelled')
    WHEN 'sent' THEN p_to IN ('negotiation','approved','cancelled')
    WHEN 'negotiation' THEN p_to IN ('sent','approved','cancelled')
    WHEN 'approved' THEN p_to IN ('negotiation','cancelled')
    WHEN 'signing' THEN p_to IN ('approved','negotiation','cancelled')
    WHEN 'signed' THEN p_to IN ('cancelled','terminated')
    ELSE false END;
  IF NOT allowed THEN RAISE EXCEPTION 'contract workflow transition is not allowed';END IF;
  IF p_to='approved' THEN required_permission:='contract.approve';END IF;
  IF NOT app.has_project_permission(p_tenant,p_actor_membership,project,required_permission) THEN RAISE EXCEPTION '% permission required',required_permission;END IF;
  SELECT id INTO latest_version FROM contract_versions WHERE tenant_id=p_tenant AND contract_id=p_contract ORDER BY version_number DESC,id DESC LIMIT 1;
  IF p_to='approved' AND latest_version IS NULL THEN RAISE EXCEPTION 'contract requires a logical version';END IF;
  IF p_to='approved' THEN UPDATE contract_versions SET version_status='approved_for_signing',approved_at=COALESCE(approved_at,now()) WHERE tenant_id=p_tenant AND id=latest_version AND version_status='working';END IF;
  PERFORM set_config('app.contract_status_command','on',true);
  UPDATE contracts SET current_status=p_to,ended_at=CASE WHEN p_to IN ('cancelled','terminated') THEN now() ELSE NULL END,
    end_reason=CASE WHEN p_to IN ('cancelled','terminated') THEN reason_text ELSE NULL END WHERE tenant_id=p_tenant AND id=p_contract;
  INSERT INTO contract_status_events(id,tenant_id,project_id,contract_id,from_status,to_status,command,reason,recorded_by_membership_id)
  VALUES(event_id,p_tenant,project,p_contract,old_state,p_to,CASE p_to WHEN 'terminated' THEN 'terminateContract' WHEN 'cancelled' THEN 'cancelContract' ELSE 'transitionContract' END,reason_text,p_actor_membership);
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data)
  VALUES(p_tenant,actor,'contract.status_changed','contract',p_contract,jsonb_build_object('status',old_state),jsonb_build_object('status',p_to,'reason',reason_text));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'contract',p_contract,'contract.status_changed.v1',jsonb_build_object('contractId',p_contract,'from',old_state,'to',p_to));
  IF contract_type IN ('rs','sbk','ks') AND p_to IN ('cancelled','terminated') THEN PERFORM app.synchronize_ended_contract(p_tenant,p_contract,p_actor_membership,reason_text);END IF;
  RETURN event_id;
END $$;




CREATE FUNCTION app.synchronize_ended_contract(p_tenant uuid,p_contract uuid,p_actor_membership uuid,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE c contracts%ROWTYPE;assessment jsonb;h record;actor uuid;previous_stage text;
BEGIN
  PERFORM app.lock_workflow_unit(p_tenant,(SELECT unit_id FROM contracts WHERE tenant_id=p_tenant AND id=p_contract));
  SELECT * INTO c FROM contracts WHERE tenant_id=p_tenant AND id=p_contract FOR UPDATE;
  IF c.id IS NULL OR c.contract_type NOT IN ('rs','sbk','ks') OR c.current_status NOT IN ('cancelled','terminated') THEN RETURN;END IF;
  SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF actor IS NULL OR NOT app.has_project_permission(p_tenant,p_actor_membership,c.project_id,'contract.manage') THEN RAISE EXCEPTION 'contract.manage permission required';END IF;
  PERFORM 1 FROM sales_cases WHERE tenant_id=p_tenant AND id=c.sales_case_id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM outbox_events WHERE tenant_id=p_tenant AND aggregate_id=p_contract AND event_type='contract.end_reconciled.v1') THEN RETURN;END IF;
  assessment:=app.contract_end_release_assessment(p_tenant,p_contract);
  IF assessment->>'state'='eligible' THEN
    FOR h IN SELECT * FROM unit_holds WHERE tenant_id=p_tenant AND unit_id=c.unit_id AND sales_case_id=c.sales_case_id AND status='active' FOR UPDATE LOOP
      UPDATE unit_holds SET status='cancelled',ended_at=now() WHERE tenant_id=p_tenant AND id=h.id;
      INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data,metadata)
      VALUES(p_tenant,actor,'hold.ended_by_contract','unit_hold',h.id,jsonb_build_object('status','cancelled'),jsonb_build_object('contractId',p_contract,'projectId',c.project_id));
      INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
      VALUES(p_tenant,'hold',h.id,'hold.ended_by_contract.v1',jsonb_build_object('contractId',p_contract,'unitId',c.unit_id));
    END LOOP;
    SELECT current_stage INTO previous_stage FROM sales_cases WHERE tenant_id=p_tenant AND id=c.sales_case_id;
    PERFORM app.record_sales_stage(p_tenant,c.sales_case_id,'interest','endContract',p_reason,p_actor_membership);
    UPDATE sales_case_parties SET left_at=now(),is_primary=false WHERE tenant_id=p_tenant AND sales_case_id=c.sales_case_id AND left_at IS NULL;
    UPDATE sales_cases SET status='cancelled',closed_at=now(),close_reason=p_reason,updated_at=now() WHERE tenant_id=p_tenant AND id=c.sales_case_id AND status='active';
    IF (SELECT commercial_status FROM units WHERE tenant_id=p_tenant AND id=c.unit_id)<>'available' THEN
      PERFORM app.transition_unit_commercial_status(p_tenant,c.unit_id,'available','compensateContract',p_reason,p_actor_membership);
    END IF;
    assessment:=jsonb_set(assessment,'{state}','"released"');
    INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data,metadata)
    VALUES(p_tenant,actor,'sales_case.ended_by_contract','sales_case',c.sales_case_id,jsonb_build_object('stage',previous_stage),assessment,jsonb_build_object('projectId',c.project_id,'contractId',p_contract));
    INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
    VALUES(p_tenant,'sales_case',c.sales_case_id,'sales_case.ended_by_contract.v1',assessment||jsonb_build_object('contractId',p_contract));
  END IF;
  -- Financial records are deliberately untouched, including unpaid obligations.
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data,metadata)
  VALUES(p_tenant,actor,'contract.end_reconciled','contract',p_contract,assessment,jsonb_build_object('projectId',c.project_id,'reason',p_reason));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'contract',p_contract,'contract.end_reconciled.v1',assessment);
END $$;

-- Keep the legacy entry point safe for existing callers. No payment cancellation.
CREATE OR REPLACE FUNCTION app.rollback_ended_rs(p_tenant uuid,p_contract uuid,p_actor_membership uuid,p_reason text)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  PERFORM app.synchronize_ended_contract(p_tenant,p_contract,p_actor_membership,p_reason);
END $$;

GRANT EXECUTE ON FUNCTION app.contract_end_release_assessment(uuid,uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.synchronize_ended_contract(uuid,uuid,uuid,text) TO develocrm_app;
CREATE OR REPLACE FUNCTION app.transition_contract_status_with_refund_decisions(
  p_tenant uuid,p_contract uuid,p_to text,p_reason text,p_refund_decisions jsonb,p_idempotency_key text,p_actor_membership uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,app AS $$
DECLARE contract_row contracts%ROWTYPE;command_id uuid;event_id uuid;paid_count integer;covered_count integer;item jsonb;obligation payment_obligations%ROWTYPE;paid numeric;decision_text text;decision_amount numeric;decision_id uuid;actor uuid;
BEGIN
  PERFORM app.lock_workflow_unit(p_tenant,(SELECT unit_id FROM contracts WHERE tenant_id=p_tenant AND id=p_contract));
  SELECT * INTO contract_row FROM contracts WHERE tenant_id=p_tenant AND id=p_contract FOR UPDATE;
  SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF contract_row.id IS NULL OR actor IS NULL THEN RAISE EXCEPTION 'contract or actor not found';END IF;
  IF p_to NOT IN ('cancelled','terminated') THEN RETURN app.transition_contract_status(p_tenant,p_contract,p_to,p_reason,p_actor_membership);END IF;
  IF NOT app.has_project_permission(p_tenant,p_actor_membership,contract_row.project_id,'contract.manage') THEN RAISE EXCEPTION 'contract.manage permission required';END IF;
  SELECT id INTO command_id FROM contract_cancellation_commands WHERE tenant_id=p_tenant AND idempotency_key=p_idempotency_key AND contract_id=p_contract AND target_status=p_to;
  IF command_id IS NOT NULL THEN RETURN command_id;END IF;
  IF contract_row.current_status=p_to AND p_to IN ('cancelled','terminated') THEN
    RETURN (SELECT id FROM contract_status_events WHERE tenant_id=p_tenant AND contract_id=p_contract AND to_status=p_to ORDER BY recorded_at DESC LIMIT 1);
  END IF;
  IF length(btrim(COALESCE(p_idempotency_key,'')))<8 THEN RAISE EXCEPTION 'cancellation idempotency key is required';END IF;
  SELECT count(*) INTO paid_count FROM payment_obligations candidate WHERE candidate.tenant_id=p_tenant AND candidate.contract_id=p_contract AND app.payment_obligation_paid(p_tenant,candidate.id)>0;
  SELECT count(DISTINCT candidate.id) INTO covered_count FROM payment_obligations candidate
    JOIN jsonb_array_elements(COALESCE(p_refund_decisions,'[]'::jsonb)) choice ON choice->>'obligationId'=candidate.id::text
    WHERE candidate.tenant_id=p_tenant AND candidate.contract_id=p_contract AND app.payment_obligation_paid(p_tenant,candidate.id)>0;
  IF covered_count<>paid_count THEN RAISE EXCEPTION 'explicit refund decision is required for every received payment';END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(p_refund_decisions,'[]'::jsonb)) LOOP
    SELECT * INTO obligation FROM payment_obligations WHERE tenant_id=p_tenant AND contract_id=p_contract AND id=(item->>'obligationId')::uuid FOR UPDATE;
    IF obligation.id IS NULL THEN RAISE EXCEPTION 'refund decision obligation must belong to the contract';END IF;
    paid:=app.payment_obligation_paid(p_tenant,obligation.id);decision_text:=item->>'decision';
    IF decision_text NOT IN ('none','partial','full') THEN RAISE EXCEPTION 'refund decision must be none, partial or full';END IF;
    decision_amount:=CASE decision_text WHEN 'none' THEN NULL WHEN 'full' THEN paid ELSE (item->>'amount')::numeric END;
    IF decision_text='partial' AND (decision_amount IS NULL OR decision_amount<=0 OR decision_amount>=paid) THEN RAISE EXCEPTION 'partial refund amount must be between zero and the received amount';END IF;
    INSERT INTO payment_refund_decisions(tenant_id,project_id,contract_id,obligation_id,decision,decided_amount,reason,idempotency_key,decided_by_membership_id)
    VALUES(p_tenant,contract_row.project_id,p_contract,obligation.id,decision_text,decision_amount,btrim(p_reason),p_idempotency_key||':'||obligation.id,p_actor_membership) RETURNING id INTO decision_id;
    INSERT INTO payment_events(tenant_id,project_id,obligation_id,event_type,payload,recorded_by_membership_id)
    VALUES(p_tenant,contract_row.project_id,obligation.id,'payment.refund_decided',jsonb_build_object('decisionId',decision_id,'decision',decision_text,'amount',COALESCE(decision_amount,0),'contractId',p_contract),p_actor_membership);
  END LOOP;
  event_id:=app.transition_contract_status(p_tenant,p_contract,p_to,p_reason,p_actor_membership);
  INSERT INTO contract_cancellation_commands(tenant_id,project_id,contract_id,target_status,idempotency_key,executed_by_membership_id)
  VALUES(p_tenant,contract_row.project_id,p_contract,p_to,btrim(p_idempotency_key),p_actor_membership) RETURNING id INTO command_id;
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data,metadata)
  VALUES(p_tenant,actor,'contract.refund_decisions_recorded','contract',p_contract,jsonb_build_object('decisions',COALESCE(p_refund_decisions,'[]'::jsonb)),jsonb_build_object('projectId',contract_row.project_id,'cancellationCommandId',command_id));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'contract',p_contract,'contract.refund_decisions_recorded.v1',jsonb_build_object('contractId',p_contract,'projectId',contract_row.project_id,'cancellationCommandId',command_id));
  RETURN command_id;
END $$;

CREATE OR REPLACE FUNCTION app.record_payment(
  p_tenant uuid,p_obligation uuid,p_amount numeric,p_paid_at timestamptz,p_variable_symbol text,p_account text,
  p_bank_transaction_id text,p_note text,p_idempotency_key text,p_actor_membership uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,app AS $$
DECLARE obligation payment_obligations%ROWTYPE;v_transaction_id uuid;actor uuid;unit_status text;old_hold uuid;remaining numeric;
BEGIN
  -- Same unit-first ordering as contract end; financial semantics are unchanged.
  PERFORM app.lock_workflow_unit(p_tenant,(SELECT unit_id FROM payment_obligations WHERE tenant_id=p_tenant AND id=p_obligation));
  SELECT * INTO obligation FROM payment_obligations WHERE tenant_id=p_tenant AND id=p_obligation FOR UPDATE;
  SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF obligation.id IS NULL THEN RAISE EXCEPTION 'payment obligation not found';END IF;
  IF obligation.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'cancelled payment obligation cannot be paid';END IF;
  IF p_amount IS NULL OR p_amount<=0 OR p_paid_at IS NULL THEN RAISE EXCEPTION 'positive amount and payment date required';END IF;
  IF actor IS NULL OR NOT (
    app.has_project_permission(p_tenant,p_actor_membership,obligation.project_id,'payments.record')
    OR app.has_project_permission(p_tenant,p_actor_membership,obligation.project_id,'payments.manage')
  ) THEN RAISE EXCEPTION 'payments.record permission required';END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_transaction_id FROM payment_transactions
      WHERE tenant_id=p_tenant AND idempotency_key=p_idempotency_key;
  END IF;
  IF v_transaction_id IS NULL AND p_bank_transaction_id IS NOT NULL THEN
    SELECT id INTO v_transaction_id FROM payment_transactions
      WHERE tenant_id=p_tenant AND bank_transaction_id=p_bank_transaction_id;
  END IF;
  IF v_transaction_id IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM payment_allocations allocation WHERE allocation.tenant_id=p_tenant AND allocation.transaction_id=v_transaction_id AND allocation.obligation_id=obligation.id) THEN
      RAISE EXCEPTION 'payment idempotency key belongs to another obligation';
    END IF;
    RETURN v_transaction_id;
  END IF;

  remaining:=obligation.amount-app.payment_obligation_paid(p_tenant,obligation.id);
  IF remaining<=0 THEN RAISE EXCEPTION 'payment obligation is already paid';END IF;
  IF p_amount>remaining THEN RAISE EXCEPTION 'payment amount exceeds remaining obligation amount';END IF;

  INSERT INTO payment_transactions(
    tenant_id,project_id,amount,paid_at,variable_symbol,counterparty_account,bank_transaction_id,note,
    source_type,idempotency_key,created_by_membership_id
  ) VALUES(
    p_tenant,obligation.project_id,p_amount,p_paid_at,p_variable_symbol,p_account,p_bank_transaction_id,p_note,
    CASE WHEN p_bank_transaction_id IS NULL THEN 'manual' ELSE 'bank_import' END,p_idempotency_key,p_actor_membership
  ) RETURNING id INTO v_transaction_id;
  INSERT INTO payment_allocations(tenant_id,project_id,obligation_id,transaction_id,amount,allocated_by_membership_id)
    VALUES(p_tenant,obligation.project_id,obligation.id,v_transaction_id,p_amount,p_actor_membership);
  INSERT INTO payment_events(tenant_id,project_id,obligation_id,transaction_id,event_type,payload,recorded_by_membership_id)
    VALUES(p_tenant,obligation.project_id,obligation.id,v_transaction_id,'payment.recorded',jsonb_build_object(
      'amount',p_amount,'source',CASE WHEN p_bank_transaction_id IS NULL THEN 'manual' ELSE 'bank_import' END,
      'status',app.payment_obligation_status(p_tenant,obligation.id,now())),p_actor_membership);
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data,metadata)
    VALUES(p_tenant,actor,'payment.recorded','payment_transaction',v_transaction_id,
      jsonb_build_object('obligationId',obligation.id,'amount',p_amount,'paidAt',p_paid_at,'source',CASE WHEN p_bank_transaction_id IS NULL THEN 'manual' ELSE 'bank_import' END),
      jsonb_build_object('projectId',obligation.project_id,'unitId',obligation.unit_id,'contractId',obligation.contract_id));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
    VALUES(p_tenant,'payment_transaction',v_transaction_id,'payment.recorded.v1',jsonb_build_object(
      'transactionId',v_transaction_id,'obligationId',obligation.id,'projectId',obligation.project_id,
      'unitId',obligation.unit_id,'amount',p_amount,'status',app.payment_obligation_status(p_tenant,obligation.id,now())));

  IF obligation.obligation_type='reservation_fee' AND app.payment_obligation_paid(p_tenant,obligation.id)>=obligation.amount
     AND EXISTS(SELECT 1 FROM contracts WHERE tenant_id=p_tenant AND id=obligation.contract_id AND contract_type='rs' AND current_status='signed')
     AND NOT EXISTS(SELECT 1 FROM unit_holds WHERE tenant_id=p_tenant AND unit_id=obligation.unit_id AND hold_type='reservation' AND status='active') THEN
    SELECT id INTO old_hold FROM unit_holds WHERE tenant_id=p_tenant AND unit_id=obligation.unit_id AND hold_type='pre_reservation' AND status='active' FOR UPDATE;
    IF old_hold IS NOT NULL THEN UPDATE unit_holds SET status='converted',ended_at=now() WHERE tenant_id=p_tenant AND id=old_hold;END IF;
    INSERT INTO unit_holds(tenant_id,project_id,unit_id,sales_case_id,hold_type,starts_at,expires_at,idempotency_key,created_by_membership_id)
      VALUES(p_tenant,obligation.project_id,obligation.unit_id,obligation.sales_case_id,'reservation',now(),now()+interval '365 days','paid-rs-fee:'||obligation.id,p_actor_membership);
    SELECT commercial_status INTO unit_status FROM units WHERE tenant_id=p_tenant AND id=obligation.unit_id FOR UPDATE;
    PERFORM app.transition_unit_commercial_status(p_tenant,obligation.unit_id,'reserved',CASE unit_status WHEN 'pre_reserved' THEN 'confirmReservation' ELSE 'createReservation' END,'Podepsaná RS a plně uhrazený rezervační poplatek',p_actor_membership);
    UPDATE sales_cases SET reservation_activated_at=now() WHERE tenant_id=p_tenant AND id=obligation.sales_case_id;
    INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
      VALUES(p_tenant,'unit',obligation.unit_id,'reservation.activated.v1',jsonb_build_object('unitId',obligation.unit_id,'obligationId',obligation.id,'contractId',obligation.contract_id));
  END IF;
  RETURN v_transaction_id;
END $$;
COMMIT;

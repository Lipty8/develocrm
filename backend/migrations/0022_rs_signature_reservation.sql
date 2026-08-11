BEGIN;

-- A reservation becomes effective when a valid RS is signed. Payment remains
-- an independently tracked obligation and determines the recommended next step.
CREATE OR REPLACE FUNCTION app.require_reservation_payment()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.hold_type='reservation' AND NEW.status='active' AND NOT EXISTS (
    SELECT 1
    FROM contracts contract
    WHERE contract.tenant_id=NEW.tenant_id
      AND contract.sales_case_id=NEW.sales_case_id
      AND contract.contract_type='rs'
      AND contract.current_status='signed'
  ) THEN
    RAISE EXCEPTION 'reservation requires a signed RS';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.ensure_signed_rs_reservation(
  p_tenant uuid,
  p_contract uuid,
  p_actor_membership uuid,
  p_reason text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  contract_row contracts%ROWTYPE;
  case_row sales_cases%ROWTYPE;
  actor uuid;
  unit_status text;
  pre_hold unit_holds%ROWTYPE;
  reservation_hold uuid;
  reason_text text:=COALESCE(NULLIF(btrim(p_reason),''),'Podepsaná rezervační smlouva');
  reservation_expires_at timestamptz:=now()+interval '365 days';
  synchronization_recorded boolean:=false;
BEGIN
  SELECT * INTO contract_row
  FROM contracts
  WHERE tenant_id=p_tenant AND id=p_contract
  FOR UPDATE;

  SELECT user_id INTO actor
  FROM tenant_memberships
  WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';

  IF contract_row.id IS NULL OR contract_row.contract_type<>'rs' OR contract_row.current_status<>'signed' THEN
    RAISE EXCEPTION 'signed RS is required';
  END IF;
  IF actor IS NULL OR NOT app.has_project_permission(p_tenant,p_actor_membership,contract_row.project_id,'contract.sign') THEN
    RAISE EXCEPTION 'contract.sign permission required';
  END IF;

  SELECT * INTO case_row
  FROM sales_cases
  WHERE tenant_id=p_tenant AND id=contract_row.sales_case_id
  FOR UPDATE;
  IF case_row.id IS NULL OR case_row.status<>'active' OR case_row.unit_id<>contract_row.unit_id THEN
    RAISE EXCEPTION 'signed RS requires an active sales case for the same unit';
  END IF;

  -- Never move an already advanced SBK/KS/handover process backwards.
  IF case_row.current_stage IN ('sbk','ks','handover') THEN
    SELECT id INTO reservation_hold
    FROM unit_holds
    WHERE tenant_id=p_tenant AND unit_id=contract_row.unit_id
      AND sales_case_id=contract_row.sales_case_id AND hold_type='reservation' AND status='active'
    ORDER BY created_at DESC LIMIT 1;
    RETURN reservation_hold;
  END IF;

  SELECT commercial_status INTO unit_status
  FROM units
  WHERE tenant_id=p_tenant AND id=contract_row.unit_id
  FOR UPDATE;
  IF unit_status NOT IN ('available','pre_reserved','reserved') THEN
    RAISE EXCEPTION 'unit commercial status is incompatible with signed RS reservation';
  END IF;

  SELECT id INTO reservation_hold
  FROM unit_holds
  WHERE tenant_id=p_tenant AND unit_id=contract_row.unit_id
    AND sales_case_id=contract_row.sales_case_id AND hold_type='reservation'
    AND status='active' AND expires_at>now()
  ORDER BY created_at DESC LIMIT 1
  FOR UPDATE;

  IF reservation_hold IS NULL THEN
    SELECT * INTO pre_hold
    FROM unit_holds
    WHERE tenant_id=p_tenant AND unit_id=contract_row.unit_id
      AND sales_case_id=contract_row.sales_case_id AND hold_type='pre_reservation' AND status='active'
    ORDER BY created_at DESC LIMIT 1
    FOR UPDATE;

    -- End every stale active hold before inserting the single effective reservation.
    UPDATE unit_holds
    SET status=CASE WHEN id=pre_hold.id THEN 'converted' ELSE 'expired' END,ended_at=now()
    WHERE tenant_id=p_tenant AND unit_id=contract_row.unit_id AND status='active';

    reservation_expires_at:=GREATEST(
      reservation_expires_at,
      COALESCE(pre_hold.expires_at,reservation_expires_at),
      COALESCE(contract_row.payment_due_at,reservation_expires_at)
    );
    INSERT INTO unit_holds(
      tenant_id,project_id,unit_id,sales_case_id,hold_type,starts_at,expires_at,
      idempotency_key,created_by_membership_id
    ) VALUES(
      p_tenant,contract_row.project_id,contract_row.unit_id,contract_row.sales_case_id,
      'reservation',now(),reservation_expires_at,'signed-rs-reservation:'||contract_row.id,p_actor_membership
    )
    ON CONFLICT (tenant_id,idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key
    RETURNING id INTO reservation_hold;

    INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data,metadata)
    VALUES(p_tenant,actor,
      CASE WHEN pre_hold.id IS NULL THEN 'hold.created_by_rs_signature' ELSE 'hold.converted_by_rs_signature' END,
      'unit_hold',reservation_hold,
      jsonb_build_object('type','reservation','unitId',contract_row.unit_id,'salesCaseId',contract_row.sales_case_id,'fromHoldId',pre_hold.id,'contractId',contract_row.id,'expiresAt',reservation_expires_at),
      jsonb_build_object('projectId',contract_row.project_id,'unitId',contract_row.unit_id,'contractId',contract_row.id));
    INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
    VALUES(p_tenant,'hold',reservation_hold,'hold.activated_by_rs_signature.v1',
      jsonb_build_object('holdId',reservation_hold,'fromHoldId',pre_hold.id,'unitId',contract_row.unit_id,'salesCaseId',contract_row.sales_case_id,'contractId',contract_row.id));
  END IF;

  IF unit_status='available' THEN
    PERFORM app.transition_unit_commercial_status(p_tenant,contract_row.unit_id,'reserved','createReservation',reason_text,p_actor_membership);
  ELSIF unit_status='pre_reserved' THEN
    PERFORM app.transition_unit_commercial_status(p_tenant,contract_row.unit_id,'reserved','confirmReservation',reason_text,p_actor_membership);
  END IF;

  PERFORM app.record_sales_stage(p_tenant,contract_row.sales_case_id,'reservation','activateReservationFromSignedRs',reason_text,p_actor_membership);
  UPDATE sales_cases
  SET reservation_activated_at=COALESCE(reservation_activated_at,contract_row.signed_at,now())
  WHERE tenant_id=p_tenant AND id=contract_row.sales_case_id;

  SELECT EXISTS(
    SELECT 1 FROM outbox_events
    WHERE tenant_id=p_tenant AND aggregate_type='contract' AND aggregate_id=contract_row.id
      AND event_type='rs.signature_reservation_activated.v1'
  ) INTO synchronization_recorded;
  IF NOT synchronization_recorded THEN
    INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data,metadata)
    VALUES(p_tenant,actor,'rs.signature_reservation_activated','sales_case',contract_row.sales_case_id,
      jsonb_build_object('stage','reservation','commercialStatus','reserved','reservationHoldId',reservation_hold),
      jsonb_build_object('projectId',contract_row.project_id,'unitId',contract_row.unit_id,'contractId',contract_row.id));
    INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
    VALUES(p_tenant,'contract',contract_row.id,'rs.signature_reservation_activated.v1',
      jsonb_build_object('contractId',contract_row.id,'unitId',contract_row.unit_id,'salesCaseId',contract_row.sales_case_id,'reservationHoldId',reservation_hold));
  END IF;

  RETURN reservation_hold;
END $$;

CREATE OR REPLACE FUNCTION app.sign_contract_externally(
  p_tenant uuid,p_contract uuid,p_version uuid,p_signed_at timestamptz,
  p_actor_membership uuid,p_note text DEFAULT NULL
) RETURNS TABLE(completed boolean,already_signed boolean,version_id uuid) LANGUAGE plpgsql AS $$
DECLARE
  contract_row contracts%ROWTYPE;actor uuid;current_version contract_versions%ROWTYPE;
  signature_time timestamptz:=COALESCE(p_signed_at,now());
  note_text text:=COALESCE(NULLIF(btrim(p_note),''),'Podpis smlouvy zaznamenán');
  stage_target text;status_target text;status_command text;
BEGIN
  SELECT * INTO contract_row FROM contracts WHERE tenant_id=p_tenant AND id=p_contract FOR UPDATE;
  SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF contract_row.id IS NULL THEN RAISE EXCEPTION 'contract not found'; END IF;
  IF actor IS NULL OR NOT app.has_project_permission(p_tenant,p_actor_membership,contract_row.project_id,'contract.sign') THEN RAISE EXCEPTION 'contract.sign permission required'; END IF;
  SELECT * INTO current_version FROM contract_versions WHERE tenant_id=p_tenant AND contract_id=p_contract ORDER BY version_number DESC,id DESC LIMIT 1 FOR UPDATE;
  IF current_version.id IS NULL THEN RAISE EXCEPTION 'contract requires a logical version'; END IF;
  IF p_version IS NULL OR p_version<>current_version.id THEN RAISE EXCEPTION 'current contract version is required'; END IF;
  IF contract_row.current_status='signed' THEN
    IF current_version.version_status<>'signed' THEN RAISE EXCEPTION 'signed contract version is inconsistent'; END IF;
    IF contract_row.contract_type='rs' THEN PERFORM app.ensure_signed_rs_reservation(p_tenant,p_contract,p_actor_membership,note_text); END IF;
    RETURN QUERY SELECT true,true,current_version.id;RETURN;
  END IF;
  IF contract_row.current_status NOT IN ('approved','signing') THEN RAISE EXCEPTION 'contract must be approved or in signing workflow'; END IF;
  IF current_version.version_status<>'approved_for_signing' THEN RAISE EXCEPTION 'approved contract version is required'; END IF;
  IF signature_time>now()+interval '5 minutes' THEN RAISE EXCEPTION 'signature date cannot be in the future'; END IF;
  IF NOT EXISTS(SELECT 1 FROM contract_parties WHERE tenant_id=p_tenant AND contract_id=p_contract AND signing_required) THEN RAISE EXCEPTION 'contract requires a signing party'; END IF;
  IF contract_row.current_status='approved' THEN
    PERFORM set_config('app.contract_status_command','on',true);
    UPDATE contracts SET current_status='signing' WHERE tenant_id=p_tenant AND id=p_contract;
    INSERT INTO contract_status_events(tenant_id,project_id,contract_id,from_status,to_status,command,reason,recorded_by_membership_id,source)
    VALUES(p_tenant,contract_row.project_id,p_contract,'approved','signing','startExternalSigning',note_text,p_actor_membership,'signature');
  END IF;
  UPDATE contract_parties SET signature_status='signed',signed_at=signature_time,signed_version_id=current_version.id
    WHERE tenant_id=p_tenant AND contract_id=p_contract AND signing_required AND signature_status<>'signed';
  UPDATE contract_versions SET version_status='signed',signed_at=signature_time,locked_at=now() WHERE tenant_id=p_tenant AND id=current_version.id;
  PERFORM set_config('app.contract_status_command','on',true);
  UPDATE contracts SET current_status='signed',signed_at=signature_time WHERE tenant_id=p_tenant AND id=p_contract;
  INSERT INTO contract_status_events(tenant_id,project_id,contract_id,from_status,to_status,command,reason,recorded_by_membership_id,source)
  VALUES(p_tenant,contract_row.project_id,p_contract,'signing','signed','recordExternalSignature',note_text,p_actor_membership,'signature');
  IF contract_row.contract_type='rs' THEN
    PERFORM app.ensure_signed_rs_reservation(p_tenant,p_contract,p_actor_membership,note_text);
  ELSE
    IF contract_row.contract_type IN ('sbk','ks') THEN stage_target:=contract_row.contract_type;PERFORM app.record_sales_stage(p_tenant,contract_row.sales_case_id,stage_target,'contractSigned',note_text,p_actor_membership);END IF;
    IF contract_row.contract_type='sbk' THEN status_target:='contracted';status_command:='activateFuturePurchaseContract';END IF;
    IF contract_row.contract_type='ks' THEN status_target:='sold';status_command:='confirmFinalContractEffective';END IF;
    IF status_target IS NOT NULL THEN PERFORM app.transition_unit_commercial_status(p_tenant,contract_row.unit_id,status_target,status_command,note_text,p_actor_membership);END IF;
  END IF;
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data,metadata)
  VALUES(p_tenant,actor,'contract.signed','contract',p_contract,jsonb_build_object('versionId',current_version.id,'type',contract_row.contract_type,'signedAt',signature_time,'method','external'),jsonb_build_object('projectId',contract_row.project_id,'unitId',contract_row.unit_id,'note',NULLIF(btrim(p_note),'')));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'contract',p_contract,'contract.signed.v1',jsonb_build_object('contractId',p_contract,'versionId',current_version.id,'type',contract_row.contract_type,'unitId',contract_row.unit_id,'signedAt',signature_time,'method','external'));
  RETURN QUERY SELECT true,false,current_version.id;
END $$;

CREATE OR REPLACE FUNCTION app.record_contract_party_signature(
  p_tenant uuid,p_contract_party uuid,p_version uuid,p_actor_membership uuid,p_reason text
) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE participant contract_parties%ROWTYPE;contract_row contracts%ROWTYPE;actor uuid;remaining integer;stage_target text;status_target text;status_command text;reason_text text:=COALESCE(NULLIF(btrim(p_reason),''),'Podpis účastníka zaznamenán');
BEGIN
  SELECT * INTO participant FROM contract_parties WHERE tenant_id=p_tenant AND id=p_contract_party FOR UPDATE;
  SELECT * INTO contract_row FROM contracts WHERE tenant_id=p_tenant AND id=participant.contract_id FOR UPDATE;
  SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF participant.id IS NULL OR contract_row.current_status<>'signing' OR actor IS NULL OR NOT app.has_project_permission(p_tenant,p_actor_membership,contract_row.project_id,'contract.sign') THEN RAISE EXCEPTION 'contract.sign permission and signing workflow are required';END IF;
  IF NOT EXISTS(SELECT 1 FROM contract_versions WHERE tenant_id=p_tenant AND contract_id=contract_row.id AND id=p_version AND version_status='approved_for_signing') THEN RAISE EXCEPTION 'approved contract version is required';END IF;
  UPDATE contract_parties SET signature_status='signed',signed_at=now(),signed_version_id=p_version WHERE tenant_id=p_tenant AND id=p_contract_party AND signature_status<>'signed';
  SELECT count(*) INTO remaining FROM contract_parties WHERE tenant_id=p_tenant AND contract_id=contract_row.id AND signing_required AND signature_status<>'signed';
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data) VALUES(p_tenant,actor,'contract.party_signed','contract_party',p_contract_party,jsonb_build_object('contractId',contract_row.id,'versionId',p_version));
  IF remaining>0 THEN RETURN false;END IF;
  UPDATE contract_versions SET version_status='signed',signed_at=now(),locked_at=now() WHERE tenant_id=p_tenant AND id=p_version;
  PERFORM set_config('app.contract_status_command','on',true);
  UPDATE contracts SET current_status='signed',signed_at=now() WHERE tenant_id=p_tenant AND id=contract_row.id;
  INSERT INTO contract_status_events(tenant_id,project_id,contract_id,from_status,to_status,command,reason,recorded_by_membership_id)
  VALUES(p_tenant,contract_row.project_id,contract_row.id,'signing','signed','completeSignatures',reason_text,p_actor_membership);
  IF contract_row.contract_type='rs' THEN
    PERFORM app.ensure_signed_rs_reservation(p_tenant,contract_row.id,p_actor_membership,reason_text);
  ELSE
    IF contract_row.contract_type IN ('sbk','ks') THEN stage_target:=contract_row.contract_type;PERFORM app.record_sales_stage(p_tenant,contract_row.sales_case_id,stage_target,'contractSigned',reason_text,p_actor_membership);END IF;
    IF contract_row.contract_type='sbk' THEN status_target:='contracted';status_command:='activateFuturePurchaseContract';END IF;
    IF contract_row.contract_type='ks' THEN status_target:='sold';status_command:='confirmFinalContractEffective';END IF;
    IF status_target IS NOT NULL THEN PERFORM app.transition_unit_commercial_status(p_tenant,contract_row.unit_id,status_target,status_command,reason_text,p_actor_membership);END IF;
  END IF;
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data) VALUES(p_tenant,actor,'contract.signed','contract',contract_row.id,jsonb_build_object('versionId',p_version,'type',contract_row.contract_type));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload) VALUES(p_tenant,'contract',contract_row.id,'contract.signed.v1',jsonb_build_object('contractId',contract_row.id,'versionId',p_version,'type',contract_row.contract_type,'unitId',contract_row.unit_id));
  RETURN true;
END $$;

-- A reversed fee no longer cancels a legally signed reservation. It only changes payment status.
CREATE OR REPLACE FUNCTION app.reverse_payment(p_tenant uuid,p_transaction uuid,p_reason text,p_actor_membership uuid)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE transaction payment_transactions%ROWTYPE;result uuid;actor uuid;obligation payment_obligations%ROWTYPE;
BEGIN
  SELECT * INTO transaction FROM payment_transactions WHERE tenant_id=p_tenant AND id=p_transaction FOR UPDATE;
  SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF transaction.id IS NULL THEN RAISE EXCEPTION 'payment transaction not found';END IF;
  IF actor IS NULL OR NOT app.has_project_permission(p_tenant,p_actor_membership,transaction.project_id,'payments.reverse') THEN RAISE EXCEPTION 'payments.reverse permission required';END IF;
  SELECT id INTO result FROM payment_reversals WHERE tenant_id=p_tenant AND transaction_id=p_transaction;
  IF result IS NOT NULL THEN RETURN result;END IF;
  INSERT INTO payment_reversals(tenant_id,project_id,transaction_id,reason,reversed_by_membership_id) VALUES(p_tenant,transaction.project_id,p_transaction,p_reason,p_actor_membership) RETURNING id INTO result;
  INSERT INTO payment_events(tenant_id,project_id,transaction_id,event_type,payload,recorded_by_membership_id) VALUES(p_tenant,transaction.project_id,p_transaction,'payment.reversed',jsonb_build_object('reason',p_reason),p_actor_membership);
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data) VALUES(p_tenant,actor,'payment.reversed','payment_transaction',p_transaction,jsonb_build_object('reason',p_reason));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload) VALUES(p_tenant,'payment_transaction',p_transaction,'payment.reversed.v1',jsonb_build_object('transactionId',p_transaction,'reason',p_reason));
  SELECT target.* INTO obligation FROM payment_allocations allocation JOIN payment_obligations target ON target.tenant_id=allocation.tenant_id AND target.id=allocation.obligation_id WHERE allocation.tenant_id=p_tenant AND allocation.transaction_id=p_transaction AND target.obligation_type='reservation_fee' LIMIT 1;
  IF obligation.id IS NOT NULL THEN
    INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
    VALUES(p_tenant,'payment_obligation',obligation.id,'reservation_fee.payment_status_changed.v1',jsonb_build_object('obligationId',obligation.id,'unitId',obligation.unit_id,'status',app.payment_obligation_status(p_tenant,obligation.id,now())));
  END IF;
  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION app.ensure_signed_rs_reservation(uuid,uuid,uuid,text) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.sign_contract_externally(uuid,uuid,uuid,timestamptz,uuid,text) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.record_contract_party_signature(uuid,uuid,uuid,uuid,text) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.reverse_payment(uuid,uuid,text,uuid) TO develocrm_app;

-- Repair already signed RS records that were created before this migration.
DO $$
DECLARE item record;actor_membership uuid;
BEGIN
  FOR item IN
    SELECT contract.tenant_id,contract.id,contract.project_id
    FROM contracts contract
    JOIN sales_cases sales_case ON sales_case.tenant_id=contract.tenant_id AND sales_case.id=contract.sales_case_id
    JOIN units unit ON unit.tenant_id=contract.tenant_id AND unit.id=contract.unit_id
    WHERE contract.contract_type='rs' AND contract.current_status='signed'
      AND sales_case.status='active' AND sales_case.current_stage NOT IN ('sbk','ks','handover')
      AND unit.commercial_status IN ('available','pre_reserved','reserved')
  LOOP
    SELECT membership.id INTO actor_membership
    FROM tenant_memberships membership
    WHERE membership.tenant_id=item.tenant_id AND membership.status='active'
      AND app.has_project_permission(item.tenant_id,membership.id,item.project_id,'contract.sign')
    ORDER BY (membership.id=(SELECT created_by_membership_id FROM contracts WHERE tenant_id=item.tenant_id AND id=item.id)) DESC,membership.created_at
    LIMIT 1;
    IF actor_membership IS NOT NULL THEN
      PERFORM app.ensure_signed_rs_reservation(item.tenant_id,item.id,actor_membership,'Doplnění návaznosti dříve podepsané RS');
    END IF;
  END LOOP;
END $$;

COMMIT;

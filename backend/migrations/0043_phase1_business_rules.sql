BEGIN;

-- Aktuální splatnost zůstává na předpisu kvůli všem existujícím projekcím.
-- Původní hodnota a každá změna jsou však nově auditovatelně zachované.
ALTER TABLE payment_obligations ADD COLUMN original_due_at timestamptz;
UPDATE payment_obligations SET original_due_at=due_at WHERE original_due_at IS NULL;
ALTER TABLE payment_obligations ALTER COLUMN original_due_at SET NOT NULL;

CREATE OR REPLACE FUNCTION app.payment_obligation_original_due_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.original_due_at:=COALESCE(NEW.original_due_at,NEW.due_at);
  RETURN NEW;
END $$;
CREATE TRIGGER payment_obligation_original_due_at_guard BEFORE INSERT ON payment_obligations
FOR EACH ROW EXECUTE FUNCTION app.payment_obligation_original_due_at();

CREATE TABLE payment_due_date_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  obligation_id uuid NOT NULL,
  previous_due_at timestamptz NOT NULL,
  new_due_at timestamptz NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason))>=3),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key))>=8),
  changed_by_membership_id uuid NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_due_date_change_obligation_fk FOREIGN KEY (tenant_id,obligation_id) REFERENCES payment_obligations(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT payment_due_date_change_actor_fk FOREIGN KEY (tenant_id,changed_by_membership_id) REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT payment_due_date_change_tenant_pair_uq UNIQUE (tenant_id,id),
  CONSTRAINT payment_due_date_change_idempotency_uq UNIQUE (tenant_id,idempotency_key),
  CONSTRAINT payment_due_date_change_value_check CHECK (previous_due_at<>new_due_at)
);
CREATE INDEX payment_due_date_change_history_idx ON payment_due_date_changes(tenant_id,obligation_id,changed_at DESC,id DESC);
CREATE TRIGGER payment_due_date_changes_append_only BEFORE UPDATE OR DELETE ON payment_due_date_changes FOR EACH ROW EXECUTE FUNCTION app.reject_append_only();

CREATE TABLE payment_refund_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  contract_id uuid NOT NULL,
  obligation_id uuid NOT NULL,
  decision text NOT NULL CHECK (decision IN ('none','partial','full','undetermined')),
  decided_amount numeric(14,2),
  reason text NOT NULL CHECK (length(btrim(reason))>=3),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key))>=8),
  decided_by_membership_id uuid NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_refund_decision_contract_fk FOREIGN KEY (tenant_id,project_id,contract_id) REFERENCES contracts(tenant_id,project_id,id) ON DELETE RESTRICT,
  CONSTRAINT payment_refund_decision_obligation_fk FOREIGN KEY (tenant_id,obligation_id) REFERENCES payment_obligations(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT payment_refund_decision_actor_fk FOREIGN KEY (tenant_id,decided_by_membership_id) REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT payment_refund_decision_tenant_pair_uq UNIQUE (tenant_id,id),
  CONSTRAINT payment_refund_decision_idempotency_uq UNIQUE (tenant_id,idempotency_key),
  CONSTRAINT payment_refund_decision_amount_check CHECK (
    (decision IN ('none','undetermined') AND decided_amount IS NULL)
    OR (decision IN ('partial','full') AND decided_amount IS NOT NULL AND decided_amount>0)
  )
);
CREATE INDEX payment_refund_decision_latest_idx ON payment_refund_decisions(tenant_id,obligation_id,decided_at DESC,id DESC);
CREATE TRIGGER payment_refund_decisions_append_only BEFORE UPDATE OR DELETE ON payment_refund_decisions FOR EACH ROW EXECUTE FUNCTION app.reject_append_only();

CREATE TABLE contract_cancellation_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,project_id uuid NOT NULL,contract_id uuid NOT NULL,
  target_status text NOT NULL CHECK (target_status IN ('cancelled','terminated')),idempotency_key text NOT NULL,
  executed_by_membership_id uuid NOT NULL,executed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contract_cancellation_command_contract_fk FOREIGN KEY (tenant_id,project_id,contract_id) REFERENCES contracts(tenant_id,project_id,id) ON DELETE RESTRICT,
  CONSTRAINT contract_cancellation_command_actor_fk FOREIGN KEY (tenant_id,executed_by_membership_id) REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT contract_cancellation_command_tenant_pair_uq UNIQUE (tenant_id,id),
  CONSTRAINT contract_cancellation_command_idempotency_uq UNIQUE (tenant_id,idempotency_key)
);
CREATE TRIGGER contract_cancellation_commands_append_only BEFORE UPDATE OR DELETE ON contract_cancellation_commands FOR EACH ROW EXECUTE FUNCTION app.reject_append_only();

CREATE OR REPLACE FUNCTION app.change_payment_obligation_due_date(
  p_tenant uuid,p_obligation uuid,p_new_due_at timestamptz,p_reason text,p_idempotency_key text,p_actor_membership uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,app AS $$
DECLARE obligation payment_obligations%ROWTYPE;actor uuid;change_id uuid;
BEGIN
  SELECT id INTO change_id FROM payment_due_date_changes WHERE tenant_id=p_tenant AND idempotency_key=p_idempotency_key;
  IF change_id IS NOT NULL THEN RETURN change_id;END IF;
  SELECT * INTO obligation FROM payment_obligations WHERE tenant_id=p_tenant AND id=p_obligation FOR UPDATE;
  SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF obligation.id IS NULL OR actor IS NULL OR NOT app.has_project_permission(p_tenant,p_actor_membership,obligation.project_id,'payments.manage') THEN RAISE EXCEPTION 'payments.manage permission required';END IF;
  IF p_new_due_at IS NULL OR p_new_due_at=obligation.due_at OR length(btrim(COALESCE(p_reason,'')))<3 OR length(btrim(COALESCE(p_idempotency_key,'')))<8 THEN RAISE EXCEPTION 'new due date, reason and idempotency key are required';END IF;
  INSERT INTO payment_due_date_changes(tenant_id,project_id,obligation_id,previous_due_at,new_due_at,reason,idempotency_key,changed_by_membership_id)
  VALUES(p_tenant,obligation.project_id,p_obligation,obligation.due_at,p_new_due_at,btrim(p_reason),btrim(p_idempotency_key),p_actor_membership) RETURNING id INTO change_id;
  UPDATE payment_obligations SET due_at=p_new_due_at WHERE tenant_id=p_tenant AND id=p_obligation;
  INSERT INTO payment_events(tenant_id,project_id,obligation_id,event_type,payload,recorded_by_membership_id)
  VALUES(p_tenant,obligation.project_id,p_obligation,'obligation.due_date_changed',jsonb_build_object('changeId',change_id,'previousDueAt',obligation.due_at,'newDueAt',p_new_due_at,'reason',btrim(p_reason)),p_actor_membership);
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data,metadata)
  VALUES(p_tenant,actor,'payment.due_date_changed','payment_obligation',p_obligation,jsonb_build_object('dueAt',obligation.due_at),jsonb_build_object('dueAt',p_new_due_at,'reason',btrim(p_reason)),jsonb_build_object('projectId',obligation.project_id,'changeId',change_id));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'payment_obligation',p_obligation,'payment.due_date_changed.v1',jsonb_build_object('obligationId',p_obligation,'projectId',obligation.project_id,'newDueAt',p_new_due_at,'changeId',change_id));
  RETURN change_id;
END $$;

CREATE OR REPLACE FUNCTION app.transition_contract_status_with_refund_decisions(
  p_tenant uuid,p_contract uuid,p_to text,p_reason text,p_refund_decisions jsonb,p_idempotency_key text,p_actor_membership uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,app AS $$
DECLARE contract_row contracts%ROWTYPE;command_id uuid;event_id uuid;paid_count integer;covered_count integer;item jsonb;obligation payment_obligations%ROWTYPE;paid numeric;decision_text text;decision_amount numeric;decision_id uuid;actor uuid;
BEGIN
  SELECT id INTO command_id FROM contract_cancellation_commands WHERE tenant_id=p_tenant AND idempotency_key=p_idempotency_key;
  IF command_id IS NOT NULL THEN RETURN command_id;END IF;
  SELECT * INTO contract_row FROM contracts WHERE tenant_id=p_tenant AND id=p_contract FOR UPDATE;
  SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF contract_row.id IS NULL OR actor IS NULL THEN RAISE EXCEPTION 'contract or actor not found';END IF;
  IF p_to NOT IN ('cancelled','terminated') THEN RETURN app.transition_contract_status(p_tenant,p_contract,p_to,p_reason,p_actor_membership);END IF;
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

CREATE OR REPLACE FUNCTION app.create_payment_refund(
  p_tenant uuid,p_obligation uuid,p_source_transaction uuid,p_amount numeric,p_refunded_at timestamptz,
  p_reason text,p_idempotency_key text,p_actor_membership uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,app AS $$
DECLARE obligation payment_obligations%ROWTYPE;source_allocation numeric;already_source_refunded numeric;all_refunded numeric;planned numeric;actor uuid;refund_id uuid;stored_reason text;
BEGIN
  SELECT * INTO obligation FROM payment_obligations WHERE tenant_id=p_tenant AND id=p_obligation FOR UPDATE;
  SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF obligation.id IS NULL THEN RAISE EXCEPTION 'received payment allocation is required for refund';END IF;
  IF actor IS NULL OR NOT (app.has_project_permission(p_tenant,p_actor_membership,obligation.project_id,'payments.reverse') OR app.has_project_permission(p_tenant,p_actor_membership,obligation.project_id,'payments.manage')) THEN RAISE EXCEPTION 'payments.reverse permission required';END IF;
  SELECT id INTO refund_id FROM payment_refunds WHERE tenant_id=p_tenant AND idempotency_key=p_idempotency_key;
  IF refund_id IS NOT NULL THEN RETURN refund_id;END IF;
  SELECT allocation.amount INTO source_allocation FROM payment_allocations allocation LEFT JOIN payment_reversals reversal ON reversal.tenant_id=allocation.tenant_id AND reversal.transaction_id=allocation.transaction_id
    WHERE allocation.tenant_id=p_tenant AND allocation.obligation_id=p_obligation AND allocation.transaction_id=p_source_transaction AND reversal.id IS NULL;
  IF source_allocation IS NULL THEN RAISE EXCEPTION 'received payment allocation is required for refund';END IF;
  SELECT CASE decision WHEN 'none' THEN 0 ELSE decided_amount END INTO planned
    FROM payment_refund_decisions WHERE tenant_id=p_tenant AND obligation_id=p_obligation ORDER BY decided_at DESC,id DESC LIMIT 1;
  IF planned IS NULL THEN RAISE EXCEPTION 'explicit refund decision is required';END IF;
  IF NOT EXISTS(SELECT 1 FROM contracts contract WHERE contract.tenant_id=p_tenant AND contract.id=obligation.contract_id AND contract.current_status IN ('cancelled','terminated')) THEN RAISE EXCEPTION 'refund is allowed only for an ended contract';END IF;
  IF p_amount IS NULL OR p_amount<=0 OR p_refunded_at IS NULL OR length(btrim(COALESCE(p_idempotency_key,'')))<8 THEN RAISE EXCEPTION 'valid refund amount, date and idempotency key are required';END IF;
  SELECT COALESCE(sum(amount),0) INTO already_source_refunded FROM payment_refunds WHERE tenant_id=p_tenant AND obligation_id=p_obligation AND source_transaction_id=p_source_transaction;
  SELECT COALESCE(sum(amount),0) INTO all_refunded FROM payment_refunds WHERE tenant_id=p_tenant AND obligation_id=p_obligation;
  IF p_amount>source_allocation-already_source_refunded OR p_amount>planned-all_refunded THEN RAISE EXCEPTION 'refund amount exceeds decided refundable amount';END IF;
  stored_reason:=COALESCE(NULLIF(btrim(p_reason),''),'Bez poznámky');
  INSERT INTO payment_refunds(tenant_id,project_id,obligation_id,source_transaction_id,amount,refunded_at,reason,idempotency_key,created_by_membership_id)
  VALUES(p_tenant,obligation.project_id,p_obligation,p_source_transaction,p_amount,p_refunded_at,stored_reason,btrim(p_idempotency_key),p_actor_membership) RETURNING id INTO refund_id;
  INSERT INTO payment_events(tenant_id,project_id,obligation_id,transaction_id,event_type,payload,recorded_by_membership_id)
  VALUES(p_tenant,obligation.project_id,p_obligation,p_source_transaction,'payment.refund_created',jsonb_build_object('refundId',refund_id,'amount',p_amount,'refundedAt',p_refunded_at),p_actor_membership);
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data,metadata)
  VALUES(p_tenant,actor,'payment.refund_created','payment_refund',refund_id,jsonb_build_object('amount',p_amount,'refundedAt',p_refunded_at,'reason',stored_reason),jsonb_build_object('projectId',obligation.project_id,'obligationId',p_obligation,'sourceTransactionId',p_source_transaction));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'payment_refund',refund_id,'payment.refund_created.v1',jsonb_build_object('refundId',refund_id,'obligationId',p_obligation,'sourceTransactionId',p_source_transaction,'amount',p_amount,'projectId',obligation.project_id));
  RETURN refund_id;
END $$;

-- RS ani SBK nejsou povinné. Podepsaná SBK nebo KS proto mohou posunout
-- jednotku přímo z dřívější obchodní etapy, vždy ale jen při existenci
-- odpovídající podepsané smlouvy.
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

CREATE OR REPLACE FUNCTION app.synchronize_signed_contract(
  p_tenant uuid,p_contract uuid,p_actor_membership uuid,p_reason text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE contract_row contracts%ROWTYPE;unit_status text;reason_text text:=COALESCE(NULLIF(btrim(p_reason),''),'Podepsaná smlouva');
BEGIN
  SELECT * INTO contract_row FROM contracts WHERE tenant_id=p_tenant AND id=p_contract FOR UPDATE;
  IF contract_row.id IS NULL OR contract_row.current_status<>'signed' THEN RAISE EXCEPTION 'signed contract is required';END IF;
  IF contract_row.contract_type IN ('assignment_rs','assignment_sbk') THEN PERFORM app.complete_contract_assignment(p_tenant,p_contract,p_actor_membership,reason_text);RETURN;END IF;
  IF contract_row.contract_type='rs' THEN PERFORM app.ensure_signed_rs_reservation(p_tenant,p_contract,p_actor_membership,reason_text);RETURN;END IF;
  IF contract_row.contract_type NOT IN ('sbk','ks') THEN RETURN;END IF;
  PERFORM app.record_sales_stage(p_tenant,contract_row.sales_case_id,contract_row.contract_type,'contractSigned',reason_text,p_actor_membership);
  SELECT commercial_status INTO unit_status FROM units WHERE tenant_id=p_tenant AND id=contract_row.unit_id FOR UPDATE;
  IF contract_row.contract_type='sbk' AND unit_status NOT IN ('contracted','sold') THEN
    PERFORM app.transition_unit_commercial_status(p_tenant,contract_row.unit_id,'contracted','activateFuturePurchaseContract',reason_text,p_actor_membership);
  ELSIF contract_row.contract_type='ks' AND unit_status<>'sold' THEN
    PERFORM app.transition_unit_commercial_status(p_tenant,contract_row.unit_id,'sold','confirmFinalContractEffective',reason_text,p_actor_membership);
  END IF;
END $$;

ALTER TABLE payment_due_date_changes ENABLE ROW LEVEL SECURITY;ALTER TABLE payment_due_date_changes FORCE ROW LEVEL SECURITY;
CREATE POLICY payment_due_date_changes_read_policy ON payment_due_date_changes FOR SELECT USING (tenant_id=app.current_tenant_id() AND app.payment_project_allowed(tenant_id,project_id,'payments.read'));
CREATE POLICY payment_due_date_changes_manage_policy ON payment_due_date_changes FOR ALL USING (tenant_id=app.current_tenant_id() AND app.payment_project_allowed(tenant_id,project_id,'payments.manage')) WITH CHECK (tenant_id=app.current_tenant_id() AND app.payment_project_allowed(tenant_id,project_id,'payments.manage'));
ALTER TABLE payment_refund_decisions ENABLE ROW LEVEL SECURITY;ALTER TABLE payment_refund_decisions FORCE ROW LEVEL SECURITY;
CREATE POLICY payment_refund_decisions_read_policy ON payment_refund_decisions FOR SELECT USING (tenant_id=app.current_tenant_id() AND app.payment_project_allowed(tenant_id,project_id,'payments.read'));
CREATE POLICY payment_refund_decisions_manage_policy ON payment_refund_decisions FOR ALL USING (tenant_id=app.current_tenant_id() AND app.payment_project_allowed(tenant_id,project_id,'payments.manage')) WITH CHECK (tenant_id=app.current_tenant_id() AND app.payment_project_allowed(tenant_id,project_id,'payments.manage'));
ALTER TABLE contract_cancellation_commands ENABLE ROW LEVEL SECURITY;ALTER TABLE contract_cancellation_commands FORCE ROW LEVEL SECURITY;
CREATE POLICY contract_cancellation_commands_read_policy ON contract_cancellation_commands FOR SELECT USING (tenant_id=app.current_tenant_id() AND app.payment_project_allowed(tenant_id,project_id,'contracts.read'));

GRANT SELECT ON payment_due_date_changes,payment_refund_decisions,contract_cancellation_commands TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.change_payment_obligation_due_date(uuid,uuid,timestamptz,text,text,uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.transition_contract_status_with_refund_decisions(uuid,uuid,text,text,jsonb,text,uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.create_payment_refund(uuid,uuid,uuid,numeric,timestamptz,text,text,uuid) TO develocrm_app;

COMMIT;

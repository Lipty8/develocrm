BEGIN;

ALTER TABLE payment_transactions
  ADD COLUMN source_type text NOT NULL DEFAULT 'manual'
    CHECK (source_type IN ('manual','bank_import','bank_sync')),
  ADD COLUMN idempotency_key text;

CREATE UNIQUE INDEX payment_transaction_idempotency_uq
  ON payment_transactions(tenant_id,idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION app.record_payment(
  p_tenant uuid,p_obligation uuid,p_amount numeric,p_paid_at timestamptz,p_variable_symbol text,p_account text,
  p_bank_transaction_id text,p_note text,p_idempotency_key text,p_actor_membership uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,app AS $$
DECLARE obligation payment_obligations%ROWTYPE;v_transaction_id uuid;actor uuid;unit_status text;old_hold uuid;remaining numeric;
BEGIN
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

CREATE OR REPLACE FUNCTION app.record_payment(
  p_tenant uuid,p_obligation uuid,p_amount numeric,p_paid_at timestamptz,p_variable_symbol text,p_account text,
  p_bank_transaction_id text,p_note text,p_actor_membership uuid
) RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path=public,app AS $$
  SELECT app.record_payment(p_tenant,p_obligation,p_amount,p_paid_at,p_variable_symbol,p_account,p_bank_transaction_id,p_note,NULL,p_actor_membership)
$$;

REVOKE EXECUTE ON FUNCTION app.record_payment(uuid,uuid,numeric,timestamptz,text,text,text,text,text,uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION app.record_payment(uuid,uuid,numeric,timestamptz,text,text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.record_payment(uuid,uuid,numeric,timestamptz,text,text,text,text,text,uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.record_payment(uuid,uuid,numeric,timestamptz,text,text,text,text,uuid) TO develocrm_app;

COMMIT;

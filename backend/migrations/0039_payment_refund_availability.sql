BEGIN;

CREATE OR REPLACE FUNCTION app.create_payment_refund(
  p_tenant uuid,p_obligation uuid,p_source_transaction uuid,p_amount numeric,p_refunded_at timestamptz,
  p_reason text,p_idempotency_key text,p_actor_membership uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,app AS $$
DECLARE obligation payment_obligations%ROWTYPE;source_allocation numeric;already_refunded numeric;actor uuid;refund_id uuid;stored_reason text;
BEGIN
  SELECT * INTO obligation FROM payment_obligations WHERE tenant_id=p_tenant AND id=p_obligation FOR UPDATE;
  SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF obligation.id IS NULL THEN RAISE EXCEPTION 'received payment allocation is required for refund';END IF;
  IF actor IS NULL OR NOT (app.has_project_permission(p_tenant,p_actor_membership,obligation.project_id,'payments.reverse') OR app.has_project_permission(p_tenant,p_actor_membership,obligation.project_id,'payments.manage')) THEN RAISE EXCEPTION 'payments.reverse permission required';END IF;
  SELECT id INTO refund_id FROM payment_refunds WHERE tenant_id=p_tenant AND idempotency_key=p_idempotency_key;
  IF refund_id IS NOT NULL THEN RETURN refund_id;END IF;
  SELECT allocation.amount INTO source_allocation FROM payment_allocations allocation
    LEFT JOIN payment_reversals reversal ON reversal.tenant_id=allocation.tenant_id AND reversal.transaction_id=allocation.transaction_id
    WHERE allocation.tenant_id=p_tenant AND allocation.obligation_id=p_obligation AND allocation.transaction_id=p_source_transaction AND reversal.id IS NULL;
  IF source_allocation IS NULL THEN RAISE EXCEPTION 'received payment allocation is required for refund';END IF;
  IF NOT EXISTS(SELECT 1 FROM contracts contract WHERE contract.tenant_id=p_tenant AND contract.id=obligation.contract_id AND contract.contract_type='rs' AND contract.current_status IN ('cancelled','terminated')) THEN RAISE EXCEPTION 'refund is allowed only for a cancelled RS';END IF;
  IF p_amount IS NULL OR p_amount<=0 OR p_refunded_at IS NULL OR length(btrim(COALESCE(p_idempotency_key,'')))<8 THEN RAISE EXCEPTION 'valid refund amount, date and idempotency key are required';END IF;
  SELECT COALESCE(sum(amount),0) INTO already_refunded FROM payment_refunds WHERE tenant_id=p_tenant AND obligation_id=p_obligation AND source_transaction_id=p_source_transaction;
  IF p_amount>source_allocation-already_refunded THEN RAISE EXCEPTION 'refund amount exceeds refundable payment amount';END IF;
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

GRANT EXECUTE ON FUNCTION app.create_payment_refund(uuid,uuid,uuid,numeric,timestamptz,text,text,uuid) TO develocrm_app;

COMMIT;

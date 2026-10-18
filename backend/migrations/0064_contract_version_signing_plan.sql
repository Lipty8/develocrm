BEGIN;

-- Planned dates are document input, not evidence that anybody has signed.
-- Existing versions deliberately remain NULL; no historical backfill.
ALTER TABLE contract_versions
  ADD COLUMN seller_planned_signing_on date,
  ADD COLUMN buyer_planned_signing_on date;
ALTER TABLE contract_versions ADD CONSTRAINT contract_version_signing_plan_dates CHECK (
  (seller_planned_signing_on IS NULL OR seller_planned_signing_on BETWEEN DATE '2000-01-01' AND DATE '2199-12-31') AND
  (buyer_planned_signing_on IS NULL OR buyer_planned_signing_on BETWEEN DATE '2000-01-01' AND DATE '2199-12-31')
);

CREATE FUNCTION app.guard_contract_version_signing_plan() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.seller_planned_signing_on,NEW.buyer_planned_signing_on)
    IS DISTINCT FROM ROW(OLD.seller_planned_signing_on,OLD.buyer_planned_signing_on) THEN
    IF OLD.document_version_id IS NOT NULL OR OLD.version_status<>'working' OR OLD.locked_at IS NOT NULL THEN
      RAISE EXCEPTION 'SIGNING_PLAN_VERSION_IMMUTABLE';
    END IF;
    IF current_setting('app.contract_signing_plan_command',true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'SIGNING_PLAN_COMMAND_REQUIRED';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER contract_version_signing_plan_guard BEFORE UPDATE ON contract_versions
  FOR EACH ROW EXECUTE FUNCTION app.guard_contract_version_signing_plan();

CREATE FUNCTION app.set_contract_version_signing_plan(
  p_tenant uuid,p_contract uuid,p_version uuid,p_seller_on date,p_buyer_on date,p_actor uuid
) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE c contracts%ROWTYPE; v contract_versions%ROWTYPE; actor_user uuid;
BEGIN
  IF p_tenant IS DISTINCT FROM app.current_tenant_id() THEN RAISE EXCEPTION 'tenant context required'; END IF;
  SELECT user_id INTO actor_user FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor
    AND user_id=app.current_user_id() AND status='active';
  IF actor_user IS NULL THEN RAISE EXCEPTION 'contract.manage permission required'; END IF;
  PERFORM app.lock_workflow_unit(p_tenant,(SELECT unit_id FROM contracts WHERE tenant_id=p_tenant AND id=p_contract));
  SELECT * INTO c FROM contracts WHERE tenant_id=p_tenant AND id=p_contract FOR UPDATE;
  IF c.id IS NULL OR NOT app.has_project_permission(p_tenant,p_actor,c.project_id,'contract.manage') THEN
    RAISE EXCEPTION 'contract.manage permission required';
  END IF;
  IF c.contract_type NOT IN ('rs','sbk') OR c.current_status IN ('signed','cancelled','terminated')
    OR NOT EXISTS(SELECT 1 FROM sales_cases s WHERE s.tenant_id=p_tenant AND s.id=c.sales_case_id AND s.status='active' AND s.closed_at IS NULL) THEN
    RAISE EXCEPTION 'SIGNING_PLAN_CONTRACT_NOT_EDITABLE';
  END IF;
  SELECT * INTO v FROM contract_versions WHERE tenant_id=p_tenant AND contract_id=p_contract
    ORDER BY version_number DESC LIMIT 1 FOR UPDATE;
  IF v.id IS DISTINCT FROM p_version OR v.version_status<>'working' OR v.document_version_id IS NOT NULL OR v.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'SIGNING_PLAN_NEW_VERSION_REQUIRED';
  END IF;
  IF ROW(v.seller_planned_signing_on,v.buyer_planned_signing_on) IS NOT DISTINCT FROM ROW(p_seller_on,p_buyer_on) THEN RETURN false; END IF;
  PERFORM set_config('app.contract_signing_plan_command','on',true);
  UPDATE contract_versions SET seller_planned_signing_on=p_seller_on,buyer_planned_signing_on=p_buyer_on WHERE tenant_id=p_tenant AND id=p_version;
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data)
    VALUES(p_tenant,actor_user,'contract.signing_plan_updated','contract_version',p_version,
      jsonb_build_object('sellerPlannedOn',v.seller_planned_signing_on,'buyerPlannedOn',v.buyer_planned_signing_on),
      jsonb_build_object('contractId',p_contract,'sellerPlannedOn',p_seller_on,'buyerPlannedOn',p_buyer_on));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
    VALUES(p_tenant,'contract',p_contract,'contract.signing_plan_updated.v1',jsonb_build_object('contractId',p_contract,'contractVersionId',p_version));
  RETURN true;
END $$;
COMMIT;

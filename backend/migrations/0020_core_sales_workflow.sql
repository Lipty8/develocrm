BEGIN;

ALTER TABLE contracts
  ADD COLUMN idempotency_key text,
  ADD COLUMN payment_calculation_type text,
  ADD COLUMN payment_input_value numeric(14,4),
  ADD COLUMN payment_amount numeric(14,2),
  ADD COLUMN payment_due_at timestamptz;

ALTER TABLE contracts ADD CONSTRAINT contracts_payment_calculation_check
  CHECK(payment_calculation_type IS NULL OR payment_calculation_type IN ('percentage','fixed'));
ALTER TABLE contracts ADD CONSTRAINT contracts_payment_terms_shape CHECK(
  (payment_calculation_type IS NULL AND payment_input_value IS NULL AND payment_amount IS NULL AND payment_due_at IS NULL)
  OR
  (contract_type IN ('rs','sbk') AND payment_calculation_type IS NOT NULL AND payment_input_value>0 AND payment_amount>0 AND payment_due_at IS NOT NULL)
);
CREATE UNIQUE INDEX contracts_idempotency_uq ON contracts(tenant_id,idempotency_key) WHERE idempotency_key IS NOT NULL;

ALTER TABLE payment_obligations DROP CONSTRAINT payment_obligations_obligation_type_check;
ALTER TABLE payment_obligations ADD CONSTRAINT payment_obligations_obligation_type_check
  CHECK(obligation_type IN ('reservation_fee','purchase_installment','purchase_balance','client_change','other'));
CREATE UNIQUE INDEX payment_sbk_installment_contract_uq ON payment_obligations(tenant_id,contract_id)
  WHERE obligation_type='purchase_installment' AND cancelled_at IS NULL;

-- Starší smlouvy vytvořené před touto opravou mohou postrádat logickou verzi
-- nebo účastníky. Doplnění je deterministické a opakovatelné.
INSERT INTO contract_versions(tenant_id,project_id,contract_id,version_number,source_type,display_name,generation_payload,created_by_membership_id)
SELECT contract.tenant_id,contract.project_id,contract.id,1,'manual',contract.reference||'_v01','{"source":"workflow-repair"}'::jsonb,contract.created_by_membership_id
FROM contracts contract
WHERE NOT EXISTS(
  SELECT 1 FROM contract_versions version
  WHERE version.tenant_id=contract.tenant_id AND version.contract_id=contract.id
);

INSERT INTO contract_parties(tenant_id,project_id,contract_id,party_id,participant_role,signing_required)
SELECT contract.tenant_id,contract.project_id,contract.id,participant.party_id,
  CASE participant.participant_role WHEN 'buyer' THEN 'buyer' WHEN 'co_buyer' THEN 'co_buyer' WHEN 'representative' THEN 'representative' ELSE 'other' END,
  participant.participant_role IN ('buyer','co_buyer')
FROM contracts contract
JOIN sales_case_parties participant ON participant.tenant_id=contract.tenant_id AND participant.sales_case_id=contract.sales_case_id AND participant.left_at IS NULL
WHERE NOT EXISTS(
  SELECT 1 FROM contract_parties existing
  WHERE existing.tenant_id=contract.tenant_id AND existing.contract_id=contract.id
    AND existing.party_id=participant.party_id AND existing.participant_role=CASE participant.participant_role WHEN 'buyer' THEN 'buyer' WHEN 'co_buyer' THEN 'co_buyer' WHEN 'representative' THEN 'representative' ELSE 'other' END
)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION app.create_contract(
  p_tenant uuid,p_case uuid,p_type text,p_reference text,p_title text,p_actor_membership uuid,p_parent_contract uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE project uuid; unit uuid; actor uuid; contract_id uuid:=gen_random_uuid(); version_id uuid:=gen_random_uuid();
BEGIN
  SELECT project_id,unit_id INTO project,unit FROM sales_cases WHERE tenant_id=p_tenant AND id=p_case AND status='active' FOR UPDATE;
  SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF project IS NULL OR actor IS NULL OR NOT app.has_project_permission(p_tenant,p_actor_membership,project,'contract.manage') THEN RAISE EXCEPTION 'contract.manage permission required'; END IF;
  IF p_type='amendment' AND (p_parent_contract IS NULL OR NOT EXISTS(SELECT 1 FROM contracts WHERE tenant_id=p_tenant AND project_id=project AND id=p_parent_contract AND unit_id=unit)) THEN RAISE EXCEPTION 'amendment requires parent contract in the same sales case'; END IF;
  IF p_type<>'amendment' AND p_parent_contract IS NOT NULL THEN RAISE EXCEPTION 'only amendment may have a parent contract'; END IF;
  INSERT INTO contracts(id,tenant_id,project_id,unit_id,sales_case_id,contract_type,parent_contract_id,reference,title,created_by_membership_id)
  VALUES(contract_id,p_tenant,project,unit,p_case,p_type,p_parent_contract,btrim(p_reference),btrim(p_title),p_actor_membership);
  INSERT INTO contract_versions(id,tenant_id,project_id,contract_id,version_number,source_type,display_name,generation_payload,created_by_membership_id)
  VALUES(version_id,p_tenant,project,contract_id,1,'manual',btrim(p_reference)||'_v01',jsonb_build_object('source','contract_creation'),p_actor_membership);
  INSERT INTO contract_parties(tenant_id,project_id,contract_id,party_id,participant_role,signing_required)
  SELECT p_tenant,project,contract_id,participant.party_id,
    CASE participant.participant_role WHEN 'buyer' THEN 'buyer' WHEN 'co_buyer' THEN 'co_buyer' WHEN 'representative' THEN 'representative' ELSE 'other' END,
    participant.participant_role IN ('buyer','co_buyer')
  FROM sales_case_parties participant
  WHERE participant.tenant_id=p_tenant AND participant.sales_case_id=p_case AND participant.left_at IS NULL;
  INSERT INTO contract_status_events(tenant_id,project_id,contract_id,from_status,to_status,command,reason,recorded_by_membership_id)
  VALUES(p_tenant,project,contract_id,NULL,'draft','createContract','Smlouva vytvořena',p_actor_membership);
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data,metadata)
  VALUES(p_tenant,actor,'contract.created','contract',contract_id,jsonb_build_object('type',p_type,'unitId',unit,'salesCaseId',p_case,'versionId',version_id),jsonb_build_object('projectId',project,'unitId',unit));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'contract',contract_id,'contract.created.v1',jsonb_build_object('contractId',contract_id,'type',p_type,'unitId',unit,'versionId',version_id));
  RETURN contract_id;
END $$;

CREATE OR REPLACE FUNCTION app.create_contract_with_payment(
  p_tenant uuid,p_case uuid,p_type text,p_reference text,p_title text,p_actor_membership uuid,p_parent_contract uuid,
  p_idempotency_key text,p_payment_calculation_type text,p_payment_input_value numeric,p_payment_due_at timestamptz
) RETURNS TABLE(contract_id uuid,version_id uuid,payment_obligation_id uuid,payment_amount numeric) LANGUAGE plpgsql AS $$
DECLARE project uuid;unit uuid;party uuid;actor uuid;created_contract uuid;created_version uuid;created_obligation uuid;calculated_amount numeric;obligation_type text;obligation_label text;
BEGIN
  SELECT id INTO created_contract FROM contracts WHERE tenant_id=p_tenant AND idempotency_key=p_idempotency_key;
  IF created_contract IS NOT NULL THEN
    SELECT version.id INTO created_version FROM contract_versions version WHERE version.tenant_id=p_tenant AND version.contract_id=created_contract ORDER BY version.version_number LIMIT 1;
    SELECT obligation.id,obligation.amount INTO created_obligation,calculated_amount FROM payment_obligations obligation WHERE obligation.tenant_id=p_tenant AND obligation.contract_id=created_contract AND obligation.cancelled_at IS NULL ORDER BY obligation.created_at LIMIT 1;
    RETURN QUERY SELECT created_contract,created_version,created_obligation,calculated_amount; RETURN;
  END IF;
  IF NULLIF(btrim(p_idempotency_key),'') IS NULL THEN RAISE EXCEPTION 'contract idempotency key is required'; END IF;
  SELECT sales_case.project_id,sales_case.unit_id INTO project,unit FROM sales_cases sales_case WHERE sales_case.tenant_id=p_tenant AND sales_case.id=p_case AND sales_case.status='active' FOR UPDATE;
  IF project IS NULL THEN RAISE EXCEPTION 'active sales case is required'; END IF;
  IF p_type IN ('rs','sbk') THEN
    IF p_payment_calculation_type NOT IN ('percentage','fixed') OR p_payment_input_value<=0 OR p_payment_due_at<=now() THEN RAISE EXCEPTION 'valid payment terms are required for RS and SBK'; END IF;
    IF p_payment_calculation_type='percentage' THEN
      calculated_amount:=round(app.current_unit_price(p_tenant,unit,now())*p_payment_input_value/100,2);
    ELSE calculated_amount:=round(p_payment_input_value,2); END IF;
    IF calculated_amount<=0 THEN RAISE EXCEPTION 'current unit price and payment amount must be positive'; END IF;
  ELSIF p_payment_calculation_type IS NOT NULL OR p_payment_input_value IS NOT NULL OR p_payment_due_at IS NOT NULL THEN
    RAISE EXCEPTION 'payment terms are supported only for RS and SBK';
  END IF;
  created_contract:=app.create_contract(p_tenant,p_case,p_type,p_reference,p_title,p_actor_membership,p_parent_contract);
  UPDATE contracts SET idempotency_key=p_idempotency_key,payment_calculation_type=p_payment_calculation_type,payment_input_value=p_payment_input_value,
    payment_amount=calculated_amount,payment_due_at=p_payment_due_at,
    reservation_fee_amount=CASE WHEN p_type='rs' THEN calculated_amount ELSE reservation_fee_amount END,
    reservation_fee_due_days=CASE WHEN p_type='rs' THEN GREATEST(1,LEAST(30,ceil(extract(epoch FROM (p_payment_due_at-now()))/86400)::integer)) ELSE reservation_fee_due_days END
  WHERE tenant_id=p_tenant AND id=created_contract;
  SELECT version.id INTO created_version FROM contract_versions version WHERE version.tenant_id=p_tenant AND version.contract_id=created_contract AND version.version_number=1;
  IF p_type IN ('rs','sbk') THEN
    SELECT participant.party_id INTO party FROM sales_case_parties participant
      WHERE participant.tenant_id=p_tenant AND participant.sales_case_id=p_case AND participant.left_at IS NULL AND participant.participant_role IN ('buyer','co_buyer')
      ORDER BY participant.is_primary DESC,participant.joined_at LIMIT 1;
    IF party IS NULL THEN RAISE EXCEPTION 'payment contract requires a buyer'; END IF;
    obligation_type:=CASE p_type WHEN 'rs' THEN 'reservation_fee' ELSE 'purchase_installment' END;
    obligation_label:=CASE p_type WHEN 'rs' THEN 'Rezervační poplatek' ELSE 'Platba při SBK' END;
    INSERT INTO payment_obligations(tenant_id,project_id,unit_id,party_id,sales_case_id,contract_id,obligation_type,label,amount,due_at,variable_symbol,idempotency_key,created_by_membership_id)
    VALUES(p_tenant,project,unit,party,p_case,created_contract,obligation_type,obligation_label,calculated_amount,p_payment_due_at,
      regexp_replace(p_reference,'\D','','g'),CASE p_type WHEN 'rs' THEN 'rs-fee:' ELSE 'sbk-payment:' END||created_contract,p_actor_membership)
    RETURNING id INTO created_obligation;
    SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership;
    INSERT INTO payment_events(tenant_id,project_id,obligation_id,event_type,payload,recorded_by_membership_id)
    VALUES(p_tenant,project,created_obligation,'obligation.created',jsonb_build_object('amount',calculated_amount,'source','contract_creation','calculationType',p_payment_calculation_type,'inputValue',p_payment_input_value),p_actor_membership);
    INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data,metadata)
    VALUES(p_tenant,actor,'payment.obligation_created','payment_obligation',created_obligation,
      jsonb_build_object('amount',calculated_amount,'contractId',created_contract,'calculationType',p_payment_calculation_type,'inputValue',p_payment_input_value,'dueAt',p_payment_due_at),
      jsonb_build_object('projectId',project,'unitId',unit,'salesCaseId',p_case));
    INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
    VALUES(p_tenant,'payment_obligation',created_obligation,'payment.obligation_created.v1',jsonb_build_object('obligationId',created_obligation,'unitId',unit,'contractId',created_contract,'amount',calculated_amount));
  END IF;
  RETURN QUERY SELECT created_contract,created_version,created_obligation,calculated_amount;
END $$;

CREATE OR REPLACE FUNCTION app.ensure_rs_reservation_fee() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE case_party uuid;fee_amount numeric;fee_days integer;obligation_id uuid;actor uuid;
BEGIN
  IF NEW.current_status='signed' AND OLD.current_status IS DISTINCT FROM 'signed' AND NEW.contract_type='rs'
     AND NOT EXISTS(SELECT 1 FROM payment_obligations obligation WHERE obligation.tenant_id=NEW.tenant_id AND obligation.contract_id=NEW.id AND obligation.obligation_type='reservation_fee' AND obligation.cancelled_at IS NULL) THEN
    SELECT party_id INTO case_party FROM sales_case_parties WHERE tenant_id=NEW.tenant_id AND sales_case_id=NEW.sales_case_id AND participant_role IN ('buyer','co_buyer') ORDER BY is_primary DESC,joined_at LIMIT 1;
    fee_amount:=COALESCE(NEW.reservation_fee_amount,250000);fee_days:=NEW.reservation_fee_due_days;
    SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=NEW.tenant_id AND id=NEW.created_by_membership_id;
    INSERT INTO payment_obligations(tenant_id,project_id,unit_id,party_id,sales_case_id,contract_id,obligation_type,label,amount,due_at,variable_symbol,idempotency_key,created_by_membership_id)
    VALUES(NEW.tenant_id,NEW.project_id,NEW.unit_id,case_party,NEW.sales_case_id,NEW.id,'reservation_fee','Rezervační poplatek',fee_amount,now()+make_interval(days=>fee_days),regexp_replace(NEW.reference,'\D','','g'),'rs-fee:'||NEW.id,NEW.created_by_membership_id)
    ON CONFLICT (tenant_id,idempotency_key) DO NOTHING RETURNING id INTO obligation_id;
    IF obligation_id IS NOT NULL THEN
      INSERT INTO payment_events(tenant_id,project_id,obligation_id,event_type,payload,recorded_by_membership_id) VALUES(NEW.tenant_id,NEW.project_id,obligation_id,'obligation.created',jsonb_build_object('amount',fee_amount,'source','signed_rs'),NEW.created_by_membership_id);
      INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data,metadata) VALUES(NEW.tenant_id,actor,'payment.obligation_created','payment_obligation',obligation_id,jsonb_build_object('amount',fee_amount,'contractId',NEW.id),jsonb_build_object('projectId',NEW.project_id,'unitId',NEW.unit_id,'salesCaseId',NEW.sales_case_id));
      INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload) VALUES(NEW.tenant_id,'payment_obligation',obligation_id,'payment.obligation_created.v1',jsonb_build_object('obligationId',obligation_id,'unitId',NEW.unit_id,'contractId',NEW.id,'amount',fee_amount));
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.transition_contract_status(
  p_tenant uuid,p_contract uuid,p_to text,p_reason text,p_actor_membership uuid
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE old_state text;project uuid;actor uuid;event_id uuid:=gen_random_uuid();allowed boolean:=false;required_permission text:='contract.manage';latest_version uuid;reason_text text:=COALESCE(NULLIF(btrim(p_reason),''),'Změna stavu smlouvy');
BEGIN
  SELECT current_status,project_id INTO old_state,project FROM contracts WHERE tenant_id=p_tenant AND id=p_contract FOR UPDATE;
  SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF old_state IS NULL OR actor IS NULL THEN RAISE EXCEPTION 'contract or actor not found'; END IF;
  IF p_to='signed' THEN RAISE EXCEPTION 'signed status is reached only by completing required signatures'; END IF;
  allowed:=CASE old_state WHEN 'draft' THEN p_to IN ('sent','cancelled') WHEN 'sent' THEN p_to IN ('negotiation','approved','cancelled') WHEN 'negotiation' THEN p_to IN ('sent','approved','cancelled') WHEN 'approved' THEN p_to IN ('signing','negotiation','cancelled') WHEN 'signing' THEN p_to IN ('negotiation','cancelled') WHEN 'signed' THEN p_to='terminated' ELSE false END;
  IF NOT allowed THEN RAISE EXCEPTION 'contract workflow transition is not allowed'; END IF;
  IF p_to IN ('approved','signing') THEN required_permission:=CASE p_to WHEN 'approved' THEN 'contract.approve' ELSE 'contract.sign' END; END IF;
  IF NOT app.has_project_permission(p_tenant,p_actor_membership,project,required_permission) THEN RAISE EXCEPTION '% permission required',required_permission; END IF;
  SELECT id INTO latest_version FROM contract_versions WHERE tenant_id=p_tenant AND contract_id=p_contract ORDER BY version_number DESC LIMIT 1;
  IF p_to IN ('approved','signing') AND latest_version IS NULL THEN RAISE EXCEPTION 'contract requires a logical version'; END IF;
  IF p_to='approved' THEN UPDATE contract_versions SET version_status='approved_for_signing',approved_at=now() WHERE tenant_id=p_tenant AND id=latest_version AND version_status='working'; END IF;
  IF p_to='signing' AND NOT EXISTS(SELECT 1 FROM contract_versions WHERE tenant_id=p_tenant AND id=latest_version AND version_status='approved_for_signing') THEN RAISE EXCEPTION 'latest version must be approved for signing'; END IF;
  PERFORM set_config('app.contract_status_command','on',true);
  UPDATE contracts SET current_status=p_to,ended_at=CASE WHEN p_to IN ('cancelled','terminated') THEN now() ELSE NULL END,end_reason=CASE WHEN p_to IN ('cancelled','terminated') THEN reason_text ELSE NULL END WHERE tenant_id=p_tenant AND id=p_contract;
  INSERT INTO contract_status_events(id,tenant_id,project_id,contract_id,from_status,to_status,command,reason,recorded_by_membership_id) VALUES(event_id,p_tenant,project,p_contract,old_state,p_to,CASE p_to WHEN 'terminated' THEN 'terminateContract' WHEN 'cancelled' THEN 'cancelContract' ELSE 'transitionContract' END,reason_text,p_actor_membership);
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data,metadata) VALUES(p_tenant,actor,'contract.status_changed','contract',p_contract,jsonb_build_object('status',old_state),jsonb_build_object('status',p_to,'reason',reason_text),jsonb_build_object('projectId',project));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload) VALUES(p_tenant,'contract',p_contract,'contract.status_changed.v1',jsonb_build_object('contractId',p_contract,'from',old_state,'to',p_to));
  RETURN event_id;
END $$;

GRANT EXECUTE ON FUNCTION app.create_contract_with_payment(uuid,uuid,text,text,text,uuid,uuid,text,text,numeric,timestamptz) TO develocrm_app;

COMMIT;

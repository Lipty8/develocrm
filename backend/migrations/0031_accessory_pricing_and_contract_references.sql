BEGIN;

-- Příslušenství má vlastní append-only cenu a obchodní cena jednotky je jediná
-- sdílená projekce ceny bytu a právě aktivních položek příslušenství.
CREATE OR REPLACE FUNCTION app.current_accessory_price(
  p_tenant uuid,p_accessory uuid,p_at timestamptz DEFAULT now()
) RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT COALESCE((
    SELECT price.amount FROM accessory_price_history price
    WHERE price.tenant_id=p_tenant AND price.accessory_id=p_accessory AND price.valid_from<=p_at
    ORDER BY price.valid_from DESC,price.recorded_at DESC,price.id DESC LIMIT 1
  ),0)
$$;

CREATE OR REPLACE FUNCTION app.current_unit_accessory_price(
  p_tenant uuid,p_unit uuid,p_at timestamptz DEFAULT now()
) RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT COALESCE(sum(app.current_accessory_price(assignment.tenant_id,assignment.accessory_id,p_at)),0)
  FROM unit_accessory_assignments assignment
  JOIN accessories accessory ON accessory.tenant_id=assignment.tenant_id AND accessory.id=assignment.accessory_id
  WHERE assignment.tenant_id=p_tenant AND assignment.unit_id=p_unit
    AND assignment.valid_from<=p_at AND (assignment.valid_to IS NULL OR assignment.valid_to>p_at)
    AND accessory.archived_at IS NULL AND accessory.operational_status='active'
$$;

CREATE OR REPLACE FUNCTION app.current_unit_sales_price(
  p_tenant uuid,p_unit uuid,p_at timestamptz DEFAULT now()
) RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT app.current_unit_price(p_tenant,p_unit,p_at)+app.current_unit_accessory_price(p_tenant,p_unit,p_at)
$$;

ALTER TABLE contracts
  ADD COLUMN unit_price_snapshot numeric(15,2),
  ADD COLUMN accessory_price_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN total_price_snapshot numeric(15,2);

ALTER TABLE contracts ADD CONSTRAINT contracts_price_snapshot_shape CHECK (
  (unit_price_snapshot IS NULL AND total_price_snapshot IS NULL AND accessory_price_snapshot='[]'::jsonb)
  OR
  (unit_price_snapshot>=0 AND total_price_snapshot>=unit_price_snapshot AND jsonb_typeof(accessory_price_snapshot)='array')
);

-- Každá nová reference je v tenantovi jedinečná. Stejný uživatelský základ
-- dostane pod transakčním zámkem deterministický suffix -02, -03, ...
CREATE OR REPLACE FUNCTION app.ensure_unique_contract_reference()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE base_reference text:=NULLIF(btrim(NEW.reference),'');candidate text;sequence_number integer:=1;
BEGIN
  IF base_reference IS NULL THEN RAISE EXCEPTION 'contract reference is required';END IF;
  PERFORM pg_advisory_xact_lock(hashtext(NEW.tenant_id::text||':contract-reference:'||lower(base_reference)));
  candidate:=base_reference;
  WHILE EXISTS(SELECT 1 FROM contracts contract WHERE contract.tenant_id=NEW.tenant_id AND lower(contract.reference)=lower(candidate)) LOOP
    sequence_number:=sequence_number+1;
    candidate:=base_reference||'-'||lpad(sequence_number::text,2,'0');
  END LOOP;
  NEW.reference:=candidate;
  RETURN NEW;
END $$;

CREATE TRIGGER contracts_unique_reference_allocator
BEFORE INSERT ON contracts FOR EACH ROW EXECUTE FUNCTION app.ensure_unique_contract_reference();

-- Ukončení přiřazení je jediná povolená změna historie. Aplikační role má jen
-- sloupcové UPDATE oprávnění a trigger jej pustí výhradně z doménové operace.
CREATE OR REPLACE FUNCTION app.guard_accessory_assignment_history()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'unit accessory assignment history is append-only';END IF;
  IF current_setting('app.accessory_assignment_command',true) IS DISTINCT FROM 'on'
    OR (to_jsonb(NEW)-'valid_to') IS DISTINCT FROM (to_jsonb(OLD)-'valid_to')
    OR OLD.valid_to IS NOT NULL OR NEW.valid_to IS NULL OR NEW.valid_to<=NEW.valid_from
  THEN RAISE EXCEPTION 'unit accessory assignment can only be released by a domain command';END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER unit_accessory_assignment_history_guard
BEFORE UPDATE OR DELETE ON unit_accessory_assignments FOR EACH ROW EXECUTE FUNCTION app.guard_accessory_assignment_history();

-- Standardní položku lze založit rovnou s první historickou cenou. Wallbox je
-- běžný accessory type a volitelná vazba na parking používá accessory_relations.
CREATE OR REPLACE FUNCTION app.create_project_accessory(
  p_tenant uuid,p_project uuid,p_category text,p_code text,p_area numeric,p_amount numeric,
  p_amount_net numeric,p_related_accessory uuid,p_actor uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE type_id uuid;accessory_id uuid:=gen_random_uuid();price_id uuid:=gen_random_uuid();actor_user uuid;type_name text;
BEGIN
  IF p_category NOT IN ('parking','cellar','wallbox') THEN RAISE EXCEPTION 'unsupported accessory category';END IF;
  IF NULLIF(btrim(p_code),'') IS NULL OR p_amount<0 OR (p_amount_net IS NOT NULL AND (p_amount_net<0 OR p_amount_net>p_amount)) THEN RAISE EXCEPTION 'invalid accessory data';END IF;
  IF NOT app.has_project_permission(p_tenant,p_actor,p_project,'accessory.manage') THEN RAISE EXCEPTION 'accessory.manage permission required';END IF;
  SELECT user_id INTO actor_user FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor AND status='active';
  IF actor_user IS NULL THEN RAISE EXCEPTION 'active actor membership required';END IF;
  type_name:=CASE p_category WHEN 'parking' THEN 'Parkovací stání' WHEN 'cellar' THEN 'Sklep' ELSE 'Wallbox' END;
  SELECT id INTO type_id FROM accessory_types WHERE tenant_id=p_tenant AND code=p_category AND archived_at IS NULL;
  IF type_id IS NULL THEN
    INSERT INTO accessory_types(tenant_id,code,name,category,allows_sharing)
    VALUES(p_tenant,p_category,type_name,p_category,false) RETURNING id INTO type_id;
  END IF;
  INSERT INTO accessories(id,tenant_id,project_id,accessory_type_id,code,area_m2)
  VALUES(accessory_id,p_tenant,p_project,type_id,btrim(p_code),p_area);
  INSERT INTO accessory_price_history(id,tenant_id,project_id,accessory_id,amount,amount_net,currency,valid_from,reason,recorded_by_membership_id)
  VALUES(price_id,p_tenant,p_project,accessory_id,p_amount,p_amount_net,'CZK',now(),'První ceníková cena příslušenství',p_actor);
  IF p_related_accessory IS NOT NULL THEN
    IF p_category<>'wallbox' OR NOT EXISTS(
      SELECT 1 FROM accessories target JOIN accessory_types target_type ON target_type.tenant_id=target.tenant_id AND target_type.id=target.accessory_type_id
      WHERE target.tenant_id=p_tenant AND target.project_id=p_project AND target.id=p_related_accessory AND target.archived_at IS NULL AND target_type.category='parking'
    ) THEN RAISE EXCEPTION 'wallbox relation requires parking in the same project';END IF;
    INSERT INTO accessory_relations(tenant_id,project_id,source_accessory_id,target_accessory_id,relation_type)
    VALUES(p_tenant,p_project,accessory_id,p_related_accessory,'installed_at');
  END IF;
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data,metadata)
  VALUES(p_tenant,actor_user,'accessory.created','accessory',accessory_id,
    jsonb_build_object('projectId',p_project,'category',p_category,'code',btrim(p_code),'price',p_amount,'relatedAccessoryId',p_related_accessory),
    jsonb_build_object('projectId',p_project));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'accessory',accessory_id,'accessory.created.v1',jsonb_build_object('accessoryId',accessory_id,'projectId',p_project,'price',p_amount));
  RETURN accessory_id;
END $$;

CREATE OR REPLACE FUNCTION app.assign_accessory_to_unit(p_tenant uuid,p_unit uuid,p_accessory uuid,p_from timestamptz,p_actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_project uuid;accessory_project uuid;assignment_id uuid;actor_user uuid;sharing boolean;effective_from timestamptz:=COALESCE(p_from,now());before_total numeric;after_total numeric;
BEGIN
  SELECT project_id INTO v_project FROM units WHERE tenant_id=p_tenant AND id=p_unit FOR UPDATE;
  SELECT accessory.project_id,type.allows_sharing INTO accessory_project,sharing FROM accessories accessory
    JOIN accessory_types type ON type.tenant_id=accessory.tenant_id AND type.id=accessory.accessory_type_id
    WHERE accessory.tenant_id=p_tenant AND accessory.id=p_accessory AND accessory.operational_status='active' AND accessory.archived_at IS NULL FOR UPDATE OF accessory;
  IF v_project IS NULL OR accessory_project IS NULL OR v_project<>accessory_project OR NOT app.has_project_permission(p_tenant,p_actor,v_project,'accessory.manage') THEN RAISE EXCEPTION 'accessory.manage permission required';END IF;
  IF NOT sharing AND EXISTS(SELECT 1 FROM unit_accessory_assignments assignment WHERE assignment.tenant_id=p_tenant AND assignment.accessory_id=p_accessory AND assignment.valid_from<=effective_from AND (assignment.valid_to IS NULL OR assignment.valid_to>effective_from)) THEN RAISE EXCEPTION 'accessory is already assigned';END IF;
  before_total:=app.current_unit_sales_price(p_tenant,p_unit,effective_from);
  INSERT INTO unit_accessory_assignments(tenant_id,project_id,unit_id,accessory_id,valid_from,assigned_by_membership_id)
  VALUES(p_tenant,v_project,p_unit,p_accessory,effective_from,p_actor) RETURNING id INTO assignment_id;
  after_total:=app.current_unit_sales_price(p_tenant,p_unit,effective_from);
  SELECT user_id INTO actor_user FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor;
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data,metadata)
  VALUES(p_tenant,actor_user,'accessory.assigned','unit_accessory_assignment',assignment_id,
    jsonb_build_object('unitId',p_unit,'accessoryId',p_accessory,'price',app.current_accessory_price(p_tenant,p_accessory,effective_from),'totalBefore',before_total,'totalAfter',after_total),
    jsonb_build_object('projectId',v_project,'unitId',p_unit));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'unit',p_unit,'accessory.assigned.v1',jsonb_build_object('assignmentId',assignment_id,'accessoryId',p_accessory,'totalPrice',after_total));
  RETURN assignment_id;
END $$;

CREATE OR REPLACE FUNCTION app.remove_accessory_from_unit(p_tenant uuid,p_assignment uuid,p_to timestamptz,p_actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_project uuid;current_unit_id uuid;current_accessory_id uuid;actor_user uuid;effective_to timestamptz:=COALESCE(p_to,now());before_total numeric;after_total numeric;existing_to timestamptz;
BEGIN
  SELECT assignment.project_id,assignment.unit_id,assignment.accessory_id,assignment.valid_to INTO v_project,current_unit_id,current_accessory_id,existing_to
  FROM unit_accessory_assignments assignment WHERE assignment.tenant_id=p_tenant AND assignment.id=p_assignment FOR UPDATE;
  IF v_project IS NULL OR NOT app.has_project_permission(p_tenant,p_actor,v_project,'accessory.manage') THEN RAISE EXCEPTION 'accessory.manage permission required';END IF;
  IF existing_to IS NOT NULL AND existing_to<=effective_to THEN RETURN p_assignment;END IF;
  before_total:=app.current_unit_sales_price(p_tenant,current_unit_id,effective_to);
  PERFORM set_config('app.accessory_assignment_command','on',true);
  UPDATE unit_accessory_assignments SET valid_to=effective_to WHERE tenant_id=p_tenant AND id=p_assignment AND (valid_to IS NULL OR valid_to>effective_to);
  PERFORM set_config('app.accessory_assignment_command','off',true);
  after_total:=app.current_unit_sales_price(p_tenant,current_unit_id,effective_to);
  SELECT user_id INTO actor_user FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor;
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data,metadata)
  VALUES(p_tenant,actor_user,'accessory.removed','unit_accessory_assignment',p_assignment,
    jsonb_build_object('validTo',effective_to,'unitId',current_unit_id,'accessoryId',current_accessory_id,'totalBefore',before_total,'totalAfter',after_total),
    jsonb_build_object('projectId',v_project,'unitId',current_unit_id));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'unit',current_unit_id,'accessory.removed.v1',jsonb_build_object('assignmentId',p_assignment,'accessoryId',current_accessory_id,'totalPrice',after_total));
  RETURN p_assignment;
END $$;

CREATE OR REPLACE FUNCTION app.create_contract(
  p_tenant uuid,p_case uuid,p_type text,p_reference text,p_title text,p_actor_membership uuid,p_parent_contract uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE project uuid;unit uuid;actor uuid;contract_id uuid:=gen_random_uuid();version_id uuid:=gen_random_uuid();unit_price numeric;accessory_snapshot jsonb;total_price numeric;
BEGIN
  SELECT project_id,unit_id INTO project,unit FROM sales_cases WHERE tenant_id=p_tenant AND id=p_case AND status='active' FOR UPDATE;
  SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF project IS NULL OR actor IS NULL OR NOT app.has_project_permission(p_tenant,p_actor_membership,project,'contract.manage') THEN RAISE EXCEPTION 'contract.manage permission required';END IF;
  IF p_type='amendment' AND (p_parent_contract IS NULL OR NOT EXISTS(SELECT 1 FROM contracts WHERE tenant_id=p_tenant AND project_id=project AND id=p_parent_contract AND unit_id=unit)) THEN RAISE EXCEPTION 'amendment requires parent contract in the same sales case';END IF;
  IF p_type<>'amendment' AND p_parent_contract IS NOT NULL THEN RAISE EXCEPTION 'only amendment may have a parent contract';END IF;
  IF p_type IN ('rs','sbk','ks') AND EXISTS(SELECT 1 FROM contracts WHERE tenant_id=p_tenant AND sales_case_id=p_case AND contract_type=p_type AND current_status NOT IN ('cancelled','terminated')) THEN RAISE EXCEPTION 'active contract of this type already exists';END IF;
  unit_price:=app.current_unit_price(p_tenant,unit,now());
  SELECT COALESCE(jsonb_agg(jsonb_build_object('accessoryId',accessory.id,'code',accessory.code,'type',type.category,'amount',app.current_accessory_price(p_tenant,accessory.id,now())) ORDER BY type.category,accessory.code),'[]'::jsonb)
    INTO accessory_snapshot
  FROM unit_accessory_assignments assignment JOIN accessories accessory ON accessory.tenant_id=assignment.tenant_id AND accessory.id=assignment.accessory_id
  JOIN accessory_types type ON type.tenant_id=accessory.tenant_id AND type.id=accessory.accessory_type_id
  WHERE assignment.tenant_id=p_tenant AND assignment.unit_id=unit AND assignment.valid_from<=now() AND (assignment.valid_to IS NULL OR assignment.valid_to>now()) AND accessory.archived_at IS NULL;
  total_price:=unit_price+COALESCE((SELECT sum((item->>'amount')::numeric) FROM jsonb_array_elements(accessory_snapshot) item),0);
  INSERT INTO contracts(id,tenant_id,project_id,unit_id,sales_case_id,contract_type,parent_contract_id,reference,title,created_by_membership_id,unit_price_snapshot,accessory_price_snapshot,total_price_snapshot)
  VALUES(contract_id,p_tenant,project,unit,p_case,p_type,p_parent_contract,btrim(p_reference),btrim(p_title),p_actor_membership,unit_price,accessory_snapshot,total_price);
  INSERT INTO contract_versions(id,tenant_id,project_id,contract_id,version_number,source_type,display_name,generation_payload,created_by_membership_id)
  SELECT version_id,p_tenant,project,contract_id,1,'manual',contract.reference||'_v01',jsonb_build_object('source','contract_creation','priceBasis',total_price,'unitPrice',unit_price,'accessories',accessory_snapshot),p_actor_membership FROM contracts contract WHERE contract.id=contract_id;
  INSERT INTO contract_parties(tenant_id,project_id,contract_id,party_id,participant_role,signing_required)
  SELECT p_tenant,project,contract_id,participant.party_id,CASE participant.participant_role WHEN 'buyer' THEN 'buyer' WHEN 'co_buyer' THEN 'co_buyer' WHEN 'representative' THEN 'representative' ELSE 'other' END,participant.participant_role IN ('buyer','co_buyer')
  FROM sales_case_parties participant WHERE participant.tenant_id=p_tenant AND participant.sales_case_id=p_case AND participant.left_at IS NULL;
  INSERT INTO contract_status_events(tenant_id,project_id,contract_id,from_status,to_status,command,reason,recorded_by_membership_id)
  VALUES(p_tenant,project,contract_id,NULL,'draft','createContract','Smlouva vytvořena',p_actor_membership);
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data,metadata)
  VALUES(p_tenant,actor,'contract.created','contract',contract_id,jsonb_build_object('type',p_type,'unitId',unit,'salesCaseId',p_case,'versionId',version_id,'unitPrice',unit_price,'accessories',accessory_snapshot,'totalPrice',total_price),jsonb_build_object('projectId',project,'unitId',unit));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'contract',contract_id,'contract.created.v1',jsonb_build_object('contractId',contract_id,'type',p_type,'unitId',unit,'versionId',version_id,'totalPrice',total_price));
  RETURN contract_id;
END $$;

CREATE OR REPLACE FUNCTION app.create_contract_with_payment(
  p_tenant uuid,p_case uuid,p_type text,p_reference text,p_title text,p_actor_membership uuid,p_parent_contract uuid,
  p_idempotency_key text,p_payment_calculation_type text,p_payment_input_value numeric,p_payment_due_at timestamptz
) RETURNS TABLE(contract_id uuid,version_id uuid,payment_obligation_id uuid,payment_amount numeric) LANGUAGE plpgsql AS $$
DECLARE project uuid;unit uuid;party uuid;actor uuid;created_contract uuid;created_version uuid;created_obligation uuid;calculated_amount numeric;obligation_type text;obligation_label text;price_basis numeric;
BEGIN
  SELECT id INTO created_contract FROM contracts WHERE tenant_id=p_tenant AND idempotency_key=p_idempotency_key;
  IF created_contract IS NOT NULL THEN
    SELECT version.id INTO created_version FROM contract_versions version WHERE version.tenant_id=p_tenant AND version.contract_id=created_contract ORDER BY version.version_number LIMIT 1;
    SELECT obligation.id,obligation.amount INTO created_obligation,calculated_amount FROM payment_obligations obligation WHERE obligation.tenant_id=p_tenant AND obligation.contract_id=created_contract AND obligation.cancelled_at IS NULL ORDER BY obligation.created_at LIMIT 1;
    RETURN QUERY SELECT created_contract,created_version,created_obligation,calculated_amount;RETURN;
  END IF;
  IF NULLIF(btrim(p_idempotency_key),'') IS NULL THEN RAISE EXCEPTION 'contract idempotency key is required';END IF;
  SELECT sales_case.project_id,sales_case.unit_id INTO project,unit FROM sales_cases sales_case WHERE sales_case.tenant_id=p_tenant AND sales_case.id=p_case AND sales_case.status='active' FOR UPDATE;
  IF project IS NULL THEN RAISE EXCEPTION 'active sales case is required';END IF;
  price_basis:=app.current_unit_sales_price(p_tenant,unit,now());
  IF p_type IN ('rs','sbk') THEN
    IF p_payment_calculation_type NOT IN ('percentage','fixed') OR p_payment_input_value<=0 OR p_payment_due_at<=now() THEN RAISE EXCEPTION 'valid payment terms are required for RS and SBK';END IF;
    calculated_amount:=CASE p_payment_calculation_type WHEN 'percentage' THEN round(price_basis*p_payment_input_value/100,2) ELSE round(p_payment_input_value,2) END;
    IF calculated_amount<=0 THEN RAISE EXCEPTION 'current sales price and payment amount must be positive';END IF;
  ELSIF p_payment_calculation_type IS NOT NULL OR p_payment_input_value IS NOT NULL OR p_payment_due_at IS NOT NULL THEN RAISE EXCEPTION 'payment terms are supported only for RS and SBK';END IF;
  created_contract:=app.create_contract(p_tenant,p_case,p_type,p_reference,p_title,p_actor_membership,p_parent_contract);
  UPDATE contracts SET idempotency_key=p_idempotency_key,payment_calculation_type=p_payment_calculation_type,payment_input_value=p_payment_input_value,payment_amount=calculated_amount,payment_due_at=p_payment_due_at,
    reservation_fee_amount=CASE WHEN p_type='rs' THEN calculated_amount ELSE reservation_fee_amount END,
    reservation_fee_due_days=CASE WHEN p_type='rs' THEN GREATEST(1,LEAST(30,ceil(extract(epoch FROM (p_payment_due_at-now()))/86400)::integer)) ELSE reservation_fee_due_days END
  WHERE tenant_id=p_tenant AND id=created_contract;
  SELECT version.id INTO created_version FROM contract_versions version WHERE version.tenant_id=p_tenant AND version.contract_id=created_contract AND version.version_number=1;
  IF p_type IN ('rs','sbk') THEN
    SELECT participant.party_id INTO party FROM sales_case_parties participant WHERE participant.tenant_id=p_tenant AND participant.sales_case_id=p_case AND participant.left_at IS NULL AND participant.participant_role IN ('buyer','co_buyer') ORDER BY participant.is_primary DESC,participant.joined_at LIMIT 1;
    IF party IS NULL THEN RAISE EXCEPTION 'payment contract requires a buyer';END IF;
    obligation_type:=CASE p_type WHEN 'rs' THEN 'reservation_fee' ELSE 'purchase_installment' END;obligation_label:=CASE p_type WHEN 'rs' THEN 'Rezervační poplatek' ELSE 'Platba při SBK' END;
    INSERT INTO payment_obligations(tenant_id,project_id,unit_id,party_id,sales_case_id,contract_id,obligation_type,label,amount,due_at,variable_symbol,idempotency_key,created_by_membership_id)
    SELECT p_tenant,project,unit,party,p_case,created_contract,obligation_type,obligation_label,calculated_amount,p_payment_due_at,regexp_replace(contract.reference,'\D','','g'),CASE p_type WHEN 'rs' THEN 'rs-fee:' ELSE 'sbk-payment:' END||created_contract,p_actor_membership FROM contracts contract WHERE contract.id=created_contract
    RETURNING id INTO created_obligation;
    SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership;
    INSERT INTO payment_events(tenant_id,project_id,obligation_id,event_type,payload,recorded_by_membership_id) VALUES(p_tenant,project,created_obligation,'obligation.created',jsonb_build_object('amount',calculated_amount,'source','contract_creation','calculationType',p_payment_calculation_type,'inputValue',p_payment_input_value,'priceBasis',price_basis),p_actor_membership);
    INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data,metadata) VALUES(p_tenant,actor,'payment.obligation_created','payment_obligation',created_obligation,jsonb_build_object('amount',calculated_amount,'contractId',created_contract,'calculationType',p_payment_calculation_type,'inputValue',p_payment_input_value,'priceBasis',price_basis,'dueAt',p_payment_due_at),jsonb_build_object('projectId',project,'unitId',unit,'salesCaseId',p_case));
    INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload) VALUES(p_tenant,'payment_obligation',created_obligation,'payment.obligation_created.v1',jsonb_build_object('obligationId',created_obligation,'unitId',unit,'contractId',created_contract,'amount',calculated_amount,'priceBasis',price_basis));
  END IF;
  RETURN QUERY SELECT created_contract,created_version,created_obligation,calculated_amount;
END $$;

GRANT EXECUTE ON FUNCTION app.current_accessory_price(uuid,uuid,timestamptz) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.current_unit_accessory_price(uuid,uuid,timestamptz) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.current_unit_sales_price(uuid,uuid,timestamptz) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.create_project_accessory(uuid,uuid,text,text,numeric,numeric,numeric,uuid,uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.assign_accessory_to_unit(uuid,uuid,uuid,timestamptz,uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.remove_accessory_from_unit(uuid,uuid,timestamptz,uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.create_contract_with_payment(uuid,uuid,text,text,text,uuid,uuid,text,text,numeric,timestamptz) TO develocrm_app;
GRANT UPDATE(valid_to) ON unit_accessory_assignments TO develocrm_app;

COMMIT;

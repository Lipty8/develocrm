BEGIN;

-- Postoupení je samostatný právní dokument, nikoli přepis původní smlouvy.
ALTER TABLE contracts DROP CONSTRAINT contracts_contract_type_check;
ALTER TABLE contracts ADD CONSTRAINT contracts_contract_type_check
  CHECK (contract_type IN ('rs','sbk','ks','amendment','assignment_rs','assignment_sbk'));
ALTER TABLE contracts ADD COLUMN assignment_effective_at timestamptz;
ALTER TABLE contracts ADD CONSTRAINT contracts_assignment_shape CHECK (
  (contract_type IN ('assignment_rs','assignment_sbk') AND parent_contract_id IS NOT NULL AND assignment_effective_at IS NOT NULL)
  OR (contract_type NOT IN ('assignment_rs','assignment_sbk') AND assignment_effective_at IS NULL)
);

ALTER TABLE contracts DROP CONSTRAINT contracts_signed_shape;
ALTER TABLE contracts ADD CONSTRAINT contracts_signed_shape CHECK (
  current_status NOT IN ('signed','terminated') OR signed_at IS NOT NULL
);

ALTER TABLE contract_parties DROP CONSTRAINT contract_parties_participant_role_check;
ALTER TABLE contract_parties ADD CONSTRAINT contract_parties_participant_role_check
  CHECK (participant_role IN ('buyer','co_buyer','seller','representative','guarantor','assignor','assignee','other'));
ALTER TABLE contract_parties ADD COLUMN is_primary_buyer boolean NOT NULL DEFAULT false;
ALTER TABLE contract_parties ADD COLUMN ownership_share numeric(7,6)
  CHECK (ownership_share IS NULL OR (ownership_share>0 AND ownership_share<=1));

ALTER TABLE buyer_assignment_events ADD COLUMN source_contract_id uuid;
ALTER TABLE buyer_assignment_events ADD CONSTRAINT buyer_assignment_source_contract_fk
  FOREIGN KEY (tenant_id,project_id,source_contract_id) REFERENCES contracts(tenant_id,project_id,id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX buyer_assignment_source_contract_uq
  ON buyer_assignment_events(tenant_id,source_contract_id) WHERE source_contract_id IS NOT NULL;

CREATE UNIQUE INDEX contracts_one_pending_assignment_uq
  ON contracts(tenant_id,parent_contract_id)
  WHERE contract_type IN ('assignment_rs','assignment_sbk')
    AND current_status IN ('draft','sent','negotiation','approved','signing');

CREATE OR REPLACE FUNCTION app.create_contract_assignment(
  p_tenant uuid,p_unit uuid,p_buyers jsonb,p_actor_membership uuid,
  p_effective_at timestamptz,p_note text,p_idempotency_key text
) RETURNS TABLE(contract_id uuid,version_id uuid,contract_type text,parent_contract_id uuid) LANGUAGE plpgsql AS $$
DECLARE
  case_row sales_cases%ROWTYPE;parent_row contracts%ROWTYPE;actor uuid;created_contract uuid;created_version uuid;
  desired record;desired_count integer;primary_count integer;sequence_number integer;assignment_type text;
  reference_text text;title_text text;note_text text:=COALESCE(NULLIF(btrim(p_note),''),'Postoupení smlouvy');
BEGIN
  IF NULLIF(btrim(p_idempotency_key),'') IS NULL THEN RAISE EXCEPTION 'contract assignment idempotency key is required';END IF;
  SELECT existing.id,existing.contract_type,existing.parent_contract_id INTO created_contract,assignment_type,parent_contract_id
  FROM contracts existing WHERE existing.tenant_id=p_tenant AND existing.idempotency_key=p_idempotency_key;
  IF created_contract IS NOT NULL THEN
    SELECT existing_version.id INTO created_version FROM contract_versions existing_version
    WHERE existing_version.tenant_id=p_tenant AND existing_version.contract_id=created_contract ORDER BY existing_version.version_number LIMIT 1;
    RETURN QUERY SELECT created_contract,created_version,assignment_type,parent_contract_id;RETURN;
  END IF;
  SELECT sales_case.* INTO case_row FROM sales_cases sales_case
  WHERE sales_case.tenant_id=p_tenant AND sales_case.unit_id=p_unit AND sales_case.status='active'
  ORDER BY sales_case.opened_at DESC LIMIT 1 FOR UPDATE;
  SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF case_row.id IS NULL OR actor IS NULL OR NOT app.has_project_permission(p_tenant,p_actor_membership,case_row.project_id,'contract.manage')
    OR NOT app.has_project_permission(p_tenant,p_actor_membership,case_row.project_id,'sales_case.manage') THEN
    RAISE EXCEPTION 'contract.manage and sales_case.manage permissions required';
  END IF;
  IF EXISTS(SELECT 1 FROM contracts existing_contract WHERE existing_contract.tenant_id=p_tenant AND existing_contract.sales_case_id=case_row.id AND existing_contract.contract_type='ks' AND existing_contract.current_status='signed') THEN
    RAISE EXCEPTION 'a signed KS cannot be assigned by the RS/SBK workflow';
  END IF;
  SELECT contract.* INTO parent_row FROM contracts contract
  WHERE contract.tenant_id=p_tenant AND contract.sales_case_id=case_row.id
    AND contract.contract_type IN ('rs','sbk') AND contract.current_status='signed'
  ORDER BY CASE contract.contract_type WHEN 'sbk' THEN 2 ELSE 1 END DESC,contract.signed_at DESC,contract.id DESC LIMIT 1 FOR UPDATE;
  IF parent_row.id IS NULL THEN RAISE EXCEPTION 'a signed RS or SBK is required for assignment';END IF;
  assignment_type:=CASE parent_row.contract_type WHEN 'sbk' THEN 'assignment_sbk' ELSE 'assignment_rs' END;
  IF EXISTS(SELECT 1 FROM contracts existing_assignment WHERE existing_assignment.tenant_id=p_tenant AND existing_assignment.parent_contract_id=parent_row.id
    AND existing_assignment.contract_type=assignment_type AND existing_assignment.current_status IN ('draft','sent','negotiation','approved','signing')) THEN
    RAISE EXCEPTION 'an unfinished assignment already exists for this contract';
  END IF;
  IF p_effective_at IS NULL OR p_effective_at>now()+interval '1 day' THEN RAISE EXCEPTION 'valid assignment date is required';END IF;
  IF jsonb_typeof(COALESCE(p_buyers,'[]'::jsonb))<>'array' THEN RAISE EXCEPTION 'buyers must be an array';END IF;
  SELECT count(*),count(*) FILTER(WHERE COALESCE(item."isPrimary",false)) INTO desired_count,primary_count
  FROM jsonb_to_recordset(COALESCE(p_buyers,'[]'::jsonb)) AS item("partyId" text,role text,"isPrimary" boolean,share numeric);
  IF desired_count<1 OR primary_count<>1 THEN RAISE EXCEPTION 'one primary assignee is required';END IF;
  IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_buyers) AS item("partyId" text,role text,"isPrimary" boolean,share numeric)
    LEFT JOIN parties party ON party.tenant_id=p_tenant AND party.id=item."partyId"::uuid AND party.lifecycle_status='active' AND party.archived_at IS NULL
    WHERE party.id IS NULL OR item.role NOT IN ('buyer','co_buyer') OR (item.share IS NOT NULL AND (item.share<=0 OR item.share>1))) THEN
    RAISE EXCEPTION 'all assignees must be active clients';
  END IF;
  IF (SELECT count(DISTINCT item."partyId") FROM jsonb_to_recordset(p_buyers) AS item("partyId" text,role text,"isPrimary" boolean,share numeric))<>desired_count
    OR COALESCE((SELECT sum(item.share) FROM jsonb_to_recordset(p_buyers) AS item("partyId" text,role text,"isPrimary" boolean,share numeric)),0)>1 THEN
    RAISE EXCEPTION 'assignees must be unique and ownership shares valid';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_buyers) AS item("partyId" text,role text,"isPrimary" boolean,share numeric)
    JOIN sales_case_parties current_party ON current_party.tenant_id=p_tenant AND current_party.sales_case_id=case_row.id
      AND current_party.party_id=item."partyId"::uuid AND current_party.left_at IS NULL AND current_party.participant_role IN ('buyer','co_buyer')) THEN
    RAISE EXCEPTION 'the assignee must differ from the current buyer';
  END IF;

  SELECT count(*)+1 INTO sequence_number FROM contracts existing_assignment WHERE existing_assignment.tenant_id=p_tenant AND existing_assignment.sales_case_id=case_row.id AND existing_assignment.contract_type=assignment_type;
  created_contract:=gen_random_uuid();created_version:=gen_random_uuid();
  reference_text:=CASE assignment_type WHEN 'assignment_sbk' THEN 'POST-SBK ' ELSE 'POST-RS ' END||
    (SELECT code FROM units WHERE tenant_id=p_tenant AND id=p_unit)||'/'||sequence_number;
  title_text:=CASE assignment_type WHEN 'assignment_sbk' THEN 'Postoupení SBK' ELSE 'Postoupení RS' END||' · '||
    (SELECT code FROM units WHERE tenant_id=p_tenant AND id=p_unit);
  INSERT INTO contracts(id,tenant_id,project_id,unit_id,sales_case_id,contract_type,parent_contract_id,reference,title,
    created_by_membership_id,idempotency_key,assignment_effective_at)
  VALUES(created_contract,p_tenant,case_row.project_id,p_unit,case_row.id,assignment_type,parent_row.id,reference_text,title_text,
    p_actor_membership,btrim(p_idempotency_key),p_effective_at);
  INSERT INTO contract_versions(id,tenant_id,project_id,contract_id,version_number,source_type,display_name,generation_payload,created_by_membership_id)
  VALUES(created_version,p_tenant,case_row.project_id,created_contract,1,'manual',reference_text||'_v01',
    jsonb_build_object('source','contract_assignment','parentContractId',parent_row.id,'effectiveAt',p_effective_at,'note',note_text),p_actor_membership);
  INSERT INTO contract_parties(tenant_id,project_id,contract_id,party_id,participant_role,signing_required,signature_status,effective_from)
  SELECT p_tenant,case_row.project_id,created_contract,participant.party_id,'assignor',true,'pending',now()
  FROM sales_case_parties participant WHERE participant.tenant_id=p_tenant AND participant.sales_case_id=case_row.id
    AND participant.left_at IS NULL AND participant.participant_role IN ('buyer','co_buyer');
  FOR desired IN SELECT * FROM jsonb_to_recordset(p_buyers) AS item("partyId" text,role text,"isPrimary" boolean,share numeric)
  LOOP
    INSERT INTO contract_parties(tenant_id,project_id,contract_id,party_id,participant_role,signing_required,signature_status,
      effective_from,is_primary_buyer,ownership_share)
    VALUES(p_tenant,case_row.project_id,created_contract,desired."partyId"::uuid,'assignee',true,'pending',now(),COALESCE(desired."isPrimary",false),desired.share);
  END LOOP;
  INSERT INTO contract_status_events(tenant_id,project_id,contract_id,from_status,to_status,command,reason,recorded_by_membership_id)
  VALUES(p_tenant,case_row.project_id,created_contract,NULL,'draft','createContractAssignment',note_text,p_actor_membership);
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data,metadata)
  VALUES(p_tenant,actor,'contract.assignment_created','contract',created_contract,
    jsonb_build_object('type',assignment_type,'parentContractId',parent_row.id,'salesCaseId',case_row.id,'effectiveAt',p_effective_at),
    jsonb_build_object('projectId',case_row.project_id,'unitId',p_unit,'note',note_text));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'contract',created_contract,'contract.assignment_created.v1',jsonb_build_object(
    'contractId',created_contract,'type',assignment_type,'parentContractId',parent_row.id,'salesCaseId',case_row.id,'unitId',p_unit));
  RETURN QUERY SELECT created_contract,created_version,assignment_type,parent_row.id;
END $$;

CREATE OR REPLACE FUNCTION app.complete_contract_assignment(
  p_tenant uuid,p_contract uuid,p_actor_membership uuid,p_reason text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE contract_row contracts%ROWTYPE;parent_row contracts%ROWTYPE;case_row sales_cases%ROWTYPE;actor uuid;event_id uuid;
  previous_buyers jsonb;current_buyers jsonb;desired record;interest_id uuid;
  reason_text text:=COALESCE(NULLIF(btrim(p_reason),''),'Podepsané postoupení smlouvy');
BEGIN
  SELECT id INTO event_id FROM buyer_assignment_events WHERE tenant_id=p_tenant AND source_contract_id=p_contract;
  IF event_id IS NOT NULL THEN RETURN event_id;END IF;
  SELECT * INTO contract_row FROM contracts WHERE tenant_id=p_tenant AND id=p_contract FOR UPDATE;
  IF contract_row.id IS NULL OR contract_row.contract_type NOT IN ('assignment_rs','assignment_sbk') OR contract_row.current_status<>'signed' THEN
    RAISE EXCEPTION 'signed contract assignment is required';
  END IF;
  SELECT * INTO parent_row FROM contracts WHERE tenant_id=p_tenant AND id=contract_row.parent_contract_id FOR UPDATE;
  SELECT * INTO case_row FROM sales_cases WHERE tenant_id=p_tenant AND id=contract_row.sales_case_id FOR UPDATE;
  SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF parent_row.current_status<>'signed' OR case_row.status<>'active' OR actor IS NULL THEN RAISE EXCEPTION 'active case and signed parent contract are required';END IF;
  IF NOT ((contract_row.contract_type='assignment_rs' AND parent_row.contract_type='rs') OR
          (contract_row.contract_type='assignment_sbk' AND parent_row.contract_type='sbk')) THEN RAISE EXCEPTION 'assignment parent type mismatch';END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('partyId',party_id,'role',participant_role,'isPrimary',is_primary,'share',ownership_share)
    ORDER BY is_primary DESC,joined_at,id),'[]'::jsonb) INTO previous_buyers
  FROM sales_case_parties WHERE tenant_id=p_tenant AND sales_case_id=case_row.id AND left_at IS NULL AND participant_role IN ('buyer','co_buyer');
  SELECT COALESCE(jsonb_agg(jsonb_build_object('partyId',party_id,'role',CASE WHEN is_primary_buyer THEN 'buyer' ELSE 'co_buyer' END,
    'isPrimary',is_primary_buyer,'share',ownership_share) ORDER BY is_primary_buyer DESC,effective_from,id),'[]'::jsonb) INTO current_buyers
  FROM contract_parties WHERE tenant_id=p_tenant AND contract_id=p_contract AND participant_role='assignee' AND effective_to IS NULL;
  IF jsonb_array_length(current_buyers)<1 THEN RAISE EXCEPTION 'assignment requires an assignee';END IF;
  event_id:=gen_random_uuid();
  INSERT INTO buyer_assignment_events(id,tenant_id,project_id,unit_id,sales_case_id,effective_at,recorded_by_membership_id,
    reason,idempotency_key,previous_buyers,current_buyers,source_contract_id)
  VALUES(event_id,p_tenant,contract_row.project_id,contract_row.unit_id,case_row.id,contract_row.assignment_effective_at,
    p_actor_membership,reason_text,'contract-assignment:'||p_contract,previous_buyers,current_buyers,p_contract);
  UPDATE sales_case_parties SET left_at=now(),is_primary=false
  WHERE tenant_id=p_tenant AND sales_case_id=case_row.id AND left_at IS NULL AND participant_role IN ('buyer','co_buyer');
  FOR desired IN SELECT * FROM jsonb_to_recordset(current_buyers) AS item("partyId" text,role text,"isPrimary" boolean,share numeric)
  LOOP
    INSERT INTO sales_case_parties(tenant_id,project_id,sales_case_id,party_id,participant_role,ownership_share,is_primary,joined_at,left_at)
    VALUES(p_tenant,case_row.project_id,case_row.id,desired."partyId"::uuid,desired.role,desired.share,COALESCE(desired."isPrimary",false),now(),NULL)
    ON CONFLICT ON CONSTRAINT sales_case_party_uq DO UPDATE SET left_at=NULL,joined_at=now(),ownership_share=EXCLUDED.ownership_share,is_primary=EXCLUDED.is_primary;
    INSERT INTO party_project_links(tenant_id,project_id,party_id,relationship_type)
    SELECT p_tenant,case_row.project_id,desired."partyId"::uuid,'buyer'
    WHERE NOT EXISTS(SELECT 1 FROM party_project_links WHERE tenant_id=p_tenant AND project_id=case_row.project_id
      AND party_id=desired."partyId"::uuid AND relationship_type='buyer' AND valid_to IS NULL);
    INSERT INTO unit_interests(tenant_id,project_id,unit_id,party_id,status,first_interest_at,last_interest_at)
    VALUES(p_tenant,case_row.project_id,case_row.unit_id,desired."partyId"::uuid,'converted',now(),now())
    ON CONFLICT(tenant_id,unit_id,party_id) DO UPDATE SET status='converted',last_interest_at=EXCLUDED.last_interest_at RETURNING id INTO interest_id;
    INSERT INTO interest_events(tenant_id,project_id,unit_interest_id,sales_case_id,event_type,outcome,note,occurred_at,recorded_by_membership_id)
    VALUES(p_tenant,case_row.project_id,interest_id,case_row.id,'converted_to_sales_case','Postoupení smlouvy',reason_text,now(),p_actor_membership);
  END LOOP;
  INSERT INTO audit_log(id,tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data,metadata)
  VALUES(event_id,p_tenant,actor,'buyer_assignment.transferred','contract',p_contract,jsonb_build_object('buyers',previous_buyers),
    jsonb_build_object('buyers',current_buyers),jsonb_build_object('projectId',contract_row.project_id,'unitId',contract_row.unit_id,
    'salesCaseId',case_row.id,'parentContractId',parent_row.id,'effectiveAt',contract_row.assignment_effective_at));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'contract',p_contract,'contract.assignment_completed.v1',jsonb_build_object('contractId',p_contract,
    'parentContractId',parent_row.id,'salesCaseId',case_row.id,'unitId',contract_row.unit_id,'previousBuyers',previous_buyers,'currentBuyers',current_buyers));
  RETURN event_id;
END $$;

CREATE OR REPLACE FUNCTION app.synchronize_signed_contract(
  p_tenant uuid,p_contract uuid,p_actor_membership uuid,p_reason text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE contract_row contracts%ROWTYPE;unit_status text;reason_text text:=COALESCE(NULLIF(btrim(p_reason),''),'Podepsaná smlouva');
BEGIN
  SELECT * INTO contract_row FROM contracts WHERE tenant_id=p_tenant AND id=p_contract FOR UPDATE;
  IF contract_row.id IS NULL OR contract_row.current_status<>'signed' THEN RAISE EXCEPTION 'signed contract is required';END IF;
  IF contract_row.contract_type IN ('assignment_rs','assignment_sbk') THEN
    PERFORM app.complete_contract_assignment(p_tenant,p_contract,p_actor_membership,reason_text);RETURN;
  END IF;
  IF contract_row.contract_type='rs' THEN PERFORM app.ensure_signed_rs_reservation(p_tenant,p_contract,p_actor_membership,reason_text);RETURN;END IF;
  IF contract_row.contract_type NOT IN ('sbk','ks') THEN RETURN;END IF;
  PERFORM app.record_sales_stage(p_tenant,contract_row.sales_case_id,contract_row.contract_type,'contractSigned',reason_text,p_actor_membership);
  SELECT commercial_status INTO unit_status FROM units WHERE tenant_id=p_tenant AND id=contract_row.unit_id FOR UPDATE;
  IF contract_row.contract_type='sbk' AND unit_status='reserved' THEN
    PERFORM app.transition_unit_commercial_status(p_tenant,contract_row.unit_id,'contracted','activateFuturePurchaseContract',reason_text,p_actor_membership);
  ELSIF contract_row.contract_type='ks' THEN
    IF unit_status='reserved' AND EXISTS(SELECT 1 FROM contracts prior WHERE prior.tenant_id=p_tenant AND prior.sales_case_id=contract_row.sales_case_id AND prior.contract_type='sbk' AND prior.current_status='signed') THEN
      PERFORM app.transition_unit_commercial_status(p_tenant,contract_row.unit_id,'contracted','activateFuturePurchaseContract',reason_text,p_actor_membership);unit_status:='contracted';
    END IF;
    IF unit_status='contracted' THEN PERFORM app.transition_unit_commercial_status(p_tenant,contract_row.unit_id,'sold','confirmFinalContractEffective',reason_text,p_actor_membership);
    ELSIF unit_status<>'sold' THEN RAISE EXCEPTION 'signed KS requires a reserved unit with signed SBK or a contracted unit';END IF;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION app.rollback_ended_rs(
  p_tenant uuid,p_contract uuid,p_actor_membership uuid,p_reason text
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE contract_row contracts%ROWTYPE;unit_status text;actor uuid;obligation payment_obligations%ROWTYPE;paid_amount numeric;
BEGIN
  SELECT * INTO contract_row FROM contracts WHERE tenant_id=p_tenant AND id=p_contract FOR UPDATE;
  IF contract_row.id IS NULL OR contract_row.contract_type<>'rs' OR contract_row.current_status NOT IN ('cancelled','terminated') THEN RETURN;END IF;
  IF EXISTS(SELECT 1 FROM contracts later WHERE later.tenant_id=p_tenant AND later.sales_case_id=contract_row.sales_case_id
    AND later.contract_type IN ('sbk','ks') AND later.current_status='signed') THEN RETURN;END IF;
  SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  UPDATE unit_holds SET status='cancelled',ended_at=now() WHERE tenant_id=p_tenant AND sales_case_id=contract_row.sales_case_id AND status='active';
  FOR obligation IN SELECT * FROM payment_obligations WHERE tenant_id=p_tenant AND sales_case_id=contract_row.sales_case_id AND cancelled_at IS NULL FOR UPDATE
  LOOP
    paid_amount:=app.payment_obligation_paid(p_tenant,obligation.id);
    IF paid_amount=0 THEN
      UPDATE payment_obligations SET cancelled_at=now(),cancellation_reason=p_reason WHERE tenant_id=p_tenant AND id=obligation.id;
      INSERT INTO payment_events(tenant_id,project_id,obligation_id,event_type,payload,recorded_by_membership_id)
      VALUES(p_tenant,contract_row.project_id,obligation.id,'obligation.cancelled_by_case_end',jsonb_build_object('contractId',p_contract,'reason',p_reason),p_actor_membership);
    ELSE
      INSERT INTO payment_events(tenant_id,project_id,obligation_id,event_type,payload,recorded_by_membership_id)
      VALUES(p_tenant,contract_row.project_id,obligation.id,'obligation.retained_after_case_end',jsonb_build_object('contractId',p_contract,'paidAmount',paid_amount,'reason',p_reason),p_actor_membership);
    END IF;
  END LOOP;
  UPDATE sales_case_parties SET left_at=now(),is_primary=false WHERE tenant_id=p_tenant AND sales_case_id=contract_row.sales_case_id AND left_at IS NULL;
  UPDATE sales_cases SET status='cancelled',closed_at=now(),close_reason=p_reason,updated_at=now()
  WHERE tenant_id=p_tenant AND id=contract_row.sales_case_id AND status='active';
  SELECT commercial_status INTO unit_status FROM units WHERE tenant_id=p_tenant AND id=contract_row.unit_id FOR UPDATE;
  IF unit_status='reserved' AND NOT EXISTS(SELECT 1 FROM unit_holds WHERE tenant_id=p_tenant AND unit_id=contract_row.unit_id AND status='active') THEN
    PERFORM app.transition_unit_commercial_status(p_tenant,contract_row.unit_id,'available','cancelReservation',p_reason,p_actor_membership);
  END IF;
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data,metadata)
  VALUES(p_tenant,actor,'rs.commercial_process_cancelled','contract',p_contract,jsonb_build_object('salesCaseId',contract_row.sales_case_id,'unitId',contract_row.unit_id,'unitStatus','available'),
    jsonb_build_object('projectId',contract_row.project_id,'reason',p_reason));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'sales_case',contract_row.sales_case_id,'sales_case.cancelled_by_rs.v1',jsonb_build_object('salesCaseId',contract_row.sales_case_id,'contractId',p_contract,'unitId',contract_row.unit_id));
END $$;

CREATE OR REPLACE FUNCTION app.transition_contract_status(
  p_tenant uuid,p_contract uuid,p_to text,p_reason text,p_actor_membership uuid
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE old_state text;project uuid;actor uuid;event_id uuid:=gen_random_uuid();allowed boolean:=false;required_permission text:='contract.manage';latest_version uuid;contract_type text;reason_text text:=COALESCE(NULLIF(btrim(p_reason),''),'Změna stavu smlouvy');
BEGIN
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
  IF contract_type='rs' AND p_to IN ('cancelled','terminated') THEN PERFORM app.rollback_ended_rs(p_tenant,p_contract,p_actor_membership,reason_text);END IF;
  RETURN event_id;
END $$;

-- Přímá změna kupujícího již není veřejnou doménovou operací. Aktuální kupující
-- se změní pouze při podpisu samostatného dokumentu o postoupení.
CREATE OR REPLACE FUNCTION app.assign_sales_case_buyers(
  p_tenant uuid,p_case uuid,p_buyers jsonb,p_actor_membership uuid,p_reason text,p_idempotency_key text
) RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'buyer assignment requires a signed assignment contract';
END $$;

GRANT EXECUTE ON FUNCTION app.create_contract_assignment(uuid,uuid,jsonb,uuid,timestamptz,text,text) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.complete_contract_assignment(uuid,uuid,uuid,text) TO develocrm_app;

COMMIT;

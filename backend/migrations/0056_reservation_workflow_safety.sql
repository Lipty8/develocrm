BEGIN;

-- One serialization point for hold/signature operations, before contract/case/hold locks.
CREATE OR REPLACE FUNCTION app.lock_workflow_unit(p_tenant uuid,p_unit uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  PERFORM 1 FROM units WHERE tenant_id=p_tenant AND id=p_unit FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unit not found'; END IF;
END $$;

CREATE OR REPLACE FUNCTION app.has_effective_signed_contract(p_tenant uuid,p_unit uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT EXISTS(SELECT 1 FROM contracts WHERE tenant_id=p_tenant AND unit_id=p_unit
    AND contract_type IN ('rs','sbk','ks') AND current_status='signed')
$$;

ALTER TABLE unit_holds ADD COLUMN is_expirable boolean NOT NULL DEFAULT true;
UPDATE unit_holds SET is_expirable=(hold_type='pre_reservation');
ALTER TABLE unit_holds ADD CONSTRAINT unit_holds_expiry_kind_check
  CHECK(is_expirable=(hold_type='pre_reservation'));

CREATE OR REPLACE FUNCTION app.guard_contract_reservation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  IF TG_TABLE_NAME='units' THEN
    IF NEW.commercial_status='available' AND OLD.commercial_status IS DISTINCT FROM NEW.commercial_status
       AND app.has_effective_signed_contract(NEW.tenant_id,NEW.id) THEN
      RAISE EXCEPTION 'SIGNED_CONTRACT_PROTECTS_RESERVATION' USING ERRCODE='P0001';
    END IF;
  ELSIF TG_TABLE_NAME='sales_cases' THEN
    IF NEW.current_stage IN ('interest','pre_reservation') AND OLD.current_stage IS DISTINCT FROM NEW.current_stage
       AND app.has_effective_signed_contract(NEW.tenant_id,NEW.unit_id) THEN
      RAISE EXCEPTION 'SIGNED_CONTRACT_PROTECTS_RESERVATION' USING ERRCODE='P0001';
    END IF;
  ELSE
    NEW.is_expirable := NEW.hold_type='pre_reservation';
    IF TG_OP='UPDATE' AND OLD.status='active' AND OLD.hold_type='reservation'
       AND NEW.status IN ('cancelled','expired')
       AND app.has_effective_signed_contract(OLD.tenant_id,OLD.unit_id) THEN
      RAISE EXCEPTION 'SIGNED_CONTRACT_PROTECTS_RESERVATION' USING ERRCODE='P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER units_signed_contract_guard BEFORE UPDATE OF commercial_status ON units
  FOR EACH ROW EXECUTE FUNCTION app.guard_contract_reservation();
CREATE TRIGGER sales_cases_signed_contract_guard BEFORE UPDATE OF current_stage ON sales_cases
  FOR EACH ROW EXECUTE FUNCTION app.guard_contract_reservation();
CREATE TRIGGER unit_hold_contract_guard BEFORE INSERT OR UPDATE ON unit_holds
  FOR EACH ROW EXECUTE FUNCTION app.guard_contract_reservation();

CREATE OR REPLACE FUNCTION app.prevent_unit_hold_overlap() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM app.lock_workflow_unit(NEW.tenant_id,NEW.unit_id);
  IF NEW.status='active' AND EXISTS(
    SELECT 1 FROM unit_holds existing WHERE existing.tenant_id=NEW.tenant_id AND existing.unit_id=NEW.unit_id
      AND existing.status='active' AND existing.id<>NEW.id
      AND (NOT existing.is_expirable OR existing.starts_at<NEW.expires_at)
      AND (NOT NEW.is_expirable OR NEW.starts_at<existing.expires_at)
  ) THEN RAISE EXCEPTION 'unit hold interval overlaps an active hold'; END IF;
  RETURN NEW;
END $$;

-- create_unit_hold: lock unit before any mutable workflow row.
CREATE OR REPLACE FUNCTION app.create_unit_hold(
  p_tenant uuid,p_unit uuid,p_hold_type text,p_party_ids uuid[],p_expires_at timestamptz,
  p_actor_membership uuid,p_interest_id uuid,p_idempotency_key text,p_reason text
) RETURNS TABLE(sales_case_id uuid,hold_id uuid) LANGUAGE plpgsql AS $$
DECLARE project uuid; actor uuid; current_status text; case_id uuid; new_hold uuid:=gen_random_uuid(); participant_id uuid; interest_id uuid; stale uuid;
BEGIN
  PERFORM app.lock_workflow_unit(p_tenant,p_unit);
  SELECT project_id,commercial_status INTO project,current_status FROM units WHERE tenant_id=p_tenant AND id=p_unit FOR UPDATE;
  SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF project IS NULL OR actor IS NULL OR p_hold_type NOT IN ('pre_reservation','reservation') OR p_expires_at<=now() OR cardinality(p_party_ids)<1 THEN
    RAISE EXCEPTION 'invalid hold command'; END IF;
  IF NOT app.has_project_permission(p_tenant,p_actor_membership,project,'holds.manage') THEN RAISE EXCEPTION 'holds.manage permission required'; END IF;
  IF (SELECT count(DISTINCT value) FROM unnest(p_party_ids) value)<>cardinality(p_party_ids)
     OR (SELECT count(*) FROM parties WHERE tenant_id=p_tenant AND id=ANY(p_party_ids) AND lifecycle_status='active')<>cardinality(p_party_ids) THEN
    RAISE EXCEPTION 'all participants must be unique active parties of the tenant'; END IF;
  SELECT unit_holds.sales_case_id,unit_holds.id INTO case_id,new_hold FROM unit_holds
    WHERE tenant_id=p_tenant AND idempotency_key=p_idempotency_key;
  IF new_hold IS NOT NULL THEN RETURN QUERY SELECT case_id,new_hold; RETURN; END IF;
  new_hold:=gen_random_uuid();
  FOR stale IN SELECT id FROM unit_holds WHERE tenant_id=p_tenant AND unit_id=p_unit AND status='active' AND is_expirable AND hold_type='pre_reservation' AND expires_at<=now() FOR UPDATE
  LOOP PERFORM app.expire_unit_hold(p_tenant,stale,p_actor_membership); END LOOP;
  IF EXISTS(SELECT 1 FROM unit_holds WHERE tenant_id=p_tenant AND unit_id=p_unit AND status='active' AND starts_at< p_expires_at AND now()<expires_at) THEN
    RAISE EXCEPTION 'unit hold interval overlaps an active hold';
  END IF;
  SELECT id INTO case_id FROM sales_cases WHERE tenant_id=p_tenant AND unit_id=p_unit AND status='active' FOR UPDATE;
  IF case_id IS NULL THEN
    case_id:=gen_random_uuid();
    INSERT INTO sales_cases(id,tenant_id,project_id,unit_id,status,current_stage) VALUES(case_id,p_tenant,project,p_unit,'active','interest');
    INSERT INTO sales_stage_events(tenant_id,project_id,sales_case_id,from_stage,to_stage,command,reason,recorded_by_membership_id)
    VALUES(p_tenant,project,case_id,NULL,'interest','openCase',p_reason,p_actor_membership);
  END IF;
  FOREACH participant_id IN ARRAY p_party_ids LOOP
    INSERT INTO sales_case_parties(tenant_id,project_id,sales_case_id,party_id,participant_role,is_primary)
    VALUES(p_tenant,project,case_id,participant_id,CASE WHEN participant_id=p_party_ids[1] THEN 'buyer' ELSE 'co_buyer' END,participant_id=p_party_ids[1])
    ON CONFLICT ON CONSTRAINT sales_case_party_uq DO NOTHING;
    IF NOT EXISTS(SELECT 1 FROM party_project_links WHERE tenant_id=p_tenant AND project_id=project AND party_id=participant_id AND relationship_type='buyer' AND valid_to IS NULL) THEN
      INSERT INTO party_project_links(tenant_id,project_id,party_id,relationship_type) VALUES(p_tenant,project,participant_id,'buyer');
    END IF;
    INSERT INTO unit_interests(tenant_id,project_id,unit_id,party_id,status,first_interest_at,last_interest_at)
    VALUES(p_tenant,project,p_unit,participant_id,'converted',now(),now())
    ON CONFLICT (tenant_id,unit_id,party_id) DO UPDATE SET status='converted',last_interest_at=EXCLUDED.last_interest_at
    RETURNING id INTO interest_id;
    INSERT INTO interest_events(tenant_id,project_id,unit_interest_id,sales_case_id,event_type,outcome,occurred_at,recorded_by_membership_id)
    VALUES(p_tenant,project,interest_id,case_id,'converted_to_sales_case',p_hold_type,now(),p_actor_membership);
  END LOOP;
  IF p_interest_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM unit_interests WHERE tenant_id=p_tenant AND id=p_interest_id AND unit_id=p_unit) THEN
    RAISE EXCEPTION 'interest does not belong to unit'; END IF;
  INSERT INTO unit_holds(id,tenant_id,project_id,unit_id,sales_case_id,hold_type,starts_at,expires_at,idempotency_key,created_by_membership_id)
  VALUES(new_hold,p_tenant,project,p_unit,case_id,p_hold_type,now(),p_expires_at,p_idempotency_key,p_actor_membership);
  PERFORM app.record_sales_stage(p_tenant,case_id,CASE p_hold_type WHEN 'pre_reservation' THEN 'pre_reservation' ELSE 'reservation' END,
    CASE p_hold_type WHEN 'pre_reservation' THEN 'createPreReservation' ELSE 'createReservation' END,p_reason,p_actor_membership);
  PERFORM app.transition_unit_commercial_status(p_tenant,p_unit,CASE p_hold_type WHEN 'pre_reservation' THEN 'pre_reserved' ELSE 'reserved' END,
    CASE p_hold_type WHEN 'pre_reservation' THEN 'createPreReservation' ELSE 'createReservation' END,p_reason,p_actor_membership);
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data)
  VALUES(p_tenant,actor,'hold.created','unit_hold',new_hold,jsonb_build_object('type',p_hold_type,'unitId',p_unit,'salesCaseId',case_id));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'hold',new_hold,'hold.created.v1',jsonb_build_object('holdId',new_hold,'unitId',p_unit,'salesCaseId',case_id,'type',p_hold_type));
  RETURN QUERY SELECT case_id,new_hold;
END $$;

-- convert_pre_reservation: lock unit before any mutable workflow row.
CREATE OR REPLACE FUNCTION app.convert_pre_reservation(
  p_tenant uuid,p_hold uuid,p_expires_at timestamptz,p_actor_membership uuid,p_idempotency_key text,p_reason text
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE old unit_holds%ROWTYPE;new_hold uuid:=gen_random_uuid();actor uuid;
BEGIN
  PERFORM app.lock_workflow_unit(p_tenant,(SELECT unit_id FROM unit_holds WHERE tenant_id=p_tenant AND id=p_hold));
  SELECT * INTO old FROM unit_holds WHERE tenant_id=p_tenant AND id=p_hold FOR UPDATE;
  SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF old.id IS NULL OR old.status<>'active' OR old.hold_type<>'pre_reservation' OR old.expires_at<=now() OR p_expires_at<=now() OR actor IS NULL
  THEN RAISE EXCEPTION 'active pre-reservation and actor are required';END IF;
  IF NOT app.has_project_permission(p_tenant,p_actor_membership,old.project_id,'holds.confirm') THEN RAISE EXCEPTION 'holds.confirm permission required';END IF;
  SELECT id INTO new_hold FROM unit_holds WHERE tenant_id=p_tenant AND idempotency_key=p_idempotency_key;
  IF FOUND THEN RETURN new_hold;END IF;
  new_hold:=gen_random_uuid();
  UPDATE unit_holds SET status='converted',ended_at=now() WHERE tenant_id=p_tenant AND id=p_hold;
  INSERT INTO unit_holds(id,tenant_id,project_id,unit_id,sales_case_id,hold_type,starts_at,expires_at,idempotency_key,created_by_membership_id)
  VALUES(new_hold,p_tenant,old.project_id,old.unit_id,old.sales_case_id,'reservation',now(),p_expires_at,p_idempotency_key,p_actor_membership);
  PERFORM app.record_sales_stage(p_tenant,old.sales_case_id,'reservation','confirmReservation',p_reason,p_actor_membership);
  PERFORM app.transition_unit_commercial_status(p_tenant,old.unit_id,'reserved','confirmReservation',p_reason,p_actor_membership);
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data)
  VALUES(p_tenant,actor,'hold.converted','unit_hold',new_hold,jsonb_build_object('fromHoldId',p_hold,'unitId',old.unit_id));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'hold',new_hold,'hold.converted.v2',jsonb_build_object('fromHoldId',p_hold,'holdId',new_hold,'unitId',old.unit_id));
  RETURN new_hold;
END $$;

-- ensure_signed_rs_reservation: lock unit before any mutable workflow row.
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
  PERFORM app.lock_workflow_unit(p_tenant,(SELECT unit_id FROM contracts WHERE tenant_id=p_tenant AND id=p_contract));
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
    AND status='active' AND (NOT is_expirable OR expires_at>now())
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

-- sign_contract_externally: lock unit before any mutable workflow row.
CREATE OR REPLACE FUNCTION app.sign_contract_externally(
  p_tenant uuid,p_contract uuid,p_version uuid,p_signed_at timestamptz,
  p_actor_membership uuid,p_note text DEFAULT NULL
) RETURNS TABLE(completed boolean,already_signed boolean,version_id uuid) LANGUAGE plpgsql AS $$
DECLARE contract_row contracts%ROWTYPE;actor uuid;current_version contract_versions%ROWTYPE;signature_time timestamptz:=COALESCE(p_signed_at,now());note_text text:=COALESCE(NULLIF(btrim(p_note),''),'Podpis smlouvy zaznamenán');
BEGIN
  PERFORM app.lock_workflow_unit(p_tenant,(SELECT unit_id FROM contracts WHERE tenant_id=p_tenant AND id=p_contract));
  SELECT * INTO contract_row FROM contracts WHERE tenant_id=p_tenant AND id=p_contract FOR UPDATE;
  SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF contract_row.id IS NULL THEN RAISE EXCEPTION 'contract not found';END IF;
  IF actor IS NULL OR NOT app.has_project_permission(p_tenant,p_actor_membership,contract_row.project_id,'contract.sign') THEN RAISE EXCEPTION 'contract.sign permission required';END IF;
  SELECT * INTO current_version FROM contract_versions WHERE tenant_id=p_tenant AND contract_id=p_contract ORDER BY version_number DESC,id DESC LIMIT 1 FOR UPDATE;
  IF current_version.id IS NULL THEN RAISE EXCEPTION 'contract requires a logical version';END IF;
  IF p_version IS NULL OR p_version<>current_version.id THEN RAISE EXCEPTION 'current contract version is required';END IF;
  IF contract_row.current_status='signed' THEN
    IF current_version.version_status<>'signed' THEN RAISE EXCEPTION 'signed contract version is inconsistent';END IF;
    PERFORM app.synchronize_signed_contract(p_tenant,p_contract,p_actor_membership,note_text);
    RETURN QUERY SELECT true,true,current_version.id;RETURN;
  END IF;
  IF contract_row.current_status NOT IN ('approved','signing') THEN RAISE EXCEPTION 'contract must be approved';END IF;
  IF current_version.version_status<>'approved_for_signing' THEN RAISE EXCEPTION 'approved contract version is required';END IF;
  IF signature_time>now()+interval '5 minutes' THEN RAISE EXCEPTION 'signature date cannot be in the future';END IF;
  IF NOT EXISTS(SELECT 1 FROM contract_parties WHERE tenant_id=p_tenant AND contract_id=p_contract AND signing_required) THEN RAISE EXCEPTION 'contract requires a signing party';END IF;
  UPDATE contract_parties SET signature_status='signed',signed_at=signature_time,signed_version_id=current_version.id
  WHERE tenant_id=p_tenant AND contract_id=p_contract AND signing_required AND signature_status<>'signed';
  UPDATE contract_versions SET version_status='signed',signed_at=signature_time,locked_at=now() WHERE tenant_id=p_tenant AND id=current_version.id;
  PERFORM set_config('app.contract_status_command','on',true);
  UPDATE contracts SET current_status='signed',signed_at=signature_time WHERE tenant_id=p_tenant AND id=p_contract;
  INSERT INTO contract_status_events(tenant_id,project_id,contract_id,from_status,to_status,command,reason,recorded_by_membership_id,source)
  VALUES(p_tenant,contract_row.project_id,p_contract,contract_row.current_status,'signed','recordExternalSignature',note_text,p_actor_membership,'signature');
  PERFORM app.synchronize_signed_contract(p_tenant,p_contract,p_actor_membership,note_text);
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data,metadata)
  VALUES(p_tenant,actor,'contract.signed','contract',p_contract,jsonb_build_object('versionId',current_version.id,'type',contract_row.contract_type,'signedAt',signature_time,'method','external'),jsonb_build_object('projectId',contract_row.project_id,'unitId',contract_row.unit_id,'note',NULLIF(btrim(p_note),'')));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'contract',p_contract,'contract.signed.v1',jsonb_build_object('contractId',p_contract,'versionId',current_version.id,'type',contract_row.contract_type,'unitId',contract_row.unit_id,'signedAt',signature_time,'method','external'));
  RETURN QUERY SELECT true,false,current_version.id;
END $$;

-- transition_contract_status: lock unit before any mutable workflow row.
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
  IF contract_type='rs' AND p_to IN ('cancelled','terminated') THEN PERFORM app.rollback_ended_rs(p_tenant,p_contract,p_actor_membership,reason_text);END IF;
  RETURN event_id;
END $$;

-- transition_contract_status_with_refund_decisions: lock unit before any mutable workflow row.
CREATE OR REPLACE FUNCTION app.transition_contract_status_with_refund_decisions(
  p_tenant uuid,p_contract uuid,p_to text,p_reason text,p_refund_decisions jsonb,p_idempotency_key text,p_actor_membership uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,app AS $$
DECLARE contract_row contracts%ROWTYPE;command_id uuid;event_id uuid;paid_count integer;covered_count integer;item jsonb;obligation payment_obligations%ROWTYPE;paid numeric;decision_text text;decision_amount numeric;decision_id uuid;actor uuid;
BEGIN
  PERFORM app.lock_workflow_unit(p_tenant,(SELECT unit_id FROM contracts WHERE tenant_id=p_tenant AND id=p_contract));
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

-- rollback_ended_rs: lock unit before any mutable workflow row.
CREATE OR REPLACE FUNCTION app.rollback_ended_rs(
  p_tenant uuid,p_contract uuid,p_actor_membership uuid,p_reason text
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE contract_row contracts%ROWTYPE;unit_status text;actor uuid;obligation payment_obligations%ROWTYPE;paid_amount numeric;
BEGIN
  PERFORM app.lock_workflow_unit(p_tenant,(SELECT unit_id FROM contracts WHERE tenant_id=p_tenant AND id=p_contract));
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

-- record_sales_stage: lock unit before any mutable workflow row.
CREATE OR REPLACE FUNCTION app.record_sales_stage(
  p_tenant uuid,p_case uuid,p_to text,p_command text,p_reason text,p_actor_membership uuid
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE previous text; project uuid; event_id uuid:=gen_random_uuid();
BEGIN
  PERFORM app.lock_workflow_unit(p_tenant,(SELECT unit_id FROM sales_cases WHERE tenant_id=p_tenant AND id=p_case));
  SELECT current_stage,project_id INTO previous,project FROM sales_cases WHERE tenant_id=p_tenant AND id=p_case FOR UPDATE;
  IF previous IS NULL THEN RAISE EXCEPTION 'sales case not found'; END IF;
  IF previous=p_to THEN RETURN NULL; END IF;
  PERFORM set_config('app.sales_stage_command','on',true);
  UPDATE sales_cases SET current_stage=p_to WHERE tenant_id=p_tenant AND id=p_case;
  INSERT INTO sales_stage_events(id,tenant_id,project_id,sales_case_id,from_stage,to_stage,command,reason,recorded_by_membership_id)
  VALUES(event_id,p_tenant,project,p_case,previous,p_to,p_command,p_reason,p_actor_membership);
  RETURN event_id;
END $$;

-- synchronize_signed_contract: lock unit before any mutable workflow row.
CREATE OR REPLACE FUNCTION app.synchronize_signed_contract(
  p_tenant uuid,p_contract uuid,p_actor_membership uuid,p_reason text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE contract_row contracts%ROWTYPE;unit_status text;reason_text text:=COALESCE(NULLIF(btrim(p_reason),''),'Podepsaná smlouva');
BEGIN
  PERFORM app.lock_workflow_unit(p_tenant,(SELECT unit_id FROM contracts WHERE tenant_id=p_tenant AND id=p_contract));
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

-- complete_contract_assignment: lock unit before any mutable workflow row.
CREATE OR REPLACE FUNCTION app.complete_contract_assignment(
  p_tenant uuid,p_contract uuid,p_actor_membership uuid,p_reason text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE contract_row contracts%ROWTYPE;parent_row contracts%ROWTYPE;case_row sales_cases%ROWTYPE;actor uuid;event_id uuid;
  previous_buyers jsonb;current_buyers jsonb;desired record;interest_id uuid;
  reason_text text:=COALESCE(NULLIF(btrim(p_reason),''),'Podepsané postoupení smlouvy');
BEGIN
  PERFORM app.lock_workflow_unit(p_tenant,(SELECT unit_id FROM contracts WHERE tenant_id=p_tenant AND id=p_contract));
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

-- create_contract_assignment: lock unit before any mutable workflow row.
CREATE OR REPLACE FUNCTION app.create_contract_assignment(
  p_tenant uuid,p_unit uuid,p_buyers jsonb,p_actor_membership uuid,
  p_effective_at timestamptz,p_note text,p_idempotency_key text
) RETURNS TABLE(contract_id uuid,version_id uuid,contract_type text,parent_contract_id uuid) LANGUAGE plpgsql AS $$
DECLARE
  case_row sales_cases%ROWTYPE;parent_row contracts%ROWTYPE;actor uuid;created_contract uuid;created_version uuid;
  desired record;desired_count integer;primary_count integer;sequence_number integer;assignment_type text;
  reference_text text;title_text text;note_text text:=COALESCE(NULLIF(btrim(p_note),''),'Postoupení smlouvy');
BEGIN
  PERFORM app.lock_workflow_unit(p_tenant,p_unit);
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

-- create_contract: lock unit before any mutable workflow row.
CREATE OR REPLACE FUNCTION app.create_contract(
  p_tenant uuid,p_case uuid,p_type text,p_reference text,p_title text,p_actor_membership uuid,p_parent_contract uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE project uuid;unit uuid;actor uuid;contract_id uuid:=gen_random_uuid();version_id uuid:=gen_random_uuid();unit_price numeric;accessory_snapshot jsonb;total_price numeric;
BEGIN
  PERFORM app.lock_workflow_unit(p_tenant,(SELECT unit_id FROM sales_cases WHERE tenant_id=p_tenant AND id=p_case));
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

-- create_contract_with_payment: lock unit before any mutable workflow row.
CREATE OR REPLACE FUNCTION app.create_contract_with_payment(
  p_tenant uuid,p_case uuid,p_type text,p_reference text,p_title text,p_actor_membership uuid,p_parent_contract uuid,
  p_idempotency_key text,p_payment_calculation_type text,p_payment_input_value numeric,p_payment_due_at timestamptz
) RETURNS TABLE(contract_id uuid,version_id uuid,payment_obligation_id uuid,payment_amount numeric) LANGUAGE plpgsql AS $$
DECLARE project uuid;unit uuid;party uuid;actor uuid;created_contract uuid;created_version uuid;created_obligation uuid;calculated_amount numeric;obligation_type text;obligation_label text;price_basis numeric;
BEGIN
  PERFORM app.lock_workflow_unit(p_tenant,(SELECT unit_id FROM sales_cases WHERE tenant_id=p_tenant AND id=p_case));
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

CREATE OR REPLACE FUNCTION app.expire_unit_hold(p_tenant uuid,p_hold uuid,p_actor_membership uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE hold_row unit_holds%ROWTYPE;actor uuid;unit_status text;target_unit uuid;
BEGIN
  SELECT unit_id INTO target_unit FROM unit_holds WHERE tenant_id=p_tenant AND id=p_hold;
  IF target_unit IS NULL THEN RETURN false; END IF;
  PERFORM app.lock_workflow_unit(p_tenant,target_unit);
  SELECT * INTO hold_row FROM unit_holds WHERE tenant_id=p_tenant AND id=p_hold FOR UPDATE;
  SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF actor IS NULL OR NOT app.has_project_permission(p_tenant,p_actor_membership,hold_row.project_id,'holds.manage') THEN
    RAISE EXCEPTION 'holds.manage permission required';
  END IF;
  IF hold_row.status<>'active' OR hold_row.hold_type<>'pre_reservation' OR NOT hold_row.is_expirable
     OR hold_row.expires_at>now() OR app.has_effective_signed_contract(p_tenant,target_unit) THEN RETURN false; END IF;
  UPDATE unit_holds SET status='expired',ended_at=now() WHERE tenant_id=p_tenant AND id=p_hold;
  SELECT commercial_status INTO unit_status FROM units WHERE tenant_id=p_tenant AND id=target_unit;
  IF unit_status='pre_reserved' AND NOT EXISTS(
    SELECT 1 FROM unit_holds WHERE tenant_id=p_tenant AND unit_id=target_unit AND status='active'
      AND (NOT is_expirable OR (starts_at<=now() AND expires_at>now()))
  ) THEN
    PERFORM app.record_sales_stage(p_tenant,hold_row.sales_case_id,'interest','expireHold','Platnost předrezervace skončila',p_actor_membership);
    PERFORM app.transition_unit_commercial_status(p_tenant,target_unit,'available','expireHold','Platnost předrezervace skončila',p_actor_membership);
  END IF;
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data,metadata)
    VALUES(p_tenant,actor,'hold.expired','unit_hold',p_hold,jsonb_build_object('unitId',target_unit),
      jsonb_build_object('projectId',hold_row.project_id,'salesCaseId',hold_row.sales_case_id,
        'source',COALESCE(NULLIF(current_setting('app.operation_source',true),''),'domain_command')));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
    VALUES(p_tenant,'hold',p_hold,'hold.expired.v1',jsonb_build_object('holdId',p_hold,'unitId',target_unit,'projectId',hold_row.project_id));
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION app.cancel_unit_hold(p_tenant uuid,p_hold uuid,p_actor_membership uuid,p_reason text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE hold_row unit_holds%ROWTYPE;actor uuid;unit_status text;target_unit uuid;
BEGIN
  SELECT unit_id INTO target_unit FROM unit_holds WHERE tenant_id=p_tenant AND id=p_hold;
  IF target_unit IS NULL THEN RETURN false; END IF;
  PERFORM app.lock_workflow_unit(p_tenant,target_unit);
  SELECT * INTO hold_row FROM unit_holds WHERE tenant_id=p_tenant AND id=p_hold FOR UPDATE;
  SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF actor IS NULL OR NOT app.has_project_permission(p_tenant,p_actor_membership,hold_row.project_id,'holds.cancel') THEN
    RAISE EXCEPTION 'holds.cancel permission required';
  END IF;
  IF hold_row.status<>'active' THEN RETURN false; END IF;
  IF app.has_effective_signed_contract(p_tenant,target_unit) THEN
    RAISE EXCEPTION 'SIGNED_CONTRACT_PROTECTS_RESERVATION' USING ERRCODE='P0001';
  END IF;
  IF length(btrim(COALESCE(p_reason,'')))<3 THEN RAISE EXCEPTION 'reason is required'; END IF;
  UPDATE unit_holds SET status='cancelled',ended_at=now() WHERE tenant_id=p_tenant AND id=p_hold;
  SELECT commercial_status INTO unit_status FROM units WHERE tenant_id=p_tenant AND id=target_unit;
  IF unit_status IN ('pre_reserved','reserved') AND NOT EXISTS(
    SELECT 1 FROM unit_holds WHERE tenant_id=p_tenant AND unit_id=target_unit AND status='active'
      AND (NOT is_expirable OR (starts_at<=now() AND expires_at>now()))
  ) THEN
    PERFORM app.record_sales_stage(p_tenant,hold_row.sales_case_id,'interest',
      CASE hold_row.hold_type WHEN 'pre_reservation' THEN 'cancelPreReservation' ELSE 'cancelReservation' END,p_reason,p_actor_membership);
    PERFORM app.transition_unit_commercial_status(p_tenant,target_unit,'available',
      CASE hold_row.hold_type WHEN 'pre_reservation' THEN 'cancelPreReservation' ELSE 'cancelReservation' END,p_reason,p_actor_membership);
  END IF;
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data)
    VALUES(p_tenant,actor,'hold.cancelled','unit_hold',p_hold,jsonb_build_object('reason',p_reason));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
    VALUES(p_tenant,'hold',p_hold,'hold.cancelled.v2',jsonb_build_object('holdId',p_hold,'unitId',target_unit,'reason',p_reason));
  RETURN true;
END $$;

-- Do not advertise contract reservations as time-limited expiry warnings.
CREATE OR REPLACE FUNCTION app.enqueue_expiring_holds(p_tenant uuid,p_horizon interval)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE queued integer;
BEGIN
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
    SELECT p_tenant,'hold',hold.id,'hold.expiring.v1',jsonb_build_object('holdId',hold.id,'unitId',hold.unit_id,'expiresAt',hold.expires_at)
    FROM unit_holds hold WHERE hold.tenant_id=p_tenant AND hold.status='active' AND hold.is_expirable
      AND hold.hold_type='pre_reservation' AND hold.expires_at>now() AND hold.expires_at<=now()+p_horizon
      AND NOT app.has_effective_signed_contract(p_tenant,hold.unit_id)
      AND NOT EXISTS(SELECT 1 FROM outbox_events event WHERE event.tenant_id=p_tenant AND event.aggregate_id=hold.id AND event.event_type='hold.expiring.v1');
  GET DIAGNOSTICS queued=ROW_COUNT;
  RETURN queued;
END $$;
COMMIT;

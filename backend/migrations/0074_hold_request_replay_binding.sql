BEGIN;

-- Bind hold replay to its original command, not merely a tenant-wide key.
-- No historical payload is guessed/backfilled. Legacy replay fails closed.
ALTER TABLE unit_holds ADD COLUMN creation_request_hash text
  CHECK (creation_request_hash IS NULL OR creation_request_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE unit_holds ADD COLUMN creation_party_id uuid;
ALTER TABLE unit_holds ADD CONSTRAINT unit_hold_creation_party_fk
  FOREIGN KEY (tenant_id,creation_party_id) REFERENCES parties(tenant_id,id) ON DELETE RESTRICT;
-- Only a SHA-256 fingerprint is stored; never the raw new-party request.
-- Existing row locks, authorization, audit and outbox remain authoritative.

CREATE OR REPLACE FUNCTION app.create_unit_hold(
  p_tenant uuid,p_unit uuid,p_hold_type text,p_party_ids uuid[],p_expires_at timestamptz,
  p_actor_membership uuid,p_interest_id uuid,p_idempotency_key text,p_reason text
) RETURNS TABLE(sales_case_id uuid,hold_id uuid) LANGUAGE plpgsql AS $$
DECLARE project uuid; actor uuid; current_status text; case_id uuid; new_hold uuid:=gen_random_uuid(); participant_id uuid; interest_id uuid; stale uuid; replay unit_holds%ROWTYPE; fingerprint text;
BEGIN
  PERFORM app.lock_workflow_unit(p_tenant,p_unit);
  SELECT project_id,commercial_status INTO project,current_status FROM units WHERE tenant_id=p_tenant AND id=p_unit FOR UPDATE;
  SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF project IS NULL OR actor IS NULL OR p_hold_type NOT IN ('pre_reservation','reservation') OR p_expires_at IS NULL OR cardinality(p_party_ids)<1 THEN
    RAISE EXCEPTION 'invalid hold command'; END IF;
  IF NOT app.has_project_permission(p_tenant,p_actor_membership,project,'holds.manage') THEN RAISE EXCEPTION 'holds.manage permission required'; END IF;
  IF NULLIF(btrim(p_idempotency_key),'') IS NULL THEN RAISE EXCEPTION 'HOLD_IDEMPOTENCY_INVALID_KEY'; END IF;
  fingerprint:=encode(sha256(convert_to(jsonb_build_array('hold-request-v1','existing_party',p_tenant,p_unit,p_hold_type,p_party_ids,extract(epoch FROM p_expires_at),p_actor_membership,p_interest_id,p_reason,p_idempotency_key)::text,'UTF8')),'hex');
  SELECT * INTO replay FROM unit_holds WHERE tenant_id=p_tenant AND idempotency_key=p_idempotency_key;
  IF replay.id IS NOT NULL THEN
    IF replay.unit_id<>p_unit OR replay.created_by_membership_id<>p_actor_membership OR replay.creation_request_hash IS DISTINCT FROM fingerprint
      THEN RAISE EXCEPTION 'HOLD_IDEMPOTENCY_CONFLICT'; END IF;
    RETURN QUERY SELECT replay.sales_case_id,replay.id; RETURN;
  END IF;
  IF p_expires_at<=now() THEN RAISE EXCEPTION 'invalid hold command'; END IF;
  IF (SELECT count(DISTINCT value) FROM unnest(p_party_ids) value)<>cardinality(p_party_ids)
     OR (SELECT count(*) FROM parties WHERE tenant_id=p_tenant AND id=ANY(p_party_ids) AND lifecycle_status='active')<>cardinality(p_party_ids) THEN
    RAISE EXCEPTION 'all participants must be unique active parties of the tenant'; END IF;
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
  INSERT INTO unit_holds(id,tenant_id,project_id,unit_id,sales_case_id,hold_type,starts_at,expires_at,idempotency_key,created_by_membership_id,creation_request_hash)
  VALUES(new_hold,p_tenant,project,p_unit,case_id,p_hold_type,now(),p_expires_at,p_idempotency_key,p_actor_membership,fingerprint);
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




CREATE OR REPLACE FUNCTION app.create_party_and_unit_hold(
  p_tenant uuid,p_unit uuid,p_hold_type text,p_expires_at timestamptz,p_actor uuid,p_idempotency_key text,p_reason text,
  p_kind text,p_salutation text,p_first_name text,p_last_name text,p_legal_name text,p_registration text,p_email text,p_phone text,p_duplicate_override boolean
) RETURNS TABLE(party_id uuid,sales_case_id uuid,hold_id uuid) LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE project uuid;created_party uuid;created record;required_permission text;display text;phone_digits text;replay unit_holds%ROWTYPE;fingerprint text;
BEGIN
  SELECT project_id INTO project FROM units WHERE tenant_id=p_tenant AND id=p_unit FOR UPDATE;
  required_permission:=CASE p_hold_type WHEN 'pre_reservation' THEN 'holds.create' WHEN 'reservation' THEN 'holds.confirm' ELSE NULL END;
  IF project IS NULL OR required_permission IS NULL THEN RAISE EXCEPTION 'invalid hold command'; END IF;
  IF NOT app.has_project_permission(p_tenant,p_actor,project,'clients.create') THEN RAISE EXCEPTION 'clients.create permission required'; END IF;
  IF NOT app.has_project_permission(p_tenant,p_actor,project,required_permission) THEN RAISE EXCEPTION '% permission required',required_permission; END IF;
  IF NULLIF(btrim(p_idempotency_key),'') IS NULL THEN RAISE EXCEPTION 'HOLD_IDEMPOTENCY_INVALID_KEY'; END IF;
  fingerprint:=encode(sha256(convert_to(jsonb_build_array('hold-request-v1','new_party',p_tenant,p_unit,p_hold_type,extract(epoch FROM p_expires_at),p_actor,p_reason,p_kind,p_salutation,p_first_name,p_last_name,p_legal_name,p_registration,p_email,p_phone,p_duplicate_override,p_idempotency_key)::text,'UTF8')),'hex');
  SELECT * INTO replay FROM unit_holds WHERE tenant_id=p_tenant AND idempotency_key=p_idempotency_key;
  IF replay.id IS NOT NULL THEN
    IF replay.unit_id<>p_unit OR replay.created_by_membership_id<>p_actor OR replay.creation_request_hash IS DISTINCT FROM fingerprint OR replay.creation_party_id IS NULL
      THEN RAISE EXCEPTION 'HOLD_IDEMPOTENCY_CONFLICT'; END IF;
    RETURN QUERY SELECT replay.creation_party_id,replay.sales_case_id,replay.id;RETURN;
  END IF;
  display:=lower(regexp_replace(btrim(CASE WHEN p_kind='organization' THEN COALESCE(p_legal_name,'') ELSE concat_ws(' ',p_first_name,p_last_name) END),'\s+',' ','g'));
  phone_digits:=regexp_replace(COALESCE(p_phone,''),'[^0-9]','','g');IF length(phone_digits)=9 THEN phone_digits:='420'||phone_digits;END IF;
  IF NOT p_duplicate_override AND EXISTS(
    SELECT 1 FROM parties party
    LEFT JOIN party_organization_details organization ON organization.tenant_id=party.tenant_id AND organization.party_id=party.id
    WHERE party.tenant_id=p_tenant AND party.archived_at IS NULL AND (
      (NULLIF(btrim(p_email),'') IS NOT NULL AND EXISTS(SELECT 1 FROM party_contacts contact WHERE contact.tenant_id=party.tenant_id AND contact.party_id=party.id AND contact.contact_type='email' AND contact.archived_at IS NULL AND lower(btrim(contact.value))=lower(btrim(p_email)))) OR
      (phone_digits<>'' AND EXISTS(SELECT 1 FROM party_contacts contact WHERE contact.tenant_id=party.tenant_id AND contact.party_id=party.id AND contact.contact_type='phone' AND contact.archived_at IS NULL AND (CASE WHEN length(regexp_replace(contact.value,'[^0-9]','','g'))=9 THEN '420'||regexp_replace(contact.value,'[^0-9]','','g') ELSE regexp_replace(contact.value,'[^0-9]','','g') END)=phone_digits)) OR
      (NULLIF(regexp_replace(COALESCE(p_registration,''),'[^0-9A-Za-z]','','g'),'') IS NOT NULL AND upper(regexp_replace(COALESCE(organization.registration_number,''),'[^0-9A-Za-z]','','g'))=upper(regexp_replace(p_registration,'[^0-9A-Za-z]','','g'))) OR
      (display<>'' AND lower(regexp_replace(btrim(party.display_name),'\s+',' ','g'))=display)
    )
  ) THEN RAISE EXCEPTION 'party duplicate confirmation required'; END IF;
  PERFORM set_config('app.party_duplicate_override',CASE WHEN p_duplicate_override THEN 'on' ELSE 'off' END,true);
  created_party:=app.create_party_for_project(p_tenant,project,p_kind,p_salutation,p_first_name,p_last_name,p_legal_name,p_registration,p_email,p_phone,p_actor);
  SELECT * INTO created FROM app.create_unit_hold(p_tenant,p_unit,p_hold_type,ARRAY[created_party]::uuid[],p_expires_at,p_actor,NULL,p_idempotency_key,p_reason);
  UPDATE unit_holds SET creation_request_hash=fingerprint,creation_party_id=created_party WHERE tenant_id=p_tenant AND id=created.hold_id;
  RETURN QUERY SELECT created_party,created.sales_case_id,created.hold_id;
END $$;

COMMIT;



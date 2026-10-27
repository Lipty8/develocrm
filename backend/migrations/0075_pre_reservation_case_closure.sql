BEGIN;

-- One assessment for unsigned pre-reservation release; no historical backfill.
CREATE FUNCTION app.pre_reservation_release_blocker(p_tenant uuid,p_unit uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM units WHERE tenant_id=p_tenant AND id=p_unit AND commercial_status IN ('sold','handed_over'))
    OR EXISTS(SELECT 1 FROM contracts c WHERE c.tenant_id=p_tenant AND c.unit_id=p_unit AND c.contract_type='ks'
      AND (c.signed_at IS NOT NULL OR EXISTS(SELECT 1 FROM contract_versions v WHERE v.tenant_id=c.tenant_id AND v.contract_id=c.id AND v.signed_at IS NOT NULL)))
    THEN RETURN 'HOLD_RELEASE_OWNERSHIP_UNVERIFIED'; END IF;
  IF EXISTS(SELECT 1 FROM contracts c WHERE c.tenant_id=p_tenant AND c.unit_id=p_unit AND app.contract_blocks_unit_release(p_tenant,c.id)
    AND (c.current_status='signed' OR c.signed_at IS NOT NULL
      OR EXISTS(SELECT 1 FROM contract_versions v WHERE v.tenant_id=c.tenant_id AND v.contract_id=c.id AND (v.signed_at IS NOT NULL OR v.version_status='signed'))
      OR EXISTS(SELECT 1 FROM contract_parties party WHERE party.tenant_id=c.tenant_id AND party.contract_id=c.id AND party.signature_status='signed')))
    THEN RETURN 'HOLD_RELEASE_CONTRACT_BLOCKED'; END IF;
  IF EXISTS(SELECT 1 FROM units WHERE tenant_id=p_tenant AND id=p_unit AND commercial_status='blocked')
    THEN RETURN 'HOLD_RELEASE_UNIT_BLOCKED'; END IF;
  IF EXISTS(SELECT 1 FROM unit_handovers WHERE tenant_id=p_tenant AND unit_id=p_unit AND status<>'cancelled')
    THEN RETURN 'HOLD_RELEASE_HANDOVER_EXISTS'; END IF;
  RETURN NULL;
END $$;

CREATE FUNCTION app.close_released_pre_reservation_case(p_tenant uuid,p_hold uuid,p_actor uuid,p_reason text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE h unit_holds%ROWTYPE;s sales_cases%ROWTYPE;actor_user uuid;ended timestamptz;item record;blocker text;
BEGIN
  PERFORM app.lock_workflow_unit(p_tenant,(SELECT unit_id FROM unit_holds WHERE tenant_id=p_tenant AND id=p_hold));
  SELECT * INTO h FROM unit_holds WHERE tenant_id=p_tenant AND id=p_hold FOR UPDATE;
  SELECT user_id INTO actor_user FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor AND status='active';
  IF h.id IS NULL OR actor_user IS NULL OR NOT (app.has_project_permission(p_tenant,p_actor,h.project_id,'holds.cancel')
    OR app.has_project_permission(p_tenant,p_actor,h.project_id,'holds.manage')) THEN RAISE EXCEPTION 'hold permission required'; END IF;
  IF h.hold_type<>'pre_reservation' OR h.status NOT IN ('cancelled','expired') THEN RETURN false; END IF;
  SELECT * INTO s FROM sales_cases WHERE tenant_id=p_tenant AND id=h.sales_case_id AND unit_id=h.unit_id AND project_id=h.project_id FOR UPDATE;
  IF s.id IS NULL OR s.status<>'active' THEN RETURN false; END IF;
  IF NOT EXISTS(SELECT 1 FROM units WHERE tenant_id=p_tenant AND id=h.unit_id AND commercial_status='available')
    OR EXISTS(SELECT 1 FROM unit_holds WHERE tenant_id=p_tenant AND unit_id=h.unit_id AND status='active') THEN RETURN false; END IF;
  blocker:=app.pre_reservation_release_blocker(p_tenant,h.unit_id);
  IF blocker IS NOT NULL THEN RAISE EXCEPTION '%',blocker; END IF;
  IF s.current_stage<>'interest' THEN RAISE EXCEPTION 'HOLD_RELEASE_CONTEXT_CHANGED'; END IF;
  ended:=clock_timestamp();
  FOR item IN SELECT interest.id FROM unit_interests interest
    WHERE interest.tenant_id=p_tenant AND interest.unit_id=h.unit_id AND interest.status='converted'
      AND EXISTS(SELECT 1 FROM sales_case_parties participant WHERE participant.tenant_id=p_tenant AND participant.sales_case_id=s.id AND participant.party_id=interest.party_id AND participant.left_at IS NULL)
  LOOP
    UPDATE unit_interests SET status='closed',last_interest_at=greatest(last_interest_at,ended) WHERE tenant_id=p_tenant AND id=item.id;
    INSERT INTO interest_events(tenant_id,project_id,unit_interest_id,sales_case_id,event_type,outcome,note,occurred_at,recorded_by_membership_id)
      VALUES(p_tenant,h.project_id,item.id,s.id,'closed','Obchod ukončen',p_reason,ended,p_actor);
  END LOOP;
  UPDATE sales_case_parties SET left_at=greatest(ended,joined_at+interval '1 microsecond'),is_primary=false
    WHERE tenant_id=p_tenant AND sales_case_id=s.id AND left_at IS NULL;
  UPDATE sales_cases SET status=CASE h.status WHEN 'expired' THEN 'expired' ELSE 'cancelled' END,
    closed_at=ended,close_reason=p_reason,updated_at=ended WHERE tenant_id=p_tenant AND id=s.id;
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data,metadata)
    VALUES(p_tenant,actor_user,'sales_case.closed_after_pre_reservation','sales_case',s.id,
      jsonb_build_object('status',CASE h.status WHEN 'expired' THEN 'expired' ELSE 'cancelled' END,'unitId',h.unit_id,'holdId',h.id),
      jsonb_build_object('projectId',h.project_id,'reason',p_reason,'source',COALESCE(NULLIF(current_setting('app.operation_source',true),''),'domain_command')));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
    VALUES(p_tenant,'sales_case',s.id,'sales_case.closed_after_pre_reservation.v1',jsonb_build_object('salesCaseId',s.id,'unitId',h.unit_id,'holdId',h.id,'status',CASE h.status WHEN 'expired' THEN 'expired' ELSE 'cancelled' END));
  RETURN true;
END $$;
GRANT EXECUTE ON FUNCTION app.pre_reservation_release_blocker(uuid,uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.close_released_pre_reservation_case(uuid,uuid,uuid,text) TO develocrm_app;

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
     OR hold_row.expires_at>now() OR app.has_effective_signed_contract(p_tenant,target_unit)
     OR app.pre_reservation_release_blocker(p_tenant,target_unit) IS NOT NULL THEN RETURN false; END IF;
  UPDATE unit_holds SET status='expired',ended_at=now() WHERE tenant_id=p_tenant AND id=p_hold;
  SELECT commercial_status INTO unit_status FROM units WHERE tenant_id=p_tenant AND id=target_unit;
  IF unit_status='pre_reserved' AND NOT EXISTS(
    SELECT 1 FROM unit_holds WHERE tenant_id=p_tenant AND unit_id=target_unit AND status='active'
  ) THEN
    PERFORM app.record_sales_stage(p_tenant,hold_row.sales_case_id,'interest','expireHold','Platnost předrezervace skončila',p_actor_membership);
    PERFORM app.transition_unit_commercial_status(p_tenant,target_unit,'available','expireHold','Platnost předrezervace skončila',p_actor_membership);
    PERFORM app.close_released_pre_reservation_case(p_tenant,p_hold,p_actor_membership,'Platnost jednání skončila');
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
DECLARE hold_row unit_holds%ROWTYPE;actor uuid;unit_status text;target_unit uuid;blocker text;
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
  blocker:=app.pre_reservation_release_blocker(p_tenant,target_unit);
  IF blocker IS NOT NULL THEN RAISE EXCEPTION '%',blocker; END IF;
  IF length(btrim(COALESCE(p_reason,'')))<3 THEN RAISE EXCEPTION 'reason is required'; END IF;
  UPDATE unit_holds SET status='cancelled',ended_at=now() WHERE tenant_id=p_tenant AND id=p_hold;
  SELECT commercial_status INTO unit_status FROM units WHERE tenant_id=p_tenant AND id=target_unit;
  IF unit_status IN ('pre_reserved','reserved') AND NOT EXISTS(
    SELECT 1 FROM unit_holds WHERE tenant_id=p_tenant AND unit_id=target_unit AND status='active'
  ) THEN
    PERFORM app.record_sales_stage(p_tenant,hold_row.sales_case_id,'interest',
      CASE hold_row.hold_type WHEN 'pre_reservation' THEN 'cancelPreReservation' ELSE 'cancelReservation' END,p_reason,p_actor_membership);
    PERFORM app.transition_unit_commercial_status(p_tenant,target_unit,'available',
      CASE hold_row.hold_type WHEN 'pre_reservation' THEN 'cancelPreReservation' ELSE 'cancelReservation' END,p_reason,p_actor_membership);
    PERFORM app.close_released_pre_reservation_case(p_tenant,p_hold,p_actor_membership,p_reason);
  END IF;
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data)
    VALUES(p_tenant,actor,'hold.cancelled','unit_hold',p_hold,jsonb_build_object('reason',p_reason));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
    VALUES(p_tenant,'hold',p_hold,'hold.cancelled.v2',jsonb_build_object('holdId',p_hold,'unitId',target_unit,'reason',p_reason));
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION app.create_unit_hold(
  p_tenant uuid,p_unit uuid,p_hold_type text,p_party_ids uuid[],p_expires_at timestamptz,
  p_actor_membership uuid,p_interest_id uuid,p_idempotency_key text,p_reason text
) RETURNS TABLE(sales_case_id uuid,hold_id uuid) LANGUAGE plpgsql AS $$
DECLARE project uuid; actor uuid; current_status text; case_id uuid; new_hold uuid:=gen_random_uuid(); participant_id uuid; interest_id uuid; stale uuid; replay unit_holds%ROWTYPE; fingerprint text; ended_hold uuid;
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
  -- Repair residual context only during a new explicit hold command, never by backfill.
  IF case_id IS NOT NULL AND current_status='available' THEN
    SELECT id INTO ended_hold FROM unit_holds WHERE tenant_id=p_tenant AND unit_id=p_unit AND sales_case_id=case_id
      AND hold_type='pre_reservation' AND status IN ('cancelled','expired') ORDER BY ended_at DESC,id DESC LIMIT 1;
    IF ended_hold IS NOT NULL AND app.close_released_pre_reservation_case(p_tenant,ended_hold,p_actor_membership,'Nové jednání po ukončené předrezervaci') THEN case_id:=NULL; END IF;
  END IF;
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

COMMIT;


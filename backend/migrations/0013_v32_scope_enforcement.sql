BEGIN;

ALTER TABLE tenant_memberships ADD COLUMN partner_party_id uuid;
ALTER TABLE parties ADD COLUMN owner_membership_id uuid;
ALTER TABLE parties ADD COLUMN source_partner_party_id uuid;

ALTER TABLE tenant_memberships
  ADD CONSTRAINT membership_partner_party_fk
  FOREIGN KEY(tenant_id,partner_party_id) REFERENCES parties(tenant_id,id) ON DELETE RESTRICT;
ALTER TABLE parties
  ADD CONSTRAINT party_owner_membership_fk
  FOREIGN KEY(tenant_id,owner_membership_id) REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT,
  ADD CONSTRAINT party_source_partner_fk
  FOREIGN KEY(tenant_id,source_partner_party_id) REFERENCES parties(tenant_id,id) ON DELETE RESTRICT;

CREATE INDEX party_owner_scope_idx ON parties(tenant_id,owner_membership_id) WHERE archived_at IS NULL;
CREATE INDEX party_partner_scope_idx ON parties(tenant_id,source_partner_party_id) WHERE archived_at IS NULL;

CREATE OR REPLACE FUNCTION app.can_access_party(
  p_tenant uuid,p_membership uuid,p_party uuid,p_contacts boolean DEFAULT false
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,app AS $$
  SELECT EXISTS(
    SELECT 1
    FROM parties party
    JOIN tenant_memberships membership
      ON membership.tenant_id=party.tenant_id AND membership.id=p_membership AND membership.status='active'
    JOIN party_project_links link
      ON link.tenant_id=party.tenant_id AND link.party_id=party.id AND link.valid_to IS NULL
    WHERE party.tenant_id=p_tenant AND party.id=p_party AND party.archived_at IS NULL
      AND (
        app.has_project_permission(p_tenant,p_membership,link.project_id,'clients.read_all')
        OR (
          app.has_project_permission(p_tenant,p_membership,link.project_id,'clients.read_own')
          AND (
            party.owner_membership_id=p_membership
            OR (membership.partner_party_id IS NOT NULL AND party.source_partner_party_id=membership.partner_party_id)
          )
        )
      )
      AND (NOT p_contacts OR app.has_project_permission(p_tenant,p_membership,link.project_id,'clients.read_contact_details'))
  )
$$;

CREATE OR REPLACE FUNCTION app.can_manage_party(p_tenant uuid,p_membership uuid,p_party uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,app AS $$
  SELECT app.can_access_party(p_tenant,p_membership,p_party,false)
    AND EXISTS(
      SELECT 1 FROM party_project_links link
      WHERE link.tenant_id=p_tenant AND link.party_id=p_party AND link.valid_to IS NULL
        AND app.has_project_permission(p_tenant,p_membership,link.project_id,'clients.update')
    )
$$;

CREATE OR REPLACE FUNCTION app.create_party_for_project(
  p_tenant uuid,p_project uuid,p_kind text,p_first_name text,p_last_name text,p_legal_name text,
  p_registration text,p_email text,p_phone text,p_actor uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE party_id uuid:=gen_random_uuid();display text;actor_user uuid;normalized_registration text;partner uuid;
BEGIN
 IF NOT app.has_project_permission(p_tenant,p_actor,p_project,'clients.create') THEN RAISE EXCEPTION 'clients.create permission required'; END IF;
 IF p_kind NOT IN ('individual','organization') THEN RAISE EXCEPTION 'invalid party type'; END IF;
 IF p_kind='individual' THEN display:=btrim(concat_ws(' ',p_first_name,p_last_name));ELSE display:=btrim(p_legal_name);END IF;
 IF length(display)<2 THEN RAISE EXCEPTION 'party name is required'; END IF;
 normalized_registration:=NULLIF(upper(regexp_replace(COALESCE(p_registration,''),'[^[:alnum:]]','','g')),'');
 IF p_kind='organization' AND normalized_registration IS NOT NULL AND EXISTS(
   SELECT 1 FROM party_organization_details detail
   WHERE detail.tenant_id=p_tenant AND upper(detail.registration_number)=normalized_registration
 ) THEN RAISE EXCEPTION 'organization with this registration number already exists'; END IF;
 SELECT user_id,partner_party_id INTO actor_user,partner FROM tenant_memberships
 WHERE tenant_id=p_tenant AND id=p_actor AND status='active';
 IF actor_user IS NULL THEN RAISE EXCEPTION 'active actor membership required'; END IF;
 INSERT INTO parties(id,tenant_id,party_type,display_name,owner_membership_id,source_partner_party_id)
 VALUES(party_id,p_tenant,p_kind,display,p_actor,partner);
 IF p_kind='individual' THEN
   INSERT INTO party_individual_details(tenant_id,party_id,first_name,last_name)
   VALUES(p_tenant,party_id,btrim(p_first_name),btrim(p_last_name));
 ELSE
   INSERT INTO party_organization_details(tenant_id,party_id,legal_name,registration_number)
   VALUES(p_tenant,party_id,display,normalized_registration);
 END IF;
 INSERT INTO party_project_links(tenant_id,project_id,party_id,relationship_type) VALUES(p_tenant,p_project,party_id,'prospect');
 IF NULLIF(btrim(p_email),'') IS NOT NULL THEN
   INSERT INTO party_contacts(tenant_id,party_id,contact_type,value,normalized_value,is_primary)
   VALUES(p_tenant,party_id,'email',btrim(p_email),lower(btrim(p_email)),true);
 END IF;
 IF NULLIF(btrim(p_phone),'') IS NOT NULL THEN
   INSERT INTO party_contacts(tenant_id,party_id,contact_type,value,normalized_value,is_primary)
   VALUES(p_tenant,party_id,'phone',btrim(p_phone),regexp_replace(btrim(p_phone),'[^0-9+]','','g'),true);
 END IF;
 INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data)
 VALUES(p_tenant,actor_user,'party.created','party',party_id,jsonb_build_object('projectId',p_project,'partyType',p_kind,'displayName',display,'ownerMembershipId',p_actor,'sourcePartnerPartyId',partner));
 INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
 VALUES(p_tenant,'party',party_id,'party.created.v2',jsonb_build_object('projectId',p_project,'partyType',p_kind,'ownerMembershipId',p_actor));
 RETURN party_id;
END $$;

CREATE OR REPLACE FUNCTION app.guard_party_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,app AS $$
DECLARE tenant uuid;party uuid;membership uuid;
BEGIN
  IF TG_OP='DELETE' THEN
    tenant:=OLD.tenant_id;
    IF TG_TABLE_NAME='parties' THEN party:=OLD.id;ELSE party:=OLD.party_id;END IF;
  ELSE
    tenant:=NEW.tenant_id;
    IF TG_TABLE_NAME='parties' THEN party:=NEW.id;ELSE party:=NEW.party_id;END IF;
  END IF;
  IF app.current_user_id() IS NULL THEN
    IF TG_OP='DELETE' THEN RETURN OLD;END IF;
    RETURN NEW;
  END IF;
  SELECT id INTO membership FROM tenant_memberships
  WHERE tenant_id=tenant AND user_id=app.current_user_id() AND status='active' ORDER BY accepted_at DESC NULLS LAST LIMIT 1;
  IF membership IS NULL OR NOT app.can_manage_party(tenant,membership,party) THEN
    RAISE EXCEPTION 'clients.update permission and party scope required';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD;END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER parties_scope_guard BEFORE UPDATE OR DELETE ON parties FOR EACH ROW EXECUTE FUNCTION app.guard_party_mutation();
CREATE TRIGGER individual_scope_guard BEFORE INSERT OR UPDATE OR DELETE ON party_individual_details FOR EACH ROW EXECUTE FUNCTION app.guard_party_mutation();
CREATE TRIGGER organization_scope_guard BEFORE INSERT OR UPDATE OR DELETE ON party_organization_details FOR EACH ROW EXECUTE FUNCTION app.guard_party_mutation();
CREATE TRIGGER contacts_scope_guard BEFORE INSERT OR UPDATE OR DELETE ON party_contacts FOR EACH ROW EXECUTE FUNCTION app.guard_party_mutation();
CREATE TRIGGER addresses_scope_guard BEFORE INSERT OR UPDATE OR DELETE ON party_addresses FOR EACH ROW EXECUTE FUNCTION app.guard_party_mutation();

CREATE OR REPLACE FUNCTION app.has_project_permission(p_tenant_id uuid,p_membership_id uuid,p_project_id uuid,p_permission text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,app AS $$
  SELECT EXISTS(
    SELECT 1 FROM (
      SELECT assignment.role_id FROM role_assignments assignment
      WHERE assignment.tenant_id=p_tenant_id AND assignment.membership_id=p_membership_id
      UNION
      SELECT assignment.role_id FROM project_role_assignments assignment
      WHERE assignment.tenant_id=p_tenant_id AND assignment.membership_id=p_membership_id AND assignment.project_id=p_project_id
    ) assigned
    JOIN role_permissions grant_row ON grant_row.tenant_id=p_tenant_id AND grant_row.role_id=assigned.role_id
    JOIN permissions permission ON permission.id=grant_row.permission_id
    WHERE permission.code=ANY(CASE p_permission
      WHEN 'project.read' THEN ARRAY['projects.read'] WHEN 'project.manage' THEN ARRAY['projects.update']
      WHEN 'unit.read' THEN ARRAY['units.read'] WHEN 'unit.manage' THEN ARRAY['units.update']
      WHEN 'accessory.read' THEN ARRAY['accessories.read'] WHEN 'accessory.manage' THEN ARRAY['accessories.update']
      WHEN 'clients.read' THEN ARRAY['clients.read_all','clients.read_own']
      WHEN 'clients.manage' THEN ARRAY['clients.update'] WHEN 'clients.export' THEN ARRAY['exports.run']
      WHEN 'sales_case.read' THEN ARRAY['sales_cases.read'] WHEN 'sales_case.manage' THEN ARRAY['sales_cases.manage']
      WHEN 'holds.manage' THEN ARRAY['holds.confirm']
      WHEN 'price.read' THEN ARRAY['prices.read'] WHEN 'price.manage' THEN ARRAY['prices.propose']
      WHEN 'price.approve' THEN ARRAY['prices.approve']
      WHEN 'contract.read' THEN ARRAY['contracts.read'] WHEN 'contract.manage' THEN ARRAY['contracts.create','contracts.update']
      WHEN 'contract.approve' THEN ARRAY['contracts.mark_ready'] WHEN 'contract.sign' THEN ARRAY['contracts.record_signature']
      WHEN 'documents.view' THEN ARRAY['documents.read'] WHEN 'documents.upload' THEN ARRAY['documents.create']
      WHEN 'documents.edit_metadata' THEN ARRAY['documents.update'] WHEN 'documents.manage' THEN ARRAY['documents.update']
      WHEN 'handover.read' THEN ARRAY['handovers.read'] WHEN 'handover.manage' THEN ARRAY['handovers.manage']
      ELSE ARRAY[p_permission] END)
  )
$$;

CREATE OR REPLACE FUNCTION app.create_unit_hold(
  p_tenant uuid,p_unit uuid,p_hold_type text,p_party_ids uuid[],p_expires_at timestamptz,
  p_actor_membership uuid,p_interest_id uuid,p_idempotency_key text,p_reason text
) RETURNS TABLE(sales_case_id uuid,hold_id uuid) LANGUAGE plpgsql AS $$
DECLARE project uuid;actor uuid;case_id uuid;new_hold uuid:=gen_random_uuid();participant_id uuid;interest_id uuid;stale uuid;required_permission text;
BEGIN
  SELECT project_id INTO project FROM units WHERE tenant_id=p_tenant AND id=p_unit FOR UPDATE;
  SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  required_permission:=CASE p_hold_type WHEN 'pre_reservation' THEN 'holds.create' WHEN 'reservation' THEN 'holds.confirm' ELSE NULL END;
  IF project IS NULL OR actor IS NULL OR required_permission IS NULL OR p_expires_at<=now() OR cardinality(p_party_ids)<1 THEN RAISE EXCEPTION 'invalid hold command';END IF;
  IF NOT app.has_project_permission(p_tenant,p_actor_membership,project,required_permission) THEN RAISE EXCEPTION '% permission required',required_permission;END IF;
  IF (SELECT count(DISTINCT value) FROM unnest(p_party_ids) value)<>cardinality(p_party_ids)
    OR (SELECT count(*) FROM parties WHERE tenant_id=p_tenant AND id=ANY(p_party_ids) AND lifecycle_status='active')<>cardinality(p_party_ids)
    OR EXISTS(SELECT 1 FROM unnest(p_party_ids) value WHERE NOT app.can_access_party(p_tenant,p_actor_membership,value,false))
  THEN RAISE EXCEPTION 'all participants must be unique, accessible active parties of the tenant';END IF;
  SELECT unit_holds.sales_case_id,unit_holds.id INTO case_id,new_hold FROM unit_holds WHERE tenant_id=p_tenant AND idempotency_key=p_idempotency_key;
  IF new_hold IS NOT NULL THEN RETURN QUERY SELECT case_id,new_hold;RETURN;END IF;
  new_hold:=gen_random_uuid();
  FOR stale IN SELECT id FROM unit_holds WHERE tenant_id=p_tenant AND unit_id=p_unit AND status='active' AND expires_at<=now() FOR UPDATE
  LOOP PERFORM app.expire_unit_hold(p_tenant,stale,p_actor_membership);END LOOP;
  IF EXISTS(SELECT 1 FROM unit_holds WHERE tenant_id=p_tenant AND unit_id=p_unit AND status='active' AND starts_at<p_expires_at AND now()<expires_at)
  THEN RAISE EXCEPTION 'unit hold interval overlaps an active hold';END IF;
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
    IF NOT EXISTS(SELECT 1 FROM party_project_links WHERE tenant_id=p_tenant AND project_id=project AND party_id=participant_id AND relationship_type='buyer' AND valid_to IS NULL)
    THEN INSERT INTO party_project_links(tenant_id,project_id,party_id,relationship_type) VALUES(p_tenant,project,participant_id,'buyer');END IF;
    INSERT INTO unit_interests(tenant_id,project_id,unit_id,party_id,status,first_interest_at,last_interest_at)
    VALUES(p_tenant,project,p_unit,participant_id,'converted',now(),now())
    ON CONFLICT(tenant_id,unit_id,party_id) DO UPDATE SET status='converted',last_interest_at=EXCLUDED.last_interest_at RETURNING id INTO interest_id;
    INSERT INTO interest_events(tenant_id,project_id,unit_interest_id,sales_case_id,event_type,outcome,occurred_at,recorded_by_membership_id)
    VALUES(p_tenant,project,interest_id,case_id,'converted_to_sales_case',p_hold_type,now(),p_actor_membership);
  END LOOP;
  IF p_interest_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM unit_interests WHERE tenant_id=p_tenant AND id=p_interest_id AND unit_id=p_unit)
  THEN RAISE EXCEPTION 'interest does not belong to unit';END IF;
  INSERT INTO unit_holds(id,tenant_id,project_id,unit_id,sales_case_id,hold_type,starts_at,expires_at,idempotency_key,created_by_membership_id)
  VALUES(new_hold,p_tenant,project,p_unit,case_id,p_hold_type,now(),p_expires_at,p_idempotency_key,p_actor_membership);
  PERFORM app.record_sales_stage(p_tenant,case_id,CASE p_hold_type WHEN 'pre_reservation' THEN 'pre_reservation' ELSE 'reservation' END,
    CASE p_hold_type WHEN 'pre_reservation' THEN 'createPreReservation' ELSE 'createReservation' END,p_reason,p_actor_membership);
  PERFORM app.transition_unit_commercial_status(p_tenant,p_unit,CASE p_hold_type WHEN 'pre_reservation' THEN 'pre_reserved' ELSE 'reserved' END,
    CASE p_hold_type WHEN 'pre_reservation' THEN 'createPreReservation' ELSE 'createReservation' END,p_reason,p_actor_membership);
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data)
  VALUES(p_tenant,actor,'hold.created','unit_hold',new_hold,jsonb_build_object('type',p_hold_type,'unitId',p_unit,'salesCaseId',case_id));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'hold',new_hold,'hold.created.v2',jsonb_build_object('holdId',new_hold,'unitId',p_unit,'salesCaseId',case_id,'type',p_hold_type));
  RETURN QUERY SELECT case_id,new_hold;
END $$;

CREATE OR REPLACE FUNCTION app.convert_pre_reservation(
  p_tenant uuid,p_hold uuid,p_expires_at timestamptz,p_actor_membership uuid,p_idempotency_key text,p_reason text
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE old unit_holds%ROWTYPE;new_hold uuid:=gen_random_uuid();actor uuid;
BEGIN
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

CREATE OR REPLACE FUNCTION app.cancel_unit_hold(p_tenant uuid,p_hold uuid,p_actor_membership uuid,p_reason text)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE hold_row unit_holds%ROWTYPE;actor uuid;command text;unit_status text;
BEGIN
  SELECT * INTO hold_row FROM unit_holds WHERE tenant_id=p_tenant AND id=p_hold FOR UPDATE;
  IF hold_row.id IS NULL OR hold_row.status<>'active' THEN RETURN false;END IF;
  SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF actor IS NULL OR length(btrim(p_reason))<3 THEN RAISE EXCEPTION 'active actor and reason are required';END IF;
  IF NOT app.has_project_permission(p_tenant,p_actor_membership,hold_row.project_id,'holds.cancel') THEN RAISE EXCEPTION 'holds.cancel permission required';END IF;
  UPDATE unit_holds SET status='cancelled',ended_at=now() WHERE tenant_id=p_tenant AND id=p_hold;
  command:=CASE hold_row.hold_type WHEN 'pre_reservation' THEN 'cancelPreReservation' ELSE 'cancelReservation' END;
  SELECT commercial_status INTO unit_status FROM units WHERE tenant_id=p_tenant AND id=hold_row.unit_id FOR UPDATE;
  IF NOT EXISTS(SELECT 1 FROM unit_holds WHERE tenant_id=p_tenant AND unit_id=hold_row.unit_id AND status='active' AND starts_at<=now() AND expires_at>now())
    AND unit_status=(CASE hold_row.hold_type WHEN 'pre_reservation' THEN 'pre_reserved' ELSE 'reserved' END)
  THEN
    PERFORM app.record_sales_stage(p_tenant,hold_row.sales_case_id,'interest',command,p_reason,p_actor_membership);
    PERFORM app.transition_unit_commercial_status(p_tenant,hold_row.unit_id,'available',command,p_reason,p_actor_membership);
  END IF;
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'hold',p_hold,'hold.cancelled.v2',jsonb_build_object('holdId',p_hold,'unitId',hold_row.unit_id,'reason',p_reason));
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data)
  VALUES(p_tenant,actor,'hold.cancelled','unit_hold',p_hold,jsonb_build_object('reason',p_reason));
  RETURN true;
END $$;

GRANT EXECUTE ON FUNCTION app.can_access_party(uuid,uuid,uuid,boolean) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.can_manage_party(uuid,uuid,uuid) TO develocrm_app;

COMMIT;

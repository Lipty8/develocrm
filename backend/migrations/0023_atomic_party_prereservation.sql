BEGIN;

ALTER TABLE party_individual_details
  ADD COLUMN IF NOT EXISTS salutation text
  CHECK (salutation IS NULL OR salutation IN ('pan','paní'));

CREATE OR REPLACE FUNCTION app.guard_party_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,app AS $$
DECLARE tenant uuid;party uuid;membership uuid;creation_party uuid;
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
  WHERE tenant_id=tenant AND user_id=app.current_user_id() AND status='active'
  ORDER BY accepted_at DESC NULLS LAST LIMIT 1;

  creation_party:=NULLIF(current_setting('app.party_creation_id',true),'')::uuid;
  IF TG_OP='INSERT' AND creation_party=party AND EXISTS(
    SELECT 1
    FROM parties created
    JOIN party_project_links link ON link.tenant_id=created.tenant_id AND link.party_id=created.id AND link.valid_to IS NULL
    WHERE created.tenant_id=tenant AND created.id=party AND created.owner_membership_id=membership
      AND app.has_project_permission(tenant,membership,link.project_id,'clients.create')
  ) THEN
    RETURN NEW;
  END IF;

  IF membership IS NULL OR NOT app.can_manage_party(tenant,membership,party) THEN
    RAISE EXCEPTION 'clients.update permission and party scope required';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD;END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.create_party_for_project(
  p_tenant uuid,p_project uuid,p_kind text,p_salutation text,p_first_name text,p_last_name text,p_legal_name text,
  p_registration text,p_email text,p_phone text,p_actor uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE party_id uuid:=gen_random_uuid();display text;actor_user uuid;normalized_registration text;partner uuid;
BEGIN
 IF NOT app.has_project_permission(p_tenant,p_actor,p_project,'clients.create') THEN RAISE EXCEPTION 'clients.create permission required'; END IF;
 IF p_kind NOT IN ('individual','organization') THEN RAISE EXCEPTION 'invalid party type'; END IF;
 IF p_kind='individual' AND (NULLIF(btrim(p_first_name),'') IS NULL OR NULLIF(btrim(p_last_name),'') IS NULL) THEN RAISE EXCEPTION 'first name and last name are required'; END IF;
 IF p_salutation IS NOT NULL AND p_salutation NOT IN ('pan','paní') THEN RAISE EXCEPTION 'invalid salutation'; END IF;
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
 INSERT INTO party_project_links(tenant_id,project_id,party_id,relationship_type)
 VALUES(p_tenant,p_project,party_id,'prospect');
 PERFORM set_config('app.party_creation_id',party_id::text,true);
 IF p_kind='individual' THEN
   INSERT INTO party_individual_details(tenant_id,party_id,salutation,first_name,last_name)
   VALUES(p_tenant,party_id,p_salutation,btrim(p_first_name),btrim(p_last_name));
 ELSE
   INSERT INTO party_organization_details(tenant_id,party_id,legal_name,registration_number)
   VALUES(p_tenant,party_id,display,normalized_registration);
 END IF;
 IF NULLIF(btrim(p_email),'') IS NOT NULL THEN
   INSERT INTO party_contacts(tenant_id,party_id,contact_type,value,normalized_value,is_primary)
   VALUES(p_tenant,party_id,'email',btrim(p_email),lower(btrim(p_email)),true);
 END IF;
 IF NULLIF(btrim(p_phone),'') IS NOT NULL THEN
   INSERT INTO party_contacts(tenant_id,party_id,contact_type,value,normalized_value,is_primary)
   VALUES(p_tenant,party_id,'phone',btrim(p_phone),regexp_replace(btrim(p_phone),'[^0-9+]','','g'),true);
 END IF;
 PERFORM set_config('app.party_creation_id','',true);
 INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data)
 VALUES(p_tenant,actor_user,'party.created','party',party_id,jsonb_build_object('projectId',p_project,'partyType',p_kind,'displayName',display,'ownerMembershipId',p_actor,'sourcePartnerPartyId',partner));
 INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
 VALUES(p_tenant,'party',party_id,'party.created.v2',jsonb_build_object('projectId',p_project,'partyType',p_kind,'ownerMembershipId',p_actor));
 RETURN party_id;
END $$;

CREATE OR REPLACE FUNCTION app.create_party_for_project(
  p_tenant uuid,p_project uuid,p_kind text,p_first_name text,p_last_name text,p_legal_name text,
  p_registration text,p_email text,p_phone text,p_actor uuid
) RETURNS uuid LANGUAGE sql SECURITY INVOKER AS $$
  SELECT app.create_party_for_project(p_tenant,p_project,p_kind,NULL,p_first_name,p_last_name,p_legal_name,p_registration,p_email,p_phone,p_actor)
$$;

CREATE OR REPLACE FUNCTION app.create_party_and_unit_hold(
  p_tenant uuid,p_unit uuid,p_hold_type text,p_expires_at timestamptz,p_actor uuid,p_idempotency_key text,p_reason text,
  p_kind text,p_salutation text,p_first_name text,p_last_name text,p_legal_name text,p_registration text,p_email text,p_phone text
) RETURNS TABLE(party_id uuid,sales_case_id uuid,hold_id uuid) LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE project uuid;existing_hold uuid;existing_case uuid;existing_party uuid;created_party uuid;created record;required_permission text;
BEGIN
  SELECT project_id INTO project FROM units WHERE tenant_id=p_tenant AND id=p_unit FOR UPDATE;
  required_permission:=CASE p_hold_type WHEN 'pre_reservation' THEN 'holds.create' WHEN 'reservation' THEN 'holds.confirm' ELSE NULL END;
  IF project IS NULL OR required_permission IS NULL THEN RAISE EXCEPTION 'invalid hold command'; END IF;
  IF NOT app.has_project_permission(p_tenant,p_actor,project,'clients.create') THEN RAISE EXCEPTION 'clients.create permission required'; END IF;
  IF NOT app.has_project_permission(p_tenant,p_actor,project,required_permission) THEN RAISE EXCEPTION '% permission required',required_permission; END IF;

  SELECT hold.id,hold.sales_case_id,participant.party_id INTO existing_hold,existing_case,existing_party
  FROM unit_holds hold
  LEFT JOIN LATERAL(
    SELECT participant_row.party_id FROM sales_case_parties participant_row
    WHERE participant_row.tenant_id=hold.tenant_id AND participant_row.sales_case_id=hold.sales_case_id AND participant_row.left_at IS NULL
    ORDER BY participant_row.is_primary DESC,participant_row.joined_at LIMIT 1
  ) participant ON true
  WHERE hold.tenant_id=p_tenant AND hold.idempotency_key=p_idempotency_key;
  IF existing_hold IS NOT NULL THEN
    RETURN QUERY SELECT existing_party,existing_case,existing_hold;
    RETURN;
  END IF;

  created_party:=app.create_party_for_project(p_tenant,project,p_kind,p_salutation,p_first_name,p_last_name,p_legal_name,p_registration,p_email,p_phone,p_actor);
  SELECT * INTO created FROM app.create_unit_hold(p_tenant,p_unit,p_hold_type,ARRAY[created_party]::uuid[],p_expires_at,p_actor,NULL,p_idempotency_key,p_reason);
  RETURN QUERY SELECT created_party,created.sales_case_id,created.hold_id;
END $$;

INSERT INTO role_permissions(tenant_id,role_id,permission_id)
SELECT role.tenant_id,role.id,permission.id
FROM roles role
JOIN permissions permission ON permission.code=ANY(ARRAY['clients.create','clients.update','interests.manage','sales_cases.read','sales_cases.manage','holds.create','holds.cancel','holds.confirm'])
WHERE role.code='admin'
ON CONFLICT DO NOTHING;

GRANT EXECUTE ON FUNCTION app.create_party_for_project(uuid,uuid,text,text,text,text,text,text,text,text,uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.create_party_and_unit_hold(uuid,uuid,text,timestamptz,uuid,text,text,text,text,text,text,text,text,text,text) TO develocrm_app;

COMMIT;

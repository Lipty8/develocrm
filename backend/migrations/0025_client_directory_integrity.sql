BEGIN;

DROP INDEX IF EXISTS party_organization_registration_uq;
CREATE INDEX IF NOT EXISTS party_organization_registration_idx ON party_organization_details(tenant_id,upper(registration_number)) WHERE registration_number IS NOT NULL;

INSERT INTO permissions(code,description) VALUES
 ('clients.archive','Archivovat klienty se zachováním obchodní a auditní historie')
ON CONFLICT(code) DO UPDATE SET description=EXCLUDED.description;

INSERT INTO role_permissions(tenant_id,role_id,permission_id)
SELECT role.tenant_id,role.id,permission.id FROM roles role CROSS JOIN permissions permission
WHERE role.code='admin' AND permission.code='clients.archive'
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION app.create_party_for_project(
  p_tenant uuid,p_project uuid,p_kind text,p_salutation text,p_first_name text,p_last_name text,p_legal_name text,
  p_registration text,p_email text,p_phone text,p_actor uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE party_id uuid:=gen_random_uuid();display text;actor_user uuid;normalized_registration text;partner uuid;duplicate_override boolean;
BEGIN
 duplicate_override:=COALESCE(current_setting('app.party_duplicate_override',true),'')='on';
 IF NOT app.has_project_permission(p_tenant,p_actor,p_project,'clients.create') THEN RAISE EXCEPTION 'clients.create permission required'; END IF;
 IF p_kind NOT IN ('individual','organization') THEN RAISE EXCEPTION 'invalid party type'; END IF;
 IF p_kind='individual' AND (NULLIF(btrim(p_first_name),'') IS NULL OR NULLIF(btrim(p_last_name),'') IS NULL) THEN RAISE EXCEPTION 'first name and last name are required'; END IF;
 IF p_salutation IS NOT NULL AND p_salutation NOT IN ('pan','paní') THEN RAISE EXCEPTION 'invalid salutation'; END IF;
 IF p_kind='individual' THEN display:=btrim(concat_ws(' ',p_first_name,p_last_name));ELSE display:=btrim(p_legal_name);END IF;
 IF length(display)<2 THEN RAISE EXCEPTION 'party name is required'; END IF;
 normalized_registration:=NULLIF(upper(regexp_replace(COALESCE(p_registration,''),'[^[:alnum:]]','','g')),'');
 IF NOT duplicate_override AND p_kind='organization' AND normalized_registration IS NOT NULL AND EXISTS(
   SELECT 1 FROM party_organization_details detail WHERE detail.tenant_id=p_tenant AND upper(regexp_replace(detail.registration_number,'[^[:alnum:]]','','g'))=normalized_registration
 ) THEN RAISE EXCEPTION 'party duplicate confirmation required'; END IF;
 SELECT user_id,partner_party_id INTO actor_user,partner FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor AND status='active';
 IF actor_user IS NULL THEN RAISE EXCEPTION 'active actor membership required'; END IF;
 INSERT INTO parties(id,tenant_id,party_type,display_name,owner_membership_id,source_partner_party_id) VALUES(party_id,p_tenant,p_kind,display,p_actor,partner);
 INSERT INTO party_project_links(tenant_id,project_id,party_id,relationship_type) VALUES(p_tenant,p_project,party_id,'prospect');
 PERFORM set_config('app.party_creation_id',party_id::text,true);
 IF p_kind='individual' THEN
   INSERT INTO party_individual_details(tenant_id,party_id,salutation,first_name,last_name) VALUES(p_tenant,party_id,p_salutation,btrim(p_first_name),btrim(p_last_name));
 ELSE
   INSERT INTO party_organization_details(tenant_id,party_id,legal_name,registration_number) VALUES(p_tenant,party_id,display,normalized_registration);
 END IF;
 IF NULLIF(btrim(p_email),'') IS NOT NULL THEN
   INSERT INTO party_contacts(tenant_id,party_id,contact_type,value,normalized_value,is_primary) VALUES(p_tenant,party_id,'email',btrim(p_email),lower(btrim(p_email)),true);
 END IF;
 IF NULLIF(btrim(p_phone),'') IS NOT NULL THEN
   INSERT INTO party_contacts(tenant_id,party_id,contact_type,value,normalized_value,is_primary) VALUES(p_tenant,party_id,'phone',btrim(p_phone),regexp_replace(btrim(p_phone),'[^0-9+]','','g'),true);
 END IF;
 PERFORM set_config('app.party_creation_id','',true);
 INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data,metadata)
 VALUES(p_tenant,actor_user,'party.created','party',party_id,jsonb_build_object('projectId',p_project,'partyType',p_kind,'displayName',display),jsonb_build_object('duplicateWarningOverridden',duplicate_override));
 INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
 VALUES(p_tenant,'party',party_id,'party.created.v3',jsonb_build_object('projectId',p_project,'partyType',p_kind,'duplicateWarningOverridden',duplicate_override));
 RETURN party_id;
END $$;

CREATE OR REPLACE FUNCTION app.create_party_and_unit_hold(
  p_tenant uuid,p_unit uuid,p_hold_type text,p_expires_at timestamptz,p_actor uuid,p_idempotency_key text,p_reason text,
  p_kind text,p_salutation text,p_first_name text,p_last_name text,p_legal_name text,p_registration text,p_email text,p_phone text,p_duplicate_override boolean
) RETURNS TABLE(party_id uuid,sales_case_id uuid,hold_id uuid) LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE project uuid;existing_hold uuid;existing_case uuid;existing_party uuid;created_party uuid;created record;required_permission text;display text;phone_digits text;
BEGIN
  SELECT project_id INTO project FROM units WHERE tenant_id=p_tenant AND id=p_unit FOR UPDATE;
  required_permission:=CASE p_hold_type WHEN 'pre_reservation' THEN 'holds.create' WHEN 'reservation' THEN 'holds.confirm' ELSE NULL END;
  IF project IS NULL OR required_permission IS NULL THEN RAISE EXCEPTION 'invalid hold command'; END IF;
  IF NOT app.has_project_permission(p_tenant,p_actor,project,'clients.create') THEN RAISE EXCEPTION 'clients.create permission required'; END IF;
  IF NOT app.has_project_permission(p_tenant,p_actor,project,required_permission) THEN RAISE EXCEPTION '% permission required',required_permission; END IF;
  SELECT hold.id,hold.sales_case_id,participant.party_id INTO existing_hold,existing_case,existing_party FROM unit_holds hold
  LEFT JOIN LATERAL(SELECT row.party_id FROM sales_case_parties row WHERE row.tenant_id=hold.tenant_id AND row.sales_case_id=hold.sales_case_id AND row.left_at IS NULL ORDER BY row.is_primary DESC,row.joined_at LIMIT 1) participant ON true
  WHERE hold.tenant_id=p_tenant AND hold.idempotency_key=p_idempotency_key;
  IF existing_hold IS NOT NULL THEN RETURN QUERY SELECT existing_party,existing_case,existing_hold;RETURN;END IF;
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
  RETURN QUERY SELECT created_party,created.sales_case_id,created.hold_id;
END $$;

CREATE OR REPLACE FUNCTION app.create_party_and_unit_hold(
  p_tenant uuid,p_unit uuid,p_hold_type text,p_expires_at timestamptz,p_actor uuid,p_idempotency_key text,p_reason text,
  p_kind text,p_salutation text,p_first_name text,p_last_name text,p_legal_name text,p_registration text,p_email text,p_phone text
) RETURNS TABLE(party_id uuid,sales_case_id uuid,hold_id uuid) LANGUAGE sql SECURITY INVOKER AS $$
  SELECT * FROM app.create_party_and_unit_hold(p_tenant,p_unit,p_hold_type,p_expires_at,p_actor,p_idempotency_key,p_reason,p_kind,p_salutation,p_first_name,p_last_name,p_legal_name,p_registration,p_email,p_phone,false)
$$;

CREATE OR REPLACE FUNCTION app.link_party_to_project(p_tenant uuid,p_party uuid,p_project uuid,p_actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE link_id uuid;actor_user uuid;
BEGIN
 IF NOT app.has_project_permission(p_tenant,p_actor,p_project,'clients.create') THEN RAISE EXCEPTION 'clients.create permission required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM parties WHERE tenant_id=p_tenant AND id=p_party AND archived_at IS NULL) THEN RAISE EXCEPTION 'active party required'; END IF;
 SELECT id INTO link_id FROM party_project_links WHERE tenant_id=p_tenant AND project_id=p_project AND party_id=p_party AND valid_to IS NULL ORDER BY valid_from LIMIT 1;
 IF link_id IS NOT NULL THEN RETURN link_id; END IF;
 INSERT INTO party_project_links(tenant_id,project_id,party_id,relationship_type) VALUES(p_tenant,p_project,p_party,'prospect') RETURNING id INTO link_id;
 SELECT user_id INTO actor_user FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor AND status='active';
 INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data) VALUES(p_tenant,actor_user,'party.project_linked','party',p_party,jsonb_build_object('projectId',p_project,'linkId',link_id));
 INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload) VALUES(p_tenant,'party',p_party,'party.project_linked.v1',jsonb_build_object('projectId',p_project,'linkId',link_id));
 RETURN link_id;
END $$;

CREATE OR REPLACE FUNCTION app.party_archive_impact(p_tenant uuid,p_party uuid,p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE result jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM party_project_links link WHERE link.tenant_id=p_tenant AND link.party_id=p_party AND app.has_project_permission(p_tenant,p_actor,link.project_id,'clients.archive')) THEN RAISE EXCEPTION 'clients.archive permission required'; END IF;
 WITH related_units AS (
   SELECT unit_id FROM unit_interests WHERE tenant_id=p_tenant AND party_id=p_party
   UNION SELECT sales_case.unit_id FROM sales_case_parties participant JOIN sales_cases sales_case ON sales_case.tenant_id=participant.tenant_id AND sales_case.id=participant.sales_case_id WHERE participant.tenant_id=p_tenant AND participant.party_id=p_party
 ), related_contracts AS (
   SELECT contract_id FROM contract_parties WHERE tenant_id=p_tenant AND party_id=p_party
   UNION SELECT contract.id FROM contracts contract JOIN sales_case_parties participant ON participant.tenant_id=contract.tenant_id AND participant.sales_case_id=contract.sales_case_id WHERE contract.tenant_id=p_tenant AND participant.party_id=p_party
 )
 SELECT jsonb_build_object(
   'units',(SELECT count(DISTINCT unit_id) FROM related_units),
   'interests',(SELECT count(*) FROM unit_interests WHERE tenant_id=p_tenant AND party_id=p_party),
   'salesCases',(SELECT count(DISTINCT sales_case_id) FROM sales_case_parties WHERE tenant_id=p_tenant AND party_id=p_party),
   'contracts',(SELECT count(*) FROM related_contracts),
   'payments',(SELECT count(*) FROM payment_obligations WHERE tenant_id=p_tenant AND party_id=p_party),
   'tasks',(SELECT count(*) FROM tasks WHERE tenant_id=p_tenant AND party_id=p_party),
   'handovers',(SELECT count(*) FROM unit_handovers WHERE tenant_id=p_tenant AND unit_id IN(SELECT unit_id FROM related_units)),
   'documents',(SELECT count(*) FROM party_documents WHERE tenant_id=p_tenant AND party_id=p_party)
 ) INTO result;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION app.archive_party(p_tenant uuid,p_party uuid,p_actor uuid,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE impact jsonb;actor_user uuid;before_row jsonb;after_row jsonb;
BEGIN
 IF length(btrim(p_reason))<3 THEN RAISE EXCEPTION 'archive reason is required'; END IF;
 impact:=app.party_archive_impact(p_tenant,p_party,p_actor);
 SELECT user_id INTO actor_user FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor AND status='active';
 SELECT to_jsonb(party) INTO before_row FROM parties party WHERE tenant_id=p_tenant AND id=p_party FOR UPDATE;
 IF before_row IS NULL THEN RAISE EXCEPTION 'party not found'; END IF;
 IF (before_row->>'lifecycle_status')='archived' THEN RETURN impact; END IF;
 UPDATE parties SET lifecycle_status='archived',archived_at=now(),updated_at=now() WHERE tenant_id=p_tenant AND id=p_party RETURNING to_jsonb(parties) INTO after_row;
 INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data,metadata) VALUES(p_tenant,actor_user,'party.archived','party',p_party,before_row,after_row,jsonb_build_object('reason',btrim(p_reason),'impact',impact));
 INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload) VALUES(p_tenant,'party',p_party,'party.archived.v1',jsonb_build_object('reason',btrim(p_reason),'impact',impact));
 RETURN impact;
END $$;

GRANT EXECUTE ON FUNCTION app.create_party_for_project(uuid,uuid,text,text,text,text,text,text,text,text,uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.create_party_and_unit_hold(uuid,uuid,text,timestamptz,uuid,text,text,text,text,text,text,text,text,text,text,boolean) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.link_party_to_project(uuid,uuid,uuid,uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.party_archive_impact(uuid,uuid,uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.archive_party(uuid,uuid,uuid,text) TO develocrm_app;

COMMIT;

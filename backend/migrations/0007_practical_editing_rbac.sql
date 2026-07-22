BEGIN;

INSERT INTO permissions(code,description) VALUES
 ('projects.change_manager','Měnit vedoucího projektu'),
 ('projects.change_status','Zapisovat fázi projektu'),
 ('prices.propose','Navrhovat změnu ceny'),
 ('prices.change','Zapsat platnou změnu ceny'),
 ('prices.approve','Schvalovat cenu nebo slevu'),
 ('holds.cancel','Rušit aktivní předrezervace a rezervace')
ON CONFLICT(code) DO NOTHING;

INSERT INTO role_permissions(tenant_id,role_id,permission_id)
SELECT role.tenant_id,role.id,permission.id FROM roles role CROSS JOIN permissions permission
WHERE role.code='admin' ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(tenant_id,role_id,permission_id)
SELECT role.tenant_id,role.id,permission.id FROM roles role JOIN permissions permission ON permission.code IN
 ('projects.change_manager','projects.change_status','prices.propose','prices.change','prices.approve','holds.cancel')
WHERE role.code='project_manager' ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(tenant_id,role_id,permission_id)
SELECT role.tenant_id,role.id,permission.id FROM roles role JOIN permissions permission ON permission.code IN
 ('prices.propose','holds.cancel') WHERE role.code='sales' ON CONFLICT DO NOTHING;
DELETE FROM role_permissions grant_row USING roles role,permissions permission
WHERE grant_row.tenant_id=role.tenant_id AND grant_row.role_id=role.id AND grant_row.permission_id=permission.id
  AND role.code IN ('sales','back_office') AND permission.code IN ('price.manage','price.approve','prices.change','prices.approve');

CREATE OR REPLACE FUNCTION app.record_project_construction_status(
 p_tenant uuid,p_project uuid,p_status text,p_effective_at timestamptz,p_note text,p_actor uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE event_id uuid; actor_user uuid;
BEGIN
 IF NOT app.has_project_permission(p_tenant,p_actor,p_project,'projects.change_status') THEN RAISE EXCEPTION 'projects.change_status permission required'; END IF;
 IF p_status NOT IN ('preparation','permitting','construction','rough_construction','installations','fit_out','completed') THEN RAISE EXCEPTION 'invalid construction status'; END IF;
 SELECT user_id INTO actor_user FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor AND status='active';
 INSERT INTO construction_status_events(tenant_id,project_id,structure_id,status_code,effective_at,note,recorded_by_membership_id)
 VALUES(p_tenant,p_project,NULL,p_status,p_effective_at,NULLIF(btrim(p_note),''),p_actor) RETURNING id INTO event_id;
 INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data)
 VALUES(p_tenant,actor_user,'project.construction_status_recorded','construction_status_event',event_id,jsonb_build_object('projectId',p_project,'status',p_status,'effectiveAt',p_effective_at));
 INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
 VALUES(p_tenant,'project',p_project,'project.construction_status_recorded.v1',jsonb_build_object('eventId',event_id,'status',p_status,'effectiveAt',p_effective_at));
 RETURN event_id;
END $$;

CREATE OR REPLACE FUNCTION app.update_project_details(p_tenant uuid,p_project uuid,p_name text,p_location text,p_lifecycle text,p_manager uuid,p_handover_from date,p_handover_to date,p_actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE old_row jsonb;new_row jsonb;old_manager uuid;actor_user uuid;
BEGIN
 IF NOT app.has_project_permission(p_tenant,p_actor,p_project,'project.manage') THEN RAISE EXCEPTION 'project.manage permission required'; END IF;
 SELECT to_jsonb(project),manager_membership_id INTO old_row,old_manager FROM projects project WHERE tenant_id=p_tenant AND id=p_project FOR UPDATE;
 IF old_row IS NULL THEN RAISE EXCEPTION 'project not found'; END IF;
 IF old_manager IS DISTINCT FROM p_manager AND NOT app.has_project_permission(p_tenant,p_actor,p_project,'projects.change_manager') THEN RAISE EXCEPTION 'projects.change_manager permission required'; END IF;
 IF p_manager IS NOT NULL AND NOT EXISTS(SELECT 1 FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_manager AND status='active') THEN RAISE EXCEPTION 'project manager must be an active tenant member'; END IF;
 SELECT user_id INTO actor_user FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor;
 UPDATE projects SET name=btrim(p_name),location=NULLIF(btrim(p_location),''),lifecycle_status=p_lifecycle,manager_membership_id=p_manager,planned_handover_from=p_handover_from,planned_handover_to=p_handover_to,archived_at=CASE WHEN p_lifecycle='archived' THEN COALESCE(archived_at,now()) ELSE NULL END WHERE tenant_id=p_tenant AND id=p_project RETURNING to_jsonb(projects) INTO new_row;
 INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data) VALUES(p_tenant,actor_user,'project.updated','project',p_project,old_row,new_row);
 INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload) VALUES(p_tenant,'project',p_project,'project.updated.v2',new_row);
 RETURN p_project;
END $$;

CREATE OR REPLACE FUNCTION app.update_unit_details_v2(p_tenant uuid,p_unit uuid,p_structure uuid,p_layout text,p_floor_label text,p_floor_number numeric,p_area numeric,p_usable numeric,p_orientation text,p_balcony numeric,p_terrace numeric,p_garden numeric,p_actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE old_row jsonb;new_row jsonb;v_project uuid;actor_user uuid;
BEGIN
 SELECT u.project_id INTO v_project FROM units u WHERE u.tenant_id=p_tenant AND u.id=p_unit FOR UPDATE;
 IF v_project IS NULL OR NOT app.has_project_permission(p_tenant,p_actor,v_project,'unit.manage') THEN RAISE EXCEPTION 'unit.manage permission required'; END IF;
 IF p_structure IS NOT NULL AND NOT EXISTS(SELECT 1 FROM project_structures structure WHERE structure.tenant_id=p_tenant AND structure.project_id=v_project AND structure.id=p_structure AND structure.archived_at IS NULL) THEN RAISE EXCEPTION 'structure must belong to the unit project'; END IF;
 SELECT to_jsonb(u) INTO old_row FROM units u WHERE u.tenant_id=p_tenant AND u.id=p_unit;
 SELECT user_id INTO actor_user FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor;
 UPDATE units SET structure_id=p_structure,layout=NULLIF(btrim(p_layout),''),floor_label=NULLIF(btrim(p_floor_label),''),floor_number=p_floor_number,area_m2=p_area,usable_area_m2=p_usable,orientation=NULLIF(btrim(p_orientation),''),balcony_m2=p_balcony,terrace_m2=p_terrace,garden_m2=p_garden WHERE tenant_id=p_tenant AND id=p_unit RETURNING to_jsonb(units) INTO new_row;
 INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data) VALUES(p_tenant,actor_user,'unit.updated','unit',p_unit,old_row,new_row);
 INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload) VALUES(p_tenant,'unit',p_unit,'unit.updated.v2',new_row);
 RETURN p_unit;
END $$;

CREATE OR REPLACE FUNCTION app.update_party_profile(p_tenant uuid,p_party uuid,p_first_name text,p_last_name text,p_legal_name text,p_registration text,p_vat text,p_contact_person text,p_actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE kind text;display text;actor_user uuid;before_row jsonb;after_row jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM party_project_links link WHERE link.tenant_id=p_tenant AND link.party_id=p_party AND link.valid_to IS NULL AND app.has_project_permission(p_tenant,p_actor,link.project_id,'clients.manage')) THEN RAISE EXCEPTION 'clients.manage permission required'; END IF;
 SELECT party_type,to_jsonb(parties) INTO kind,before_row FROM parties WHERE tenant_id=p_tenant AND id=p_party FOR UPDATE;
 IF kind='individual' THEN
   display:=btrim(concat_ws(' ',p_first_name,p_last_name));IF length(display)<2 THEN RAISE EXCEPTION 'individual name is required'; END IF;
   INSERT INTO party_individual_details(tenant_id,party_id,first_name,last_name) VALUES(p_tenant,p_party,btrim(p_first_name),btrim(p_last_name)) ON CONFLICT(tenant_id,party_id) DO UPDATE SET first_name=excluded.first_name,last_name=excluded.last_name;
 ELSE
   display:=btrim(p_legal_name);IF length(display)<2 THEN RAISE EXCEPTION 'legal name is required'; END IF;
   INSERT INTO party_organization_details(tenant_id,party_id,legal_name,registration_number,vat_number,contact_person) VALUES(p_tenant,p_party,display,NULLIF(btrim(p_registration),''),NULLIF(btrim(p_vat),''),NULLIF(btrim(p_contact_person),'')) ON CONFLICT(tenant_id,party_id) DO UPDATE SET legal_name=excluded.legal_name,registration_number=excluded.registration_number,vat_number=excluded.vat_number,contact_person=excluded.contact_person;
 END IF;
 UPDATE parties SET display_name=display WHERE tenant_id=p_tenant AND id=p_party RETURNING to_jsonb(parties) INTO after_row;
 SELECT user_id INTO actor_user FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor;
 INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data) VALUES(p_tenant,actor_user,'party.profile_updated','party',p_party,before_row,after_row);
 INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload) VALUES(p_tenant,'party',p_party,'party.profile_updated.v1',after_row);
 RETURN p_party;
END $$;

CREATE OR REPLACE FUNCTION app.upsert_party_primary_address(p_tenant uuid,p_party uuid,p_type text,p_line1 text,p_line2 text,p_city text,p_postal text,p_country char(2),p_actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE address_id uuid;project_id uuid;actor_user uuid;
BEGIN
 SELECT link.project_id INTO project_id FROM party_project_links link WHERE link.tenant_id=p_tenant AND link.party_id=p_party AND link.valid_to IS NULL AND app.has_project_permission(p_tenant,p_actor,link.project_id,'clients.manage') LIMIT 1;
 IF project_id IS NULL THEN RAISE EXCEPTION 'clients.manage permission required'; END IF;
 UPDATE party_addresses SET is_primary=false WHERE tenant_id=p_tenant AND party_id=p_party AND address_type=p_type AND is_primary AND valid_to IS NULL;
 INSERT INTO party_addresses(tenant_id,party_id,address_type,line1,line2,city,postal_code,country_code,is_primary) VALUES(p_tenant,p_party,p_type,btrim(p_line1),NULLIF(btrim(p_line2),''),btrim(p_city),NULLIF(btrim(p_postal),''),upper(p_country),true) RETURNING id INTO address_id;
 SELECT user_id INTO actor_user FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor;
 INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data) VALUES(p_tenant,actor_user,'party.address_updated','party_address',address_id,jsonb_build_object('partyId',p_party,'type',p_type));
 RETURN address_id;
END $$;

CREATE OR REPLACE FUNCTION app.add_unit_interest(p_tenant uuid,p_unit uuid,p_party uuid,p_event_type text,p_note text,p_actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE project uuid;interest_id uuid;actor_user uuid;
BEGIN
 SELECT project_id INTO project FROM units WHERE tenant_id=p_tenant AND id=p_unit;
 IF project IS NULL OR NOT app.has_project_permission(p_tenant,p_actor,project,'interests.manage') THEN RAISE EXCEPTION 'interests.manage permission required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM parties WHERE tenant_id=p_tenant AND id=p_party AND archived_at IS NULL) THEN RAISE EXCEPTION 'party not found'; END IF;
 INSERT INTO party_project_links(tenant_id,project_id,party_id,relationship_type) VALUES(p_tenant,project,p_party,'prospect') ON CONFLICT DO NOTHING;
 SELECT id INTO interest_id FROM unit_interests WHERE tenant_id=p_tenant AND unit_id=p_unit AND party_id=p_party;
 IF interest_id IS NULL THEN INSERT INTO unit_interests(tenant_id,project_id,unit_id,party_id,status,first_interest_at,last_interest_at) VALUES(p_tenant,project,p_unit,p_party,'active',now(),now()) RETURNING id INTO interest_id;
 ELSE UPDATE unit_interests SET status='active',last_interest_at=now() WHERE tenant_id=p_tenant AND id=interest_id; END IF;
 INSERT INTO interest_events(tenant_id,project_id,unit_interest_id,event_type,note,occurred_at,recorded_by_membership_id) VALUES(p_tenant,project,interest_id,p_event_type,NULLIF(btrim(p_note),''),now(),p_actor);
 SELECT user_id INTO actor_user FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor;
 INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data) VALUES(p_tenant,actor_user,'unit.interest_recorded','unit_interest',interest_id,jsonb_build_object('unitId',p_unit,'partyId',p_party,'eventType',p_event_type));
 INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload) VALUES(p_tenant,'unit_interest',interest_id,'unit.interest_recorded.v1',jsonb_build_object('unitId',p_unit,'partyId',p_party));
 RETURN interest_id;
END $$;

CREATE OR REPLACE FUNCTION app.create_party_for_project(p_tenant uuid,p_project uuid,p_kind text,p_first_name text,p_last_name text,p_legal_name text,p_registration text,p_email text,p_phone text,p_actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE party_id uuid:=gen_random_uuid();display text;actor_user uuid;normalized_registration text;
BEGIN
 IF NOT app.has_project_permission(p_tenant,p_actor,p_project,'clients.manage') THEN RAISE EXCEPTION 'clients.manage permission required'; END IF;
 IF p_kind NOT IN ('individual','organization') THEN RAISE EXCEPTION 'invalid party type'; END IF;
 IF p_kind='individual' THEN display:=btrim(concat_ws(' ',p_first_name,p_last_name));ELSE display:=btrim(p_legal_name);END IF;
 IF length(display)<2 THEN RAISE EXCEPTION 'party name is required'; END IF;
 normalized_registration:=NULLIF(upper(regexp_replace(COALESCE(p_registration,''),'[^[:alnum:]]','','g')),'');
 IF p_kind='organization' AND normalized_registration IS NOT NULL AND EXISTS(SELECT 1 FROM party_organization_details detail WHERE detail.tenant_id=p_tenant AND upper(detail.registration_number)=normalized_registration) THEN RAISE EXCEPTION 'organization with this registration number already exists'; END IF;
 INSERT INTO parties(id,tenant_id,party_type,display_name) VALUES(party_id,p_tenant,p_kind,display);
 IF p_kind='individual' THEN INSERT INTO party_individual_details(tenant_id,party_id,first_name,last_name) VALUES(p_tenant,party_id,btrim(p_first_name),btrim(p_last_name));
 ELSE INSERT INTO party_organization_details(tenant_id,party_id,legal_name,registration_number) VALUES(p_tenant,party_id,display,normalized_registration);END IF;
 INSERT INTO party_project_links(tenant_id,project_id,party_id,relationship_type) VALUES(p_tenant,p_project,party_id,'prospect');
 IF NULLIF(btrim(p_email),'') IS NOT NULL THEN INSERT INTO party_contacts(tenant_id,party_id,contact_type,value,normalized_value,is_primary) VALUES(p_tenant,party_id,'email',btrim(p_email),lower(btrim(p_email)),true);END IF;
 IF NULLIF(btrim(p_phone),'') IS NOT NULL THEN INSERT INTO party_contacts(tenant_id,party_id,contact_type,value,normalized_value,is_primary) VALUES(p_tenant,party_id,'phone',btrim(p_phone),regexp_replace(btrim(p_phone),'[^0-9+]','','g'),true);END IF;
 SELECT user_id INTO actor_user FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor;
 INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data) VALUES(p_tenant,actor_user,'party.created','party',party_id,jsonb_build_object('projectId',p_project,'partyType',p_kind,'displayName',display));
 INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload) VALUES(p_tenant,'party',party_id,'party.created.v1',jsonb_build_object('projectId',p_project,'partyType',p_kind));
 RETURN party_id;
END $$;

CREATE OR REPLACE FUNCTION app.assign_accessory_to_unit(p_tenant uuid,p_unit uuid,p_accessory uuid,p_from timestamptz,p_actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_project uuid;accessory_project uuid;assignment_id uuid;actor_user uuid;
BEGIN
 SELECT project_id INTO v_project FROM units WHERE tenant_id=p_tenant AND id=p_unit;
 SELECT project_id INTO accessory_project FROM accessories WHERE tenant_id=p_tenant AND id=p_accessory AND operational_status='active';
 IF v_project IS NULL OR accessory_project IS NULL OR v_project<>accessory_project OR NOT app.has_project_permission(p_tenant,p_actor,v_project,'accessory.manage') THEN RAISE EXCEPTION 'accessory.manage permission required'; END IF;
 INSERT INTO unit_accessory_assignments(tenant_id,project_id,unit_id,accessory_id,valid_from,assigned_by_membership_id) VALUES(p_tenant,v_project,p_unit,p_accessory,COALESCE(p_from,now()),p_actor) RETURNING id INTO assignment_id;
 SELECT user_id INTO actor_user FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor;
 INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data) VALUES(p_tenant,actor_user,'accessory.assigned','unit_accessory_assignment',assignment_id,jsonb_build_object('unitId',p_unit,'accessoryId',p_accessory));
 INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload) VALUES(p_tenant,'unit',p_unit,'accessory.assigned.v1',jsonb_build_object('assignmentId',assignment_id,'accessoryId',p_accessory));
 RETURN assignment_id;
END $$;

CREATE OR REPLACE FUNCTION app.remove_accessory_from_unit(p_tenant uuid,p_assignment uuid,p_to timestamptz,p_actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_project uuid;actor_user uuid;
BEGIN
 SELECT project_id INTO v_project FROM unit_accessory_assignments WHERE tenant_id=p_tenant AND id=p_assignment FOR UPDATE;
 IF v_project IS NULL OR NOT app.has_project_permission(p_tenant,p_actor,v_project,'accessory.manage') THEN RAISE EXCEPTION 'accessory.manage permission required'; END IF;
 UPDATE unit_accessory_assignments SET valid_to=COALESCE(p_to,now()) WHERE tenant_id=p_tenant AND id=p_assignment AND (valid_to IS NULL OR valid_to>COALESCE(p_to,now()));
 SELECT user_id INTO actor_user FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor;
 INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data) VALUES(p_tenant,actor_user,'accessory.removed','unit_accessory_assignment',p_assignment,jsonb_build_object('validTo',COALESCE(p_to,now())));
 RETURN p_assignment;
END $$;

GRANT EXECUTE ON FUNCTION app.record_project_construction_status(uuid,uuid,text,timestamptz,text,uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.update_unit_details_v2(uuid,uuid,uuid,text,text,numeric,numeric,numeric,text,numeric,numeric,numeric,uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.update_party_profile(uuid,uuid,text,text,text,text,text,text,uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.upsert_party_primary_address(uuid,uuid,text,text,text,text,text,char,uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.add_unit_interest(uuid,uuid,uuid,text,text,uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.create_party_for_project(uuid,uuid,text,text,text,text,text,text,text,uuid) TO develocrm_app;
COMMIT;

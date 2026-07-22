BEGIN;

CREATE OR REPLACE FUNCTION app.update_project_details(p_tenant uuid,p_project uuid,p_name text,p_location text,p_lifecycle text,p_manager uuid,p_handover_from date,p_handover_to date,p_actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER AS $$ DECLARE old_row jsonb; new_row jsonb; BEGIN
  IF NOT app.has_project_permission(p_tenant,p_actor,p_project,'project.manage') THEN RAISE EXCEPTION 'project.manage required'; END IF;
  SELECT to_jsonb(project) INTO old_row FROM projects project WHERE tenant_id=p_tenant AND id=p_project FOR UPDATE;
  IF old_row IS NULL THEN RAISE EXCEPTION 'project not found'; END IF;
  UPDATE projects SET name=btrim(p_name), location=NULLIF(btrim(p_location),''), lifecycle_status=p_lifecycle, manager_membership_id=p_manager, planned_handover_from=p_handover_from, planned_handover_to=p_handover_to, archived_at=CASE WHEN p_lifecycle='archived' THEN COALESCE(archived_at,now()) ELSE NULL END WHERE tenant_id=p_tenant AND id=p_project RETURNING to_jsonb(project) INTO new_row;
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data) VALUES(p_tenant,app.current_user_id(),'project.updated','project',p_project,old_row,new_row);
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload) VALUES(p_tenant,'project',p_project,'project.updated',new_row);
  RETURN p_project;
END $$;

CREATE OR REPLACE FUNCTION app.update_unit_details(p_tenant uuid,p_unit uuid,p_layout text,p_floor_label text,p_floor_number numeric,p_area numeric,p_usable numeric,p_orientation text,p_balcony numeric,p_terrace numeric,p_garden numeric,p_actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER AS $$ DECLARE old_row jsonb; new_row jsonb; project_id uuid; BEGIN
  SELECT u.project_id INTO project_id FROM units u WHERE u.tenant_id=p_tenant AND u.id=p_unit FOR UPDATE;
  IF project_id IS NULL OR NOT app.has_project_permission(p_tenant,p_actor,project_id,'unit.manage') THEN RAISE EXCEPTION 'unit.manage required'; END IF;
  SELECT to_jsonb(u) INTO old_row FROM units u WHERE u.tenant_id=p_tenant AND u.id=p_unit;
  UPDATE units SET layout=NULLIF(btrim(p_layout),''),floor_label=NULLIF(btrim(p_floor_label),''),floor_number=p_floor_number,area_m2=p_area,usable_area_m2=p_usable,orientation=NULLIF(btrim(p_orientation),''),balcony_m2=p_balcony,terrace_m2=p_terrace,garden_m2=p_garden WHERE tenant_id=p_tenant AND id=p_unit RETURNING to_jsonb(units) INTO new_row;
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data) VALUES(p_tenant,app.current_user_id(),'unit.updated','unit',p_unit,old_row,new_row);
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload) VALUES(p_tenant,'unit',p_unit,'unit.updated',new_row); RETURN p_unit;
END $$;

CREATE OR REPLACE FUNCTION app.update_party_details(p_tenant uuid,p_party uuid,p_display_name text,p_actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER AS $$ DECLARE old_row jsonb; new_row jsonb; BEGIN
  IF NOT EXISTS (SELECT 1 FROM parties p JOIN party_project_links l ON l.tenant_id=p.tenant_id AND l.party_id=p.id WHERE p.tenant_id=p_tenant AND p.id=p_party AND l.valid_to IS NULL AND app.has_project_permission(p_tenant,p_actor,l.project_id,'clients.manage')) THEN RAISE EXCEPTION 'clients.manage required'; END IF;
  SELECT to_jsonb(p) INTO old_row FROM parties p WHERE p.tenant_id=p_tenant AND p.id=p_party FOR UPDATE;
  UPDATE parties SET display_name=btrim(p_display_name) WHERE tenant_id=p_tenant AND id=p_party RETURNING to_jsonb(parties) INTO new_row;
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data) VALUES(p_tenant,app.current_user_id(),'party.updated','party',p_party,old_row,new_row);
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload) VALUES(p_tenant,'party',p_party,'party.updated',new_row); RETURN p_party;
END $$;

CREATE OR REPLACE FUNCTION app.upsert_party_contact(p_tenant uuid,p_party uuid,p_type text,p_value text,p_label text,p_primary boolean,p_actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER AS $$ DECLARE cid uuid; norm text; project_id uuid; BEGIN
  SELECT l.project_id INTO project_id FROM party_project_links l WHERE l.tenant_id=p_tenant AND l.party_id=p_party AND l.valid_to IS NULL LIMIT 1;
  IF project_id IS NULL OR NOT app.has_project_permission(p_tenant,p_actor,project_id,'clients.manage') THEN RAISE EXCEPTION 'clients.manage required'; END IF;
  norm:=lower(regexp_replace(btrim(p_value),'[^[:alnum:]@+.]','','g'));
  SELECT id INTO cid FROM party_contacts WHERE tenant_id=p_tenant AND party_id=p_party AND contact_type=p_type AND normalized_value=norm AND archived_at IS NULL;
  IF cid IS NULL THEN INSERT INTO party_contacts(tenant_id,party_id,contact_type,value,normalized_value,label,is_primary) VALUES(p_tenant,p_party,p_type,btrim(p_value),norm,NULLIF(btrim(p_label),''),p_primary) RETURNING id INTO cid; ELSE UPDATE party_contacts SET value=btrim(p_value),label=NULLIF(btrim(p_label),''),is_primary=p_primary WHERE tenant_id=p_tenant AND id=cid; END IF;
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data) VALUES(p_tenant,app.current_user_id(),'party_contact.upserted','party_contact',cid,jsonb_build_object('partyId',p_party,'type',p_type)); RETURN cid;
END $$;

CREATE OR REPLACE FUNCTION app.assign_accessory_to_unit(p_tenant uuid,p_unit uuid,p_accessory uuid,p_from timestamptz,p_actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER AS $$ DECLARE pid uuid; aid uuid; BEGIN
  SELECT project_id INTO pid FROM units WHERE tenant_id=p_tenant AND id=p_unit; SELECT project_id INTO aid FROM accessories WHERE tenant_id=p_tenant AND id=p_accessory;
  IF pid IS NULL OR aid IS NULL OR pid<>aid OR NOT app.has_project_permission(p_tenant,p_actor,pid,'unit.manage') THEN RAISE EXCEPTION 'unit.manage required'; END IF;
  INSERT INTO unit_accessory_assignments(tenant_id,project_id,unit_id,accessory_id,valid_from,assigned_by_membership_id) VALUES(p_tenant,pid,p_unit,p_accessory,COALESCE(p_from,now()),p_actor) RETURNING id INTO aid;
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data) VALUES(p_tenant,app.current_user_id(),'accessory.assigned','unit_accessory_assignment',aid,jsonb_build_object('unitId',p_unit,'accessoryId',p_accessory)); RETURN aid;
END $$;

CREATE OR REPLACE FUNCTION app.remove_accessory_from_unit(p_tenant uuid,p_assignment uuid,p_to timestamptz,p_actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER AS $$ DECLARE pid uuid; BEGIN
  SELECT project_id INTO pid FROM unit_accessory_assignments WHERE tenant_id=p_tenant AND id=p_assignment FOR UPDATE;
  IF pid IS NULL OR NOT app.has_project_permission(p_tenant,p_actor,pid,'unit.manage') THEN RAISE EXCEPTION 'unit.manage required'; END IF;
  UPDATE unit_accessory_assignments SET valid_to=COALESCE(p_to,now()) WHERE tenant_id=p_tenant AND id=p_assignment AND (valid_to IS NULL OR valid_to>COALESCE(p_to,now()));
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data) VALUES(p_tenant,app.current_user_id(),'accessory.removed','unit_accessory_assignment',p_assignment,jsonb_build_object('validTo',COALESCE(p_to,now()))); RETURN p_assignment;
END $$;

GRANT EXECUTE ON FUNCTION app.update_project_details(uuid,uuid,text,text,text,uuid,date,date,uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.update_unit_details(uuid,uuid,text,text,numeric,numeric,numeric,text,numeric,numeric,numeric,uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.update_party_details(uuid,uuid,text,uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.upsert_party_contact(uuid,uuid,text,text,text,boolean,uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.assign_accessory_to_unit(uuid,uuid,uuid,timestamptz,uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.remove_accessory_from_unit(uuid,uuid,timestamptz,uuid) TO develocrm_app;
COMMIT;

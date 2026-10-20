BEGIN;

-- Extend the existing edit command; the eight-argument import/legacy path keeps
-- its semantics and cannot accidentally erase an existing location.
CREATE FUNCTION app.update_project_accessory(
  p_tenant uuid,p_accessory uuid,p_code text,p_area numeric,p_amount numeric,
  p_amount_net numeric,p_reason text,p_actor uuid,p_floor_label text
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE a accessories%ROWTYPE;actor_user uuid;location text;
BEGIN
  IF p_tenant IS DISTINCT FROM app.current_tenant_id() THEN RAISE EXCEPTION 'tenant context required'; END IF;
  SELECT user_id INTO actor_user FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor
    AND user_id=app.current_user_id() AND status='active';
  IF actor_user IS NULL THEN RAISE EXCEPTION 'accessory.manage permission required'; END IF;
  SELECT * INTO a FROM accessories WHERE tenant_id=p_tenant AND id=p_accessory AND archived_at IS NULL FOR UPDATE;
  IF a.id IS NULL OR NOT app.has_project_permission(p_tenant,p_actor,a.project_id,'accessory.manage') THEN
    RAISE EXCEPTION 'accessory.manage permission required';
  END IF;
  IF length(p_floor_label)>120 OR p_floor_label~'[[:cntrl:]]' THEN RAISE EXCEPTION 'ACCESSORY_LOCATION_INVALID'; END IF;
  location:=NULLIF(btrim(p_floor_label),'');
  PERFORM app.update_project_accessory(p_tenant,p_accessory,p_code,p_area,p_amount,p_amount_net,p_reason,p_actor);
  IF a.floor_label IS DISTINCT FROM location THEN
    UPDATE accessories SET floor_label=location WHERE tenant_id=p_tenant AND id=p_accessory;
    INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data,metadata)
      VALUES(p_tenant,actor_user,'accessory.location_updated','accessory',p_accessory,
        jsonb_build_object('floorLabel',a.floor_label),jsonb_build_object('floorLabel',location),
        jsonb_build_object('projectId',a.project_id,'reason',p_reason));
    INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
      VALUES(p_tenant,'accessory',p_accessory,'accessory.location_updated.v1',
        jsonb_build_object('accessoryId',p_accessory,'projectId',a.project_id));
  END IF;
  RETURN p_accessory;
END $$;
REVOKE ALL ON FUNCTION app.update_project_accessory(uuid,uuid,text,numeric,numeric,numeric,text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.update_project_accessory(uuid,uuid,text,numeric,numeric,numeric,text,uuid,text) TO develocrm_app;
COMMIT;

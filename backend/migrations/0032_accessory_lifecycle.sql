BEGIN;

-- Cena příslušenství zůstává append-only. Jedinou výjimkou je řízené fyzické
-- odstranění položky, která nikdy nevstoupila do obchodního procesu.
DROP TRIGGER IF EXISTS accessory_prices_append_only ON accessory_price_history;
CREATE OR REPLACE FUNCTION app.guard_accessory_price_history()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' AND current_setting('app.accessory_removal_command',true)='on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'accessory_price_history is append-only';
END $$;
CREATE TRIGGER accessory_prices_append_only
BEFORE UPDATE OR DELETE ON accessory_price_history
FOR EACH ROW EXECUTE FUNCTION app.guard_accessory_price_history();

CREATE OR REPLACE FUNCTION app.update_project_accessory(
  p_tenant uuid,p_accessory uuid,p_code text,p_area numeric,p_amount numeric,
  p_amount_net numeric,p_reason text,p_actor uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE project uuid;actor_user uuid;current_amount numeric;
BEGIN
  SELECT project_id INTO project FROM accessories
  WHERE tenant_id=p_tenant AND id=p_accessory AND archived_at IS NULL FOR UPDATE;
  IF project IS NULL OR NOT app.has_project_permission(p_tenant,p_actor,project,'accessory.manage') THEN
    RAISE EXCEPTION 'accessory.manage permission required';
  END IF;
  IF NULLIF(btrim(p_code),'') IS NULL OR p_amount<0 OR
     (p_amount_net IS NOT NULL AND (p_amount_net<0 OR p_amount_net>p_amount)) THEN
    RAISE EXCEPTION 'invalid accessory data';
  END IF;
  SELECT user_id INTO actor_user FROM tenant_memberships
  WHERE tenant_id=p_tenant AND id=p_actor AND status='active';
  IF actor_user IS NULL THEN RAISE EXCEPTION 'active actor membership required';END IF;

  current_amount:=app.current_accessory_price(p_tenant,p_accessory,now());
  UPDATE accessories SET code=btrim(p_code),area_m2=p_area,updated_at=now()
  WHERE tenant_id=p_tenant AND id=p_accessory;
  IF current_amount IS DISTINCT FROM p_amount THEN
    INSERT INTO accessory_price_history(
      tenant_id,project_id,accessory_id,amount,amount_net,currency,valid_from,reason,recorded_by_membership_id
    ) VALUES(p_tenant,project,p_accessory,p_amount,p_amount_net,'CZK',clock_timestamp(),
      COALESCE(NULLIF(btrim(p_reason),''),'Úprava ceny příslušenství'),p_actor);
  END IF;
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data,metadata)
  VALUES(p_tenant,actor_user,'accessory.updated','accessory',p_accessory,
    jsonb_build_object('code',btrim(p_code),'areaM2',p_area,'amount',p_amount),jsonb_build_object('projectId',project));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'accessory',p_accessory,'accessory.updated.v1',jsonb_build_object('accessoryId',p_accessory,'projectId',project));
  RETURN p_accessory;
END $$;

CREATE OR REPLACE FUNCTION app.remove_or_archive_accessory(
  p_tenant uuid,p_accessory uuid,p_actor uuid,p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,app,pg_temp AS $$
DECLARE project uuid;actor_user uuid;has_history boolean;active_assignment uuid;result_mode text;
BEGIN
  SELECT project_id INTO project FROM accessories
  WHERE tenant_id=p_tenant AND id=p_accessory FOR UPDATE;
  IF project IS NULL THEN RAISE EXCEPTION 'accessory not found';END IF;
  IF NOT app.has_project_permission(p_tenant,p_actor,project,'accessory.manage') THEN
    RAISE EXCEPTION 'accessory.manage permission required';
  END IF;
  SELECT user_id INTO actor_user FROM tenant_memberships
  WHERE tenant_id=p_tenant AND id=p_actor AND status='active';
  IF actor_user IS NULL THEN RAISE EXCEPTION 'active actor membership required';END IF;
  SELECT id INTO active_assignment FROM unit_accessory_assignments
  WHERE tenant_id=p_tenant AND accessory_id=p_accessory
    AND valid_from<=now() AND (valid_to IS NULL OR valid_to>now()) LIMIT 1;
  IF active_assignment IS NOT NULL THEN RAISE EXCEPTION 'accessory is currently assigned';END IF;

  SELECT EXISTS(SELECT 1 FROM unit_accessory_assignments WHERE tenant_id=p_tenant AND accessory_id=p_accessory)
      OR EXISTS(SELECT 1 FROM accessory_relations WHERE tenant_id=p_tenant AND (source_accessory_id=p_accessory OR target_accessory_id=p_accessory))
      OR EXISTS(SELECT 1 FROM accessory_price_history WHERE tenant_id=p_tenant AND accessory_id=p_accessory OFFSET 1)
      OR EXISTS(
        SELECT 1 FROM contracts contract
        CROSS JOIN LATERAL jsonb_array_elements(contract.accessory_price_snapshot) item
        WHERE contract.tenant_id=p_tenant AND item->>'accessoryId'=p_accessory::text
      )
    INTO has_history;

  IF has_history THEN
    UPDATE accessories SET operational_status='archived',archived_at=COALESCE(archived_at,now()),updated_at=now()
    WHERE tenant_id=p_tenant AND id=p_accessory;
    result_mode:='archive';
  ELSE
    PERFORM set_config('app.accessory_removal_command','on',true);
    DELETE FROM accessory_price_history WHERE tenant_id=p_tenant AND accessory_id=p_accessory;
    DELETE FROM accessories WHERE tenant_id=p_tenant AND id=p_accessory;
    PERFORM set_config('app.accessory_removal_command','off',true);
    result_mode:='delete';
  END IF;

  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data,metadata)
  VALUES(p_tenant,actor_user,CASE WHEN result_mode='delete' THEN 'accessory.deleted' ELSE 'accessory.archived' END,
    'accessory',p_accessory,jsonb_build_object('mode',result_mode,'reason',NULLIF(btrim(p_reason),'')),jsonb_build_object('projectId',project));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'accessory',p_accessory,'accessory.'||CASE WHEN result_mode='delete' THEN 'deleted' ELSE 'archived' END||'.v1',
    jsonb_build_object('accessoryId',p_accessory,'projectId',project,'mode',result_mode));
  RETURN jsonb_build_object('mode',result_mode,'accessoryId',p_accessory);
END $$;

GRANT EXECUTE ON FUNCTION app.update_project_accessory(uuid,uuid,text,numeric,numeric,numeric,text,uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.remove_or_archive_accessory(uuid,uuid,uuid,text) TO develocrm_app;

COMMIT;

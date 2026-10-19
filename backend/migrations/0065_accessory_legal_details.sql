BEGIN;

-- No inference or backfill from codes, floor labels, buyer shares or imports.
ALTER TABLE accessories ADD COLUMN legal_form text,
  ADD COLUMN coownership_numerator integer, ADD COLUMN coownership_denominator integer;
ALTER TABLE accessories ADD CONSTRAINT accessory_legal_form_valid CHECK(
  legal_form IS NULL OR legal_form IN ('cellar_unit','outdoor_parking_use_right','garage_coownership'));
ALTER TABLE accessories ADD CONSTRAINT accessory_legal_share_valid CHECK(
  (coownership_numerator IS NULL AND coownership_denominator IS NULL) OR
  (legal_form IS NOT NULL AND legal_form='garage_coownership' AND coownership_numerator IS NOT NULL AND coownership_denominator IS NOT NULL
    AND coownership_numerator>0 AND coownership_denominator>=coownership_numerator AND coownership_denominator<=1000000000));

CREATE FUNCTION app.guard_accessory_legal_details() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE category text; changed boolean;
BEGIN
  IF TG_OP='INSERT' THEN
    changed:=NEW.legal_form IS NOT NULL OR NEW.coownership_numerator IS NOT NULL OR NEW.coownership_denominator IS NOT NULL;
  ELSE
    changed:=ROW(NEW.legal_form,NEW.coownership_numerator,NEW.coownership_denominator)
      IS DISTINCT FROM ROW(OLD.legal_form,OLD.coownership_numerator,OLD.coownership_denominator);
  END IF;
  IF changed AND current_setting('app.accessory_legal_details_command',true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'ACCESSORY_LEGAL_COMMAND_REQUIRED';
  END IF;
  IF NEW.legal_form IS NOT NULL THEN
    SELECT t.category INTO category FROM accessory_types t WHERE t.tenant_id=NEW.tenant_id AND t.id=NEW.accessory_type_id;
    IF (NEW.legal_form='cellar_unit' AND category IS DISTINCT FROM 'cellar')
      OR (NEW.legal_form='outdoor_parking_use_right' AND category IS DISTINCT FROM 'parking')
      OR (NEW.legal_form='garage_coownership' AND category NOT IN ('parking','garage')) THEN
      RAISE EXCEPTION 'ACCESSORY_LEGAL_CATEGORY_MISMATCH';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER accessory_legal_details_guard BEFORE INSERT OR UPDATE ON accessories
  FOR EACH ROW EXECUTE FUNCTION app.guard_accessory_legal_details();

CREATE FUNCTION app.set_accessory_legal_details(p_tenant uuid,p_accessory uuid,p_details jsonb,p_actor uuid)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE a accessories%ROWTYPE; actor_user uuid; form text; numerator integer; denominator integer;
BEGIN
  IF p_tenant IS DISTINCT FROM app.current_tenant_id() THEN RAISE EXCEPTION 'tenant context required'; END IF;
  SELECT user_id INTO actor_user FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor
    AND user_id=app.current_user_id() AND status='active';
  IF actor_user IS NULL THEN RAISE EXCEPTION 'accessory.manage permission required'; END IF;
  SELECT * INTO a FROM accessories WHERE tenant_id=p_tenant AND id=p_accessory AND archived_at IS NULL FOR UPDATE;
  IF a.id IS NULL OR NOT app.has_project_permission(p_tenant,p_actor,a.project_id,'accessory.manage') THEN
    RAISE EXCEPTION 'accessory.manage permission required';
  END IF;
  IF jsonb_typeof(p_details) IS DISTINCT FROM 'object' OR NOT (p_details ? 'legalForm') THEN RAISE EXCEPTION 'ACCESSORY_LEGAL_INVALID'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_details) k WHERE k NOT IN ('legalForm','shareNumerator','shareDenominator')) THEN RAISE EXCEPTION 'ACCESSORY_LEGAL_INVALID'; END IF;
  form:=p_details->>'legalForm';
  IF form IS NOT NULL AND form NOT IN ('cellar_unit','outdoor_parking_use_right','garage_coownership') THEN RAISE EXCEPTION 'ACCESSORY_LEGAL_INVALID'; END IF;
  IF COALESCE(p_details->'shareNumerator','null'::jsonb)<>'null'::jsonb
    AND (jsonb_typeof(p_details->'shareNumerator')<>'number' OR (p_details->>'shareNumerator')!~'^[1-9][0-9]{0,9}$') THEN RAISE EXCEPTION 'ACCESSORY_LEGAL_INVALID'; END IF;
  IF COALESCE(p_details->'shareDenominator','null'::jsonb)<>'null'::jsonb
    AND (jsonb_typeof(p_details->'shareDenominator')<>'number' OR (p_details->>'shareDenominator')!~'^[1-9][0-9]{0,9}$') THEN RAISE EXCEPTION 'ACCESSORY_LEGAL_INVALID'; END IF;
  IF (p_details->>'shareNumerator')::numeric>1000000000 OR (p_details->>'shareDenominator')::numeric>1000000000 THEN
    RAISE EXCEPTION 'ACCESSORY_LEGAL_INVALID';
  END IF;
  numerator:=(p_details->>'shareNumerator')::integer;denominator:=(p_details->>'shareDenominator')::integer;
  IF (numerator IS NULL)<>(denominator IS NULL) OR
    (numerator IS NOT NULL AND (form IS DISTINCT FROM 'garage_coownership' OR numerator<1 OR denominator<numerator OR denominator>1000000000)) THEN RAISE EXCEPTION 'ACCESSORY_LEGAL_INVALID'; END IF;
  IF ROW(a.legal_form,a.coownership_numerator,a.coownership_denominator) IS NOT DISTINCT FROM ROW(form,numerator,denominator) THEN RETURN false; END IF;
  PERFORM set_config('app.accessory_legal_details_command','on',true);
  UPDATE accessories SET legal_form=form,coownership_numerator=numerator,coownership_denominator=denominator WHERE tenant_id=p_tenant AND id=p_accessory;
  PERFORM set_config('app.accessory_legal_details_command','off',true);
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data,metadata)
    VALUES(p_tenant,actor_user,'accessory.legal_details_updated','accessory',p_accessory,
      jsonb_build_object('legalForm',a.legal_form,'shareNumerator',a.coownership_numerator,'shareDenominator',a.coownership_denominator),
      jsonb_build_object('legalForm',form,'shareNumerator',numerator,'shareDenominator',denominator),jsonb_build_object('projectId',a.project_id));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
    VALUES(p_tenant,'accessory',p_accessory,'accessory.legal_details_updated.v1',jsonb_build_object('accessoryId',p_accessory,'projectId',a.project_id));
  RETURN true;
END $$;
GRANT EXECUTE ON FUNCTION app.set_accessory_legal_details(uuid,uuid,jsonb,uuid) TO develocrm_app;
COMMIT;

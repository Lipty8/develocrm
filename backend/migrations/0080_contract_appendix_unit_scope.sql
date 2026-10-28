BEGIN;

-- No historical rows are rewritten. Unrestricted project documents remain
-- shared; an explicitly unit-scoped document must include the contract unit.
CREATE FUNCTION app.assert_appendix_document_unit(p_tenant uuid,p_project uuid,p_document uuid,p_unit uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_tenant IS DISTINCT FROM app.current_tenant_id() THEN RAISE EXCEPTION 'tenant context required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM documents WHERE tenant_id=p_tenant AND project_id=p_project AND id=p_document)
    OR NOT EXISTS(SELECT 1 FROM units WHERE tenant_id=p_tenant AND project_id=p_project AND id=p_unit) THEN
    RAISE EXCEPTION 'CONTRACT_APPENDIX_UNIT_MISMATCH';
  END IF;
  IF EXISTS(SELECT 1 FROM unit_documents WHERE tenant_id=p_tenant AND document_id=p_document)
    AND NOT EXISTS(SELECT 1 FROM unit_documents WHERE tenant_id=p_tenant AND project_id=p_project
      AND document_id=p_document AND unit_id=p_unit) THEN
    RAISE EXCEPTION 'CONTRACT_APPENDIX_UNIT_MISMATCH';
  END IF;
END $$;

CREATE FUNCTION app.assert_contract_appendix_units(p_tenant uuid,p_contract uuid,p_version uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app AS $$
DECLARE c contracts%ROWTYPE; link record; actor uuid;
BEGIN
  IF p_tenant IS DISTINCT FROM app.current_tenant_id() THEN RAISE EXCEPTION 'tenant context required'; END IF;
  PERFORM app.lock_workflow_unit(p_tenant,(SELECT unit_id FROM contracts WHERE tenant_id=p_tenant AND id=p_contract));
  SELECT * INTO c FROM contracts WHERE tenant_id=p_tenant AND id=p_contract;
  IF c.id IS NULL OR NOT EXISTS(SELECT 1 FROM contract_versions WHERE tenant_id=p_tenant AND contract_id=p_contract AND id=p_version) THEN
    RAISE EXCEPTION 'CONTRACT_APPENDIX_NEW_VERSION_REQUIRED';
  END IF;
  SELECT id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND user_id=app.current_user_id() AND status='active';
  IF actor IS NULL OR NOT app.has_project_permission(p_tenant,actor,c.project_id,'contract.read')
    OR NOT app.has_project_permission(p_tenant,actor,c.project_id,'documents.view') THEN
    RAISE EXCEPTION 'contract.read and documents.view permissions required';
  END IF;
  PERFORM 1 FROM documents WHERE tenant_id=p_tenant AND id IN
    (SELECT document_id FROM contract_documents WHERE tenant_id=p_tenant AND contract_id=p_contract
      AND contract_version_id=p_version AND appendix_number IS NOT NULL) ORDER BY id FOR UPDATE;
  FOR link IN SELECT document_id FROM contract_documents WHERE tenant_id=p_tenant AND contract_id=p_contract
    AND contract_version_id=p_version AND appendix_number IS NOT NULL ORDER BY document_id LOOP
    PERFORM app.assert_appendix_document_unit(p_tenant,c.project_id,link.document_id,c.unit_id);
  END LOOP;
END $$;

CREATE FUNCTION app.guard_appendix_unit_selection() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c contracts%ROWTYPE;
BEGIN
  IF NEW.appendix_number IS NULL THEN RETURN NEW; END IF;
  PERFORM app.lock_workflow_unit(NEW.tenant_id,(SELECT unit_id FROM contracts WHERE tenant_id=NEW.tenant_id AND id=NEW.contract_id));
  SELECT * INTO c FROM contracts WHERE tenant_id=NEW.tenant_id AND id=NEW.contract_id;
  PERFORM 1 FROM documents WHERE tenant_id=NEW.tenant_id AND id=NEW.document_id FOR UPDATE;
  PERFORM app.assert_appendix_document_unit(NEW.tenant_id,c.project_id,NEW.document_id,c.unit_id);
  RETURN NEW;
END $$;
CREATE TRIGGER contract_appendix_unit_scope BEFORE INSERT OR UPDATE ON contract_documents
  FOR EACH ROW EXECUTE FUNCTION app.guard_appendix_unit_selection();

CREATE FUNCTION app.guard_appendix_unit_association() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app AS $$
DECLARE tenant uuid; previous_document uuid; next_document uuid;
BEGIN
  IF TG_OP='UPDATE' AND ROW(OLD.tenant_id,OLD.project_id,OLD.unit_id,OLD.document_id)
    IS NOT DISTINCT FROM ROW(NEW.tenant_id,NEW.project_id,NEW.unit_id,NEW.document_id) THEN RETURN NEW; END IF;
  tenant:=CASE WHEN TG_OP='DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END;
  IF tenant IS DISTINCT FROM app.current_tenant_id() OR TG_OP='UPDATE' AND OLD.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'tenant context required';
  END IF;
  IF TG_OP<>'INSERT' THEN previous_document:=OLD.document_id; END IF;
  IF TG_OP<>'DELETE' THEN next_document:=NEW.document_id; END IF;
  -- Document-only locking: never acquire a unit lock after this point. A
  -- selector already owns unit -> document locks and rechecks after waiting.
  PERFORM 1 FROM documents WHERE tenant_id=tenant AND id IN(previous_document,next_document) ORDER BY id FOR UPDATE;
  -- An ON CONFLICT DO NOTHING replay does not change applicability.
  IF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM unit_documents WHERE tenant_id=tenant
    AND document_id=NEW.document_id AND unit_id=NEW.unit_id AND project_id=NEW.project_id) THEN RETURN NEW; END IF;
  IF EXISTS(SELECT 1 FROM contract_documents WHERE tenant_id=tenant
    AND document_id IN(previous_document,next_document) AND appendix_number IS NOT NULL) THEN
    RAISE EXCEPTION 'CONTRACT_APPENDIX_UNIT_LINK_IN_USE';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER appendix_unit_association_guard BEFORE INSERT OR UPDATE OR DELETE ON unit_documents
  FOR EACH ROW EXECUTE FUNCTION app.guard_appendix_unit_association();

CREATE FUNCTION app.guard_generation_appendix_unit_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.contract_id IS NOT NULL AND NEW.contract_preparation_version_id IS NOT NULL THEN
    PERFORM app.assert_contract_appendix_units(NEW.tenant_id,NEW.contract_id,NEW.contract_preparation_version_id);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER generation_appendix_unit_scope BEFORE INSERT OR UPDATE ON document_generation_operations
  FOR EACH ROW EXECUTE FUNCTION app.guard_generation_appendix_unit_scope();

-- Existing binding/signature guards call this central snapshot function. Add
-- the same invariant after its established unit -> ordered document locks,
-- retaining all permission, native-version, hash and immutable bundle checks.
DO $$
DECLARE definition text; needle text := '  SELECT COALESCE(jsonb_agg(jsonb_build_object(''number'',l.appendix_number';
BEGIN
  SELECT pg_get_functiondef('app.contract_appendix_snapshot(uuid,uuid,uuid,uuid)'::regprocedure) INTO definition;
  IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'Unexpected appendix snapshot definition'; END IF;
  definition:=replace(definition,needle,
    '  PERFORM app.assert_contract_appendix_units(p_tenant,p_contract,p_version);' || chr(10) || needle);
  EXECUTE definition;
END $$;

REVOKE ALL ON FUNCTION app.assert_appendix_document_unit(uuid,uuid,uuid,uuid),
  app.assert_contract_appendix_units(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.assert_appendix_document_unit(uuid,uuid,uuid,uuid),
  app.assert_contract_appendix_units(uuid,uuid,uuid) TO develocrm_app;

COMMIT;

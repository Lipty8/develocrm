BEGIN;

ALTER TABLE document_generation_operations
  ADD COLUMN contract_preparation_version_id uuid,
  ADD COLUMN appendix_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD CONSTRAINT generation_preparation_version_fk FOREIGN KEY(tenant_id,project_id,contract_id,contract_preparation_version_id)
    REFERENCES contract_versions(tenant_id,project_id,contract_id,id) ON DELETE RESTRICT,
  ADD CONSTRAINT generation_appendix_snapshot_shape CHECK(jsonb_typeof(appendix_snapshot)='array'
    AND (contract_preparation_version_id IS NOT NULL OR appendix_snapshot='[]'::jsonb)
    AND (contract_preparation_version_id IS NULL OR contract_id IS NOT NULL));

CREATE FUNCTION app.guard_generation_appendix_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(OLD.contract_preparation_version_id,OLD.appendix_snapshot)
    IS DISTINCT FROM ROW(NEW.contract_preparation_version_id,NEW.appendix_snapshot) THEN
    RAISE EXCEPTION 'CONTRACT_APPENDIX_SNAPSHOT_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER generation_appendix_snapshot_immutable BEFORE UPDATE ON document_generation_operations
  FOR EACH ROW EXECUTE FUNCTION app.guard_generation_appendix_snapshot();

-- Selection and generation reservation use the same unit lock. Once reserved,
-- retry uses the frozen selection rather than mutable current document state.
CREATE FUNCTION app.guard_generating_contract_appendices() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE link contract_documents%ROWTYPE;
BEGIN
  IF TG_OP='INSERT' THEN link:=NEW; ELSE link:=OLD; END IF;
  IF (link.appendix_number IS NOT NULL OR TG_OP='UPDATE' AND NEW.appendix_number IS NOT NULL)
    AND EXISTS(SELECT 1 FROM document_generation_operations g WHERE g.tenant_id=link.tenant_id
      AND g.contract_id=link.contract_id AND g.contract_preparation_version_id=link.contract_version_id) THEN
    RAISE EXCEPTION 'CONTRACT_APPENDIX_GENERATION_STARTED';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER contract_appendix_generation_guard BEFORE INSERT OR UPDATE OR DELETE ON contract_documents
  FOR EACH ROW EXECUTE FUNCTION app.guard_generating_contract_appendices();

CREATE FUNCTION app.guard_prepared_appendix_document() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND ROW(NEW.external_drive_id,NEW.external_item_id,NEW.storage_provider,NEW.archived_at)
    IS NOT DISTINCT FROM ROW(OLD.external_drive_id,OLD.external_item_id,OLD.storage_provider,OLD.archived_at) THEN RETURN NEW; END IF;
  IF app.document_has_signature_evidence(OLD.tenant_id,OLD.id) THEN RAISE EXCEPTION 'SIGNED_DOCUMENT_IMMUTABLE'; END IF;
  IF EXISTS(SELECT 1 FROM contract_documents l JOIN contract_versions cv ON cv.tenant_id=l.tenant_id AND cv.id=l.contract_version_id
    WHERE l.tenant_id=OLD.tenant_id AND l.document_id=OLD.id AND l.appendix_number IS NOT NULL
      AND cv.version_status IN ('working','approved_for_signing','signed')
      AND (cv.document_version_id IS NOT NULL OR EXISTS(SELECT 1 FROM document_generation_operations g
        WHERE g.tenant_id=cv.tenant_id AND g.contract_id=cv.contract_id AND g.contract_preparation_version_id=cv.id))) THEN
    RAISE EXCEPTION 'CONTRACT_APPENDIX_DOCUMENT_IN_USE';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER prepared_appendix_document_guard BEFORE UPDATE OR DELETE ON documents
  FOR EACH ROW EXECUTE FUNCTION app.guard_prepared_appendix_document();

CREATE FUNCTION app.contract_appendix_snapshot(p_tenant uuid,p_contract uuid,p_version uuid,p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app AS $$
DECLARE c contracts%ROWTYPE; result jsonb;
BEGIN
  IF p_tenant IS DISTINCT FROM app.current_tenant_id() THEN RAISE EXCEPTION 'tenant context required'; END IF;
  PERFORM app.lock_workflow_unit(p_tenant,(SELECT unit_id FROM contracts WHERE tenant_id=p_tenant AND id=p_contract));
  SELECT * INTO c FROM contracts WHERE tenant_id=p_tenant AND id=p_contract;
  IF c.id IS NULL OR NOT app.has_project_permission(p_tenant,p_actor,c.project_id,'contract.read')
    OR NOT app.has_project_permission(p_tenant,p_actor,c.project_id,'documents.view')
    OR NOT EXISTS(SELECT 1 FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor AND user_id=app.current_user_id() AND status='active') THEN
    RAISE EXCEPTION 'contract.read and documents.view permissions required';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM contract_versions WHERE tenant_id=p_tenant AND contract_id=p_contract AND id=p_version) THEN
    RAISE EXCEPTION 'CONTRACT_APPENDIX_NEW_VERSION_REQUIRED';
  END IF;
  PERFORM 1 FROM documents WHERE tenant_id=p_tenant AND id IN
    (SELECT document_id FROM contract_documents WHERE tenant_id=p_tenant AND contract_id=p_contract
      AND contract_version_id=p_version AND appendix_number IS NOT NULL) ORDER BY id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM contract_documents l
    LEFT JOIN documents d ON d.tenant_id=l.tenant_id AND d.project_id=l.project_id AND d.id=l.document_id
    LEFT JOIN document_versions v ON v.tenant_id=l.tenant_id AND v.project_id=l.project_id AND v.document_id=l.document_id AND v.id=l.document_version_id
    WHERE l.tenant_id=p_tenant AND l.contract_id=p_contract AND l.contract_version_id=p_version AND l.appendix_number IS NOT NULL
      AND (d.id IS NULL OR v.id IS NULL OR d.archived_at IS NOT NULL OR d.storage_provider<>'sharepoint'
        OR v.status_code NOT IN ('ready','sent','negotiation','signed') OR v.content_hash IS NULL
        OR v.content_hash!~'^sha256:[a-f0-9]{64}$' OR NULLIF(btrim(v.external_version_id),'') IS NULL
        OR (d.sensitivity<>'normal' AND NOT app.has_project_permission(p_tenant,p_actor,c.project_id,'documents.view_sensitive'))
        OR NOT EXISTS(SELECT 1 FROM document_upload_operations op WHERE op.tenant_id=p_tenant AND op.project_id=c.project_id
          AND op.document_id=d.id AND op.document_version_id=v.id AND op.state='completed' AND op.content_hash=v.content_hash
          AND op.graph_drive_id=d.external_drive_id AND op.graph_item_id=d.external_item_id))) THEN
    RAISE EXCEPTION 'CONTRACT_APPENDIX_DOCUMENT_NOT_READY';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('number',l.appendix_number,'documentId',d.id,'documentVersionId',v.id,
    'hash',v.content_hash,'externalVersionId',v.external_version_id,'driveId',d.external_drive_id,'itemId',d.external_item_id)
    ORDER BY l.appendix_number),'[]'::jsonb) INTO result
    FROM contract_documents l JOIN documents d ON d.tenant_id=l.tenant_id AND d.project_id=l.project_id AND d.id=l.document_id
    JOIN document_versions v ON v.tenant_id=l.tenant_id AND v.project_id=l.project_id AND v.document_id=l.document_id AND v.id=l.document_version_id
    WHERE l.tenant_id=p_tenant AND l.contract_id=p_contract AND l.contract_version_id=p_version AND l.appendix_number IS NOT NULL;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION app.contract_appendix_snapshot(uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.contract_appendix_snapshot(uuid,uuid,uuid,uuid) TO develocrm_app;

CREATE FUNCTION app.assert_contract_appendices(p_tenant uuid,p_contract uuid,p_version uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE cv contract_versions%ROWTYPE; g document_generation_operations%ROWTYPE; expected jsonb;
  actual jsonb; required_positions jsonb; actual_positions jsonb; original_profile boolean;
BEGIN
  IF p_tenant IS DISTINCT FROM app.current_tenant_id() THEN RAISE EXCEPTION 'tenant context required'; END IF;
  PERFORM app.lock_workflow_unit(p_tenant,(SELECT unit_id FROM contracts WHERE tenant_id=p_tenant AND id=p_contract));
  SELECT * INTO cv FROM contract_versions WHERE tenant_id=p_tenant AND contract_id=p_contract AND id=p_version;
  IF cv.id IS NULL THEN RAISE EXCEPTION 'CONTRACT_APPENDIX_NEW_VERSION_REQUIRED'; END IF;
  IF cv.document_version_id IS NOT NULL AND EXISTS(SELECT 1 FROM document_generation_operations pending
    WHERE pending.tenant_id=p_tenant AND pending.contract_id=p_contract AND pending.contract_preparation_version_id=cv.id
      AND pending.id IS DISTINCT FROM cv.generation_operation_id) THEN
    RAISE EXCEPTION 'CONTRACT_APPENDIX_CHANGED';
  END IF;
  SELECT COALESCE(t.variant_key IN ('dejvice-original-dob-full-v1','dejvice-original-dob-delivery-v2'),false),tv.placeholder_schema->'appendices'
    INTO original_profile,expected FROM document_template_versions tv JOIN document_templates t ON t.tenant_id=tv.tenant_id AND t.id=tv.template_id
    WHERE tv.tenant_id=p_tenant AND tv.id=cv.template_version_id;
  IF original_profile AND (expected IS NULL OR jsonb_typeof(expected)<>'array' OR jsonb_array_length(expected)=0) THEN
    RAISE EXCEPTION 'CONTRACT_APPENDIX_SCHEMA_REQUIRED';
  END IF;
  IF EXISTS(SELECT 1 FROM contract_documents WHERE tenant_id=p_tenant AND contract_version_id=p_version AND appendix_number IS NOT NULL)
    OR original_profile THEN
    actual:=app.contract_appendix_snapshot(p_tenant,p_contract,p_version,
      (SELECT id FROM tenant_memberships WHERE tenant_id=p_tenant AND user_id=app.current_user_id() AND status='active'));
    IF original_profile THEN
      SELECT COALESCE(jsonb_agg(value->'number' ORDER BY (value->>'number')::integer),'[]'::jsonb) INTO required_positions FROM jsonb_array_elements(expected);
      SELECT COALESCE(jsonb_agg(value->'number' ORDER BY (value->>'number')::integer),'[]'::jsonb) INTO actual_positions FROM jsonb_array_elements(actual);
      IF actual_positions IS DISTINCT FROM required_positions THEN RAISE EXCEPTION 'CONTRACT_APPENDIX_INCOMPLETE'; END IF;
    END IF;
    IF cv.generation_operation_id IS NOT NULL THEN
      SELECT * INTO g FROM document_generation_operations WHERE tenant_id=p_tenant AND contract_id=p_contract AND id=cv.generation_operation_id;
      IF g.contract_preparation_version_id IS DISTINCT FROM cv.id OR g.state IS DISTINCT FROM 'completed'
        OR actual IS DISTINCT FROM g.appendix_snapshot THEN RAISE EXCEPTION 'CONTRACT_APPENDIX_CHANGED'; END IF;
    END IF;
  END IF;
END $$;

CREATE FUNCTION app.guard_contract_appendix_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE version_id uuid;
BEGIN
  IF TG_TABLE_NAME='contract_versions' THEN
    IF NEW.document_version_id IS NOT NULL THEN version_id:=NEW.id; END IF;
  ELSIF NEW.signature_status='signed' THEN
    version_id:=NEW.signed_version_id;
  END IF;
  -- Do not alter legacy transitions without an appendix bundle. Their existing
  -- primary-document checks remain in force independently of this new guard.
  IF version_id IS NOT NULL AND (
    EXISTS(SELECT 1 FROM contract_documents l WHERE l.tenant_id=NEW.tenant_id
      AND l.contract_version_id=version_id AND l.appendix_number IS NOT NULL)
    OR EXISTS(SELECT 1 FROM contract_versions cv JOIN document_template_versions tv ON tv.tenant_id=cv.tenant_id AND tv.id=cv.template_version_id
      JOIN document_templates t ON t.tenant_id=tv.tenant_id AND t.id=tv.template_id
      WHERE cv.tenant_id=NEW.tenant_id AND cv.id=version_id
        AND t.variant_key IN ('dejvice-original-dob-full-v1','dejvice-original-dob-delivery-v2'))
  ) THEN
    PERFORM app.assert_contract_appendices(NEW.tenant_id,NEW.contract_id,version_id);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER contract_version_appendix_evidence AFTER INSERT OR UPDATE ON contract_versions
  FOR EACH ROW EXECUTE FUNCTION app.guard_contract_appendix_evidence();
CREATE TRIGGER contract_party_appendix_evidence BEFORE INSERT OR UPDATE ON contract_parties
  FOR EACH ROW EXECUTE FUNCTION app.guard_contract_appendix_evidence();

COMMIT;

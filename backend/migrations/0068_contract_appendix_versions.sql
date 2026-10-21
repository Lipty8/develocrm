BEGIN;

-- Reuse the existing exact contract-version/document-version association.
-- Existing unclassified links and historical contracts remain unchanged.
ALTER TABLE contract_documents ADD COLUMN appendix_number smallint;
ALTER TABLE contract_documents ADD CONSTRAINT contract_appendix_exact_version CHECK (
  appendix_number IS NULL OR (appendix_number BETWEEN 1 AND 99
    AND contract_version_id IS NOT NULL AND document_version_id IS NOT NULL)
);
CREATE UNIQUE INDEX contract_appendix_position_uq
  ON contract_documents(tenant_id,contract_version_id,appendix_number) WHERE appendix_number IS NOT NULL;

CREATE FUNCTION app.guard_contract_appendix_link() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE link contract_documents%ROWTYPE; v contract_versions%ROWTYPE;
BEGIN
  IF TG_OP='INSERT' THEN link:=NEW; ELSE link:=OLD; END IF;
  IF link.appendix_number IS NULL AND (TG_OP='DELETE' OR NEW.appendix_number IS NULL) THEN
    RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF current_setting('app.contract_appendix_command',true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'CONTRACT_APPENDIX_COMMAND_REQUIRED';
  END IF;
  IF TG_OP='UPDATE' AND ROW(NEW.tenant_id,NEW.project_id,NEW.contract_id,NEW.contract_version_id)
    IS DISTINCT FROM ROW(OLD.tenant_id,OLD.project_id,OLD.contract_id,OLD.contract_version_id) THEN
    RAISE EXCEPTION 'CONTRACT_APPENDIX_BINDING_IMMUTABLE';
  END IF;
  PERFORM app.lock_workflow_unit(link.tenant_id,(SELECT unit_id FROM contracts WHERE tenant_id=link.tenant_id AND id=link.contract_id));
  SELECT * INTO v FROM contract_versions WHERE tenant_id=link.tenant_id AND id=link.contract_version_id FOR UPDATE;
  IF v.id IS NULL OR v.version_status<>'working' OR v.document_version_id IS NOT NULL OR v.locked_at IS NOT NULL
    OR EXISTS(SELECT 1 FROM contract_parties cp WHERE cp.tenant_id=v.tenant_id AND cp.signed_version_id=v.id AND cp.signature_status='signed') THEN
    RAISE EXCEPTION 'CONTRACT_APPENDIX_VERSION_IMMUTABLE';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER contract_appendix_history_guard BEFORE INSERT OR UPDATE OR DELETE ON contract_documents
  FOR EACH ROW EXECUTE FUNCTION app.guard_contract_appendix_link();

CREATE FUNCTION app.set_contract_appendix(
  p_tenant uuid,p_contract uuid,p_contract_version uuid,p_number integer,
  p_document uuid,p_document_version uuid,p_actor uuid,p_expected_document_version uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app AS $$
DECLARE c contracts%ROWTYPE; v contract_versions%ROWTYPE; d documents%ROWTYPE; dv document_versions%ROWTYPE;
  previous contract_documents%ROWTYPE; actor_user uuid; link_id uuid;
BEGIN
  IF p_tenant IS DISTINCT FROM app.current_tenant_id() THEN RAISE EXCEPTION 'tenant context required'; END IF;
  SELECT user_id INTO actor_user FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor
    AND user_id=app.current_user_id() AND status='active';
  IF actor_user IS NULL THEN RAISE EXCEPTION 'contract.manage permission required'; END IF;
  PERFORM app.lock_workflow_unit(p_tenant,(SELECT unit_id FROM contracts WHERE tenant_id=p_tenant AND id=p_contract));
  SELECT * INTO c FROM contracts WHERE tenant_id=p_tenant AND id=p_contract FOR UPDATE;
  IF c.id IS NULL OR NOT app.has_project_permission(p_tenant,p_actor,c.project_id,'contract.manage')
    OR NOT app.has_project_permission(p_tenant,p_actor,c.project_id,'documents.manage') THEN
    RAISE EXCEPTION 'contract.manage and documents.manage permissions required';
  END IF;
  IF c.contract_type NOT IN ('rs','sbk') OR c.current_status IN ('signed','cancelled','terminated')
    OR NOT EXISTS(SELECT 1 FROM sales_cases s WHERE s.tenant_id=p_tenant AND s.id=c.sales_case_id AND s.status='active' AND s.closed_at IS NULL) THEN
    RAISE EXCEPTION 'CONTRACT_APPENDIX_CONTRACT_NOT_EDITABLE';
  END IF;
  SELECT * INTO v FROM contract_versions WHERE tenant_id=p_tenant AND contract_id=p_contract
    ORDER BY version_number DESC LIMIT 1 FOR UPDATE;
  IF v.id IS DISTINCT FROM p_contract_version OR v.version_status<>'working'
    OR v.document_version_id IS NOT NULL OR v.locked_at IS NOT NULL
    OR EXISTS(SELECT 1 FROM contract_parties cp WHERE cp.tenant_id=p_tenant AND cp.signed_version_id=v.id AND cp.signature_status='signed') THEN
    RAISE EXCEPTION 'CONTRACT_APPENDIX_NEW_VERSION_REQUIRED';
  END IF;
  IF p_number IS NULL OR p_number NOT BETWEEN 1 AND 99 OR (p_document IS NULL)<>(p_document_version IS NULL) THEN
    RAISE EXCEPTION 'CONTRACT_APPENDIX_INVALID_REQUEST';
  END IF;
  SELECT * INTO previous FROM contract_documents WHERE tenant_id=p_tenant AND contract_version_id=v.id AND appendix_number=p_number FOR UPDATE;
  IF p_document IS NOT NULL THEN
    -- Unit lock is always acquired before document locks, in stable ID order.
    PERFORM 1 FROM documents WHERE tenant_id=p_tenant AND id IN (p_document,previous.document_id) ORDER BY id FOR UPDATE;
    SELECT * INTO d FROM documents WHERE tenant_id=p_tenant AND project_id=c.project_id AND id=p_document;
    SELECT * INTO dv FROM document_versions WHERE tenant_id=p_tenant AND project_id=c.project_id AND document_id=p_document AND id=p_document_version;
    IF d.id IS NULL OR dv.id IS NULL OR d.archived_at IS NOT NULL OR d.storage_provider<>'sharepoint'
      OR dv.status_code NOT IN ('ready','sent','negotiation','signed')
      OR NOT app.has_project_permission(p_tenant,p_actor,c.project_id,'documents.view')
      OR (d.sensitivity<>'normal' AND NOT app.has_project_permission(p_tenant,p_actor,c.project_id,'documents.view_sensitive'))
      OR dv.content_hash IS NULL OR dv.content_hash!~'^sha256:[a-f0-9]{64}$' OR NULLIF(btrim(dv.external_version_id),'') IS NULL
      OR NOT EXISTS(SELECT 1 FROM document_upload_operations op WHERE op.tenant_id=p_tenant AND op.document_id=d.id
        AND op.document_version_id=dv.id AND op.project_id=c.project_id AND op.state='completed'
        AND op.graph_drive_id=d.external_drive_id AND op.graph_item_id=d.external_item_id AND op.content_hash=dv.content_hash) THEN
      RAISE EXCEPTION 'CONTRACT_APPENDIX_DOCUMENT_NOT_READY';
    END IF;
    IF d.id=v.document_id THEN RAISE EXCEPTION 'CONTRACT_APPENDIX_INVALID_REQUEST'; END IF;
  END IF;
  IF previous.id IS NOT NULL AND previous.document_id IS NOT DISTINCT FROM p_document AND previous.document_version_id IS NOT DISTINCT FROM p_document_version THEN
    RETURN previous.id;
  END IF;
  IF previous.id IS NULL AND p_document IS NULL THEN RETURN NULL; END IF;
  IF previous.document_version_id IS DISTINCT FROM p_expected_document_version THEN
    RAISE EXCEPTION 'CONTRACT_APPENDIX_CHANGED';
  END IF;
  IF p_document IS NOT NULL AND EXISTS(SELECT 1 FROM contract_documents l WHERE l.tenant_id=p_tenant
    AND l.contract_version_id=v.id AND l.document_id=p_document AND l.id IS DISTINCT FROM previous.id) THEN
    RAISE EXCEPTION 'CONTRACT_APPENDIX_DOCUMENT_ALREADY_LINKED';
  END IF;
  PERFORM set_config('app.contract_appendix_command','on',true);
  IF previous.id IS NOT NULL THEN DELETE FROM contract_documents WHERE tenant_id=p_tenant AND id=previous.id; END IF;
  IF p_document IS NOT NULL THEN
    INSERT INTO contract_documents(tenant_id,project_id,contract_id,contract_version_id,document_id,document_version_id,appendix_number,linked_by_membership_id)
      VALUES(p_tenant,c.project_id,c.id,v.id,p_document,p_document_version,p_number,p_actor) RETURNING id INTO link_id;
  END IF;
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data)
    VALUES(p_tenant,actor_user,'contract.appendix_updated','contract_version',v.id,
      CASE WHEN previous.id IS NULL THEN NULL ELSE jsonb_build_object('number',p_number,'documentId',previous.document_id,'documentVersionId',previous.document_version_id) END,
      jsonb_build_object('contractId',c.id,'number',p_number,'documentId',p_document,'documentVersionId',p_document_version));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
    VALUES(p_tenant,'contract',c.id,'contract.appendix_updated.v1',jsonb_build_object('contractId',c.id,'contractVersionId',v.id,'number',p_number,'documentId',p_document,'documentVersionId',p_document_version));
  RETURN link_id;
END $$;
REVOKE ALL ON FUNCTION app.set_contract_appendix(uuid,uuid,uuid,integer,uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.set_contract_appendix(uuid,uuid,uuid,integer,uuid,uuid,uuid,uuid) TO develocrm_app;

-- An exact appendix of a signed/partially signed version is signature evidence
-- too. Existing upload/archive/link guards reuse this central predicate.
CREATE OR REPLACE FUNCTION app.document_has_signature_evidence(p_tenant uuid,p_document uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS(SELECT 1 FROM contract_versions cv WHERE cv.tenant_id=p_tenant
    AND (cv.document_id=p_document OR EXISTS(SELECT 1 FROM contract_documents l
      WHERE l.tenant_id=cv.tenant_id AND l.contract_version_id=cv.id
        AND l.appendix_number IS NOT NULL AND l.document_id=p_document))
    AND (cv.version_status='signed' OR EXISTS(SELECT 1 FROM contract_parties cp
      WHERE cp.tenant_id=cv.tenant_id AND cp.signed_version_id=cv.id AND cp.signature_status='signed')))
$$;

COMMIT;

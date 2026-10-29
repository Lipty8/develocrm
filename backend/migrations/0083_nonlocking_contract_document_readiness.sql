BEGIN;

-- The commercial GET called the signing validator and locked every final
-- document. Live PostgreSQL recorded 40P01 in that read path on 29 October.
-- Keep one validation body, with locks retained only by the write wrapper.
CREATE OR REPLACE FUNCTION app.check_contract_document(p_tenant uuid,p_contract uuid,p_document uuid,p_version uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app AS $$
DECLARE c contracts%ROWTYPE; d documents%ROWTYPE; v document_versions%ROWTYPE; expected_type text;
BEGIN
  SELECT * INTO c FROM contracts WHERE tenant_id=p_tenant AND id=p_contract;
  SELECT * INTO d FROM documents WHERE tenant_id=p_tenant AND id=p_document;
  SELECT * INTO v FROM document_versions WHERE tenant_id=p_tenant AND document_id=p_document AND id=p_version;
  expected_type:=app.contract_document_type(c.contract_type);
  IF c.id IS NULL OR d.id IS NULL OR v.id IS NULL OR d.project_id<>c.project_id OR v.project_id<>c.project_id
    OR d.storage_provider<>'sharepoint' OR d.archived_at IS NOT NULL OR v.status_code NOT IN ('ready','sent','negotiation','signed')
    OR d.mime_type NOT IN ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    OR v.content_hash IS NULL OR v.content_hash!~'^sha256:[a-f0-9]{64}$' OR NULLIF(btrim(v.external_version_id),'') IS NULL
    OR NOT EXISTS(SELECT 1 FROM document_types t WHERE t.tenant_id=p_tenant AND t.id=d.document_type_id AND t.code=expected_type)
    OR NOT EXISTS(SELECT 1 FROM contract_documents l WHERE l.tenant_id=p_tenant AND l.project_id=c.project_id AND l.contract_id=c.id AND l.document_id=d.id)
    OR NOT EXISTS(SELECT 1 FROM unit_documents l WHERE l.tenant_id=p_tenant AND l.project_id=c.project_id AND l.unit_id=c.unit_id AND l.document_id=d.id)
    OR NOT EXISTS(SELECT 1 FROM sales_case_documents l WHERE l.tenant_id=p_tenant AND l.project_id=c.project_id AND l.sales_case_id=c.sales_case_id AND l.document_id=d.id)
    OR NOT EXISTS(SELECT 1 FROM document_upload_operations u WHERE u.tenant_id=p_tenant AND u.document_version_id=v.id AND u.state='completed'
      AND u.graph_item_id=d.external_item_id AND u.graph_drive_id=d.external_drive_id AND u.content_hash=v.content_hash
      AND u.metadata->>'contractId'=c.id::text AND u.metadata->>'unitId'=c.unit_id::text AND u.metadata->>'salesCaseId'=c.sales_case_id::text)
  THEN RAISE EXCEPTION 'SIGNED_DOCUMENT_REQUIRED'; END IF;
  IF EXISTS(SELECT 1 FROM document_upload_operations u WHERE u.tenant_id=p_tenant AND u.document_id=d.id AND u.state<>'completed')
    THEN RAISE EXCEPTION 'DOCUMENT_UPLOAD_IN_PROGRESS'; END IF;
  IF EXISTS(SELECT 1 FROM document_generation_operations g JOIN document_templates t ON t.tenant_id=g.tenant_id
      JOIN document_template_versions tv ON tv.tenant_id=g.tenant_id AND tv.id=g.template_version_id AND tv.template_id=t.id
      WHERE g.tenant_id=p_tenant AND g.contract_id=c.id AND t.output_type_code='reservation_contract'
        AND (g.state='reserved' OR NOT EXISTS(SELECT 1 FROM contract_versions cv WHERE cv.tenant_id=g.tenant_id AND cv.generation_operation_id=g.id)))
    THEN RAISE EXCEPTION 'DOCUMENT_GENERATION_IN_PROGRESS'; END IF;
END $$;

CREATE OR REPLACE FUNCTION app.assert_contract_document(p_tenant uuid,p_contract uuid,p_document uuid,p_version uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app AS $$
BEGIN
  -- Mutation callers retain their established unit -> document lock order.
  -- Re-read the authoritative metadata after this lock has been acquired.
  PERFORM 1 FROM documents WHERE tenant_id=p_tenant AND id=p_document FOR UPDATE;
  PERFORM app.check_contract_document(p_tenant,p_contract,p_document,p_version);
END $$;

CREATE OR REPLACE FUNCTION app.contract_document_is_ready(p_tenant uuid,p_contract uuid,p_document uuid,p_version uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app AS $$
BEGIN
  -- Advisory display only, never authorization to sign. Signature/binding
  -- operations still revalidate through the locked assertion above.
  PERFORM app.check_contract_document(p_tenant,p_contract,p_document,p_version);
  RETURN true;
EXCEPTION WHEN raise_exception THEN RETURN false;
END $$;

REVOKE ALL ON FUNCTION app.check_contract_document(uuid,uuid,uuid,uuid) FROM PUBLIC;

-- No historical evidence, permission assignment or business row is rewritten.
COMMIT;

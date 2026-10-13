BEGIN;

ALTER TABLE project_inventory_import_batches ADD COLUMN request_hash text;

CREATE OR REPLACE FUNCTION app.contract_document_type(p_type text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_type WHEN 'rs' THEN 'reservation_contract' WHEN 'sbk' THEN 'future_purchase_contract'
    WHEN 'ks' THEN 'purchase_contract' ELSE 'amendment' END
$$;

CREATE OR REPLACE FUNCTION app.lock_document_workflow_unit(p_tenant uuid,p_unit uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_unit IS NOT NULL THEN PERFORM app.lock_workflow_unit(p_tenant,p_unit); END IF;
END $$;

ALTER TABLE contract_versions DROP CONSTRAINT contract_versions_generated_document_shape;
ALTER TABLE contract_versions ADD CONSTRAINT contract_versions_generated_document_shape CHECK (
  (document_id IS NULL AND document_version_id IS NULL AND template_version_id IS NULL AND generation_operation_id IS NULL)
  OR (document_id IS NOT NULL AND document_version_id IS NOT NULL AND (
    (source_type='generated' AND template_version_id IS NOT NULL AND generation_operation_id IS NOT NULL)
    OR (source_type='imported' AND template_version_id IS NULL AND generation_operation_id IS NULL)
  ))
);

-- Old signed records are reported, not invented/backfilled. Every new or
-- changed signature is checked by triggers below, including INSERT paths.
ALTER TABLE contract_versions ADD CONSTRAINT signed_contract_exact_document CHECK (
  version_status<>'signed' OR (document_id IS NOT NULL AND document_version_id IS NOT NULL)
) NOT VALID;

CREATE OR REPLACE FUNCTION app.assert_contract_document(p_tenant uuid,p_contract uuid,p_document uuid,p_version uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app AS $$
DECLARE c contracts%ROWTYPE; d documents%ROWTYPE; v document_versions%ROWTYPE; expected_type text;
BEGIN
  SELECT * INTO c FROM contracts WHERE tenant_id=p_tenant AND id=p_contract;
  SELECT * INTO d FROM documents WHERE tenant_id=p_tenant AND id=p_document FOR UPDATE;
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

CREATE OR REPLACE FUNCTION app.guard_signature_document() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cv contract_versions%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME='contract_versions' THEN
    IF TG_OP='UPDATE' AND OLD.version_status='signed' THEN RAISE EXCEPTION 'signed contract versions are immutable'; END IF;
    IF TG_OP='UPDATE' AND OLD.document_version_id IS NOT NULL
      AND ROW(NEW.tenant_id,NEW.project_id,NEW.contract_id,NEW.document_id,NEW.document_version_id,NEW.template_version_id,NEW.generation_operation_id,NEW.generation_payload,NEW.source_type,NEW.version_number,NEW.based_on_version_id)
        IS DISTINCT FROM ROW(OLD.tenant_id,OLD.project_id,OLD.contract_id,OLD.document_id,OLD.document_version_id,OLD.template_version_id,OLD.generation_operation_id,OLD.generation_payload,OLD.source_type,OLD.version_number,OLD.based_on_version_id)
      THEN RAISE EXCEPTION 'DOCUMENT_VERSION_BINDING_IMMUTABLE'; END IF;
    IF TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM contract_parties cp WHERE cp.tenant_id=OLD.tenant_id AND cp.signed_version_id=OLD.id AND cp.signature_status='signed')
      AND (NEW.version_status<>'signed' OR (to_jsonb(NEW)-'version_status'-'signed_at'-'locked_at') IS DISTINCT FROM (to_jsonb(OLD)-'version_status'-'signed_at'-'locked_at'))
      THEN RAISE EXCEPTION 'SIGNED_DOCUMENT_IMMUTABLE'; END IF;
    IF NEW.version_status='signed' THEN PERFORM app.assert_contract_document(NEW.tenant_id,NEW.contract_id,NEW.document_id,NEW.document_version_id); END IF;
    IF NEW.version_status='signed' AND NEW.source_type='generated' AND NOT EXISTS(
      SELECT 1 FROM document_generation_operations g WHERE g.tenant_id=NEW.tenant_id AND g.project_id=NEW.project_id AND g.contract_id=NEW.contract_id
        AND g.id=NEW.generation_operation_id AND g.template_version_id=NEW.template_version_id AND g.state='completed'
        AND g.output_document_id=NEW.document_id AND g.output_document_version_id=NEW.document_version_id AND g.generation_snapshot=NEW.generation_payload)
      THEN RAISE EXCEPTION 'SIGNED_DOCUMENT_REQUIRED'; END IF;
  ELSIF TG_TABLE_NAME='contract_parties' THEN
    IF NEW.signature_status='signed' THEN
      SELECT * INTO cv FROM contract_versions WHERE tenant_id=NEW.tenant_id AND contract_id=NEW.contract_id AND id=NEW.signed_version_id;
      PERFORM app.assert_contract_document(NEW.tenant_id,NEW.contract_id,cv.document_id,cv.document_version_id);
    END IF;
  ELSE
    IF TG_OP='UPDATE' AND OLD.current_status IN ('signed','terminated') AND
      ROW(NEW.tenant_id,NEW.project_id,NEW.unit_id,NEW.sales_case_id,NEW.contract_type) IS DISTINCT FROM
      ROW(OLD.tenant_id,OLD.project_id,OLD.unit_id,OLD.sales_case_id,OLD.contract_type)
      THEN RAISE EXCEPTION 'SIGNED_DOCUMENT_IMMUTABLE'; END IF;
    IF NEW.current_status='signed' THEN
      SELECT * INTO cv FROM contract_versions WHERE tenant_id=NEW.tenant_id AND contract_id=NEW.id ORDER BY version_number DESC LIMIT 1;
      IF cv.version_status IS DISTINCT FROM 'signed' THEN RAISE EXCEPTION 'SIGNED_DOCUMENT_REQUIRED'; END IF;
      PERFORM app.assert_contract_document(NEW.tenant_id,NEW.id,cv.document_id,cv.document_version_id);
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.contract_document_is_ready(p_tenant uuid,p_contract uuid,p_document uuid,p_version uuid)
RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  PERFORM app.assert_contract_document(p_tenant,p_contract,p_document,p_version); RETURN true;
EXCEPTION WHEN raise_exception THEN RETURN false;
END $$;
CREATE TRIGGER contract_exact_signature_document BEFORE INSERT OR UPDATE ON contracts FOR EACH ROW EXECUTE FUNCTION app.guard_signature_document();
CREATE TRIGGER contract_version_exact_signature_document BEFORE INSERT OR UPDATE ON contract_versions FOR EACH ROW EXECUTE FUNCTION app.guard_signature_document();
CREATE TRIGGER contract_party_exact_signature_document BEFORE INSERT OR UPDATE ON contract_parties FOR EACH ROW EXECUTE FUNCTION app.guard_signature_document();

CREATE OR REPLACE FUNCTION app.audit_signature_document() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v document_versions%ROWTYPE;
BEGIN
  IF NEW.version_status='signed' AND (TG_OP='INSERT' OR OLD.version_status IS DISTINCT FROM 'signed') THEN
    SELECT * INTO v FROM document_versions WHERE tenant_id=NEW.tenant_id AND id=NEW.document_version_id;
    INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data)
      VALUES(NEW.tenant_id,app.current_user_id(),'contract.signature_document_evidenced','contract_version',NEW.id,
        jsonb_build_object('contractId',NEW.contract_id,'documentId',NEW.document_id,'documentVersionId',NEW.document_version_id,'contentHash',v.content_hash,'externalVersionId',v.external_version_id));
    INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
      VALUES(NEW.tenant_id,'contract',NEW.contract_id,'contract.signature_document_evidenced.v1',
        jsonb_build_object('contractVersionId',NEW.id,'documentVersionId',NEW.document_version_id,'contentHash',v.content_hash));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER contract_signature_document_audit AFTER INSERT OR UPDATE ON contract_versions FOR EACH ROW EXECUTE FUNCTION app.audit_signature_document();

CREATE OR REPLACE FUNCTION app.document_has_signature_evidence(p_tenant uuid,p_document uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS(SELECT 1 FROM contract_versions cv WHERE cv.tenant_id=p_tenant AND cv.document_id=p_document
    AND (cv.version_status='signed' OR EXISTS(SELECT 1 FROM contract_parties cp WHERE cp.tenant_id=cv.tenant_id AND cp.signed_version_id=cv.id AND cp.signature_status='signed')))
$$;

CREATE OR REPLACE FUNCTION app.guard_signed_document_upload() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.operation_type='version' THEN
    PERFORM 1 FROM documents WHERE tenant_id=NEW.tenant_id AND id=NEW.document_id FOR UPDATE;
    IF app.document_has_signature_evidence(NEW.tenant_id,NEW.document_id)
      THEN RAISE EXCEPTION 'SIGNED_DOCUMENT_IMMUTABLE'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER signed_document_upload_guard BEFORE INSERT OR UPDATE ON document_upload_operations FOR EACH ROW EXECUTE FUNCTION app.guard_signed_document_upload();

CREATE OR REPLACE FUNCTION app.guard_signed_document_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF app.document_has_signature_evidence(OLD.tenant_id,OLD.id) THEN
    IF TG_OP='DELETE' OR ROW(NEW.tenant_id,NEW.project_id,NEW.document_type_id,NEW.storage_provider,NEW.external_drive_id,NEW.external_item_id,NEW.etag,NEW.mime_type,NEW.file_size,NEW.web_url,NEW.archived_at)
      IS DISTINCT FROM ROW(OLD.tenant_id,OLD.project_id,OLD.document_type_id,OLD.storage_provider,OLD.external_drive_id,OLD.external_item_id,OLD.etag,OLD.mime_type,OLD.file_size,OLD.web_url,OLD.archived_at)
      THEN RAISE EXCEPTION 'SIGNED_DOCUMENT_IMMUTABLE'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER signed_document_identity_guard BEFORE UPDATE OR DELETE ON documents FOR EACH ROW EXECUTE FUNCTION app.guard_signed_document_identity();

CREATE OR REPLACE FUNCTION app.guard_signed_document_link() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF app.document_has_signature_evidence(OLD.tenant_id,OLD.document_id)
    THEN RAISE EXCEPTION 'SIGNED_DOCUMENT_IMMUTABLE'; END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER signed_contract_document_link BEFORE UPDATE OR DELETE ON contract_documents FOR EACH ROW EXECUTE FUNCTION app.guard_signed_document_link();
CREATE TRIGGER signed_unit_document_link BEFORE UPDATE OR DELETE ON unit_documents FOR EACH ROW EXECUTE FUNCTION app.guard_signed_document_link();
CREATE TRIGGER signed_case_document_link BEFORE UPDATE OR DELETE ON sales_case_documents FOR EACH ROW EXECUTE FUNCTION app.guard_signed_document_link();
CREATE TRIGGER signed_party_document_link BEFORE UPDATE OR DELETE ON party_documents FOR EACH ROW EXECUTE FUNCTION app.guard_signed_document_link();

CREATE OR REPLACE FUNCTION app.bind_external_contract_document(p_tenant uuid,p_contract uuid,p_document uuid,p_document_version uuid,p_actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app AS $$
DECLARE c contracts%ROWTYPE; previous contract_versions%ROWTYPE; result uuid;
BEGIN
  IF p_tenant IS DISTINCT FROM app.current_tenant_id() THEN RAISE EXCEPTION 'tenant context required'; END IF;
  PERFORM app.lock_workflow_unit(p_tenant,(SELECT unit_id FROM contracts WHERE tenant_id=p_tenant AND id=p_contract));
  SELECT * INTO c FROM contracts WHERE tenant_id=p_tenant AND id=p_contract FOR UPDATE;
  IF c.id IS NULL OR NOT app.has_project_permission(p_tenant,p_actor,c.project_id,'contract.manage')
    OR NOT app.has_project_permission(p_tenant,p_actor,c.project_id,'documents.upload')
    OR NOT EXISTS(SELECT 1 FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor AND user_id=app.current_user_id() AND status='active')
    THEN RAISE EXCEPTION 'contract.manage permission required'; END IF;
  IF c.current_status IN ('signed','cancelled','terminated') THEN RAISE EXCEPTION 'SIGNED_DOCUMENT_IMMUTABLE'; END IF;
  PERFORM app.assert_contract_document(p_tenant,p_contract,p_document,p_document_version);
  SELECT id INTO result FROM contract_versions WHERE tenant_id=p_tenant AND contract_id=p_contract AND document_version_id=p_document_version;
  IF result IS NOT NULL THEN RETURN result; END IF;
  SELECT * INTO previous FROM contract_versions WHERE tenant_id=p_tenant AND contract_id=p_contract ORDER BY version_number DESC LIMIT 1 FOR UPDATE;
  IF previous.version_number=1 AND previous.source_type='manual' AND previous.document_id IS NULL THEN
    UPDATE contract_versions SET source_type='imported',document_id=p_document,document_version_id=p_document_version,version_status='working',approved_at=NULL
      WHERE tenant_id=p_tenant AND id=previous.id RETURNING id INTO result;
  ELSE
    UPDATE contract_versions SET version_status='superseded' WHERE tenant_id=p_tenant AND contract_id=p_contract AND version_status IN ('working','approved_for_signing');
    INSERT INTO contract_versions(tenant_id,project_id,contract_id,version_number,based_on_version_id,source_type,display_name,created_by_membership_id,document_id,document_version_id)
      VALUES(p_tenant,c.project_id,p_contract,COALESCE(previous.version_number,0)+1,previous.id,'imported',c.reference||' · externí dokument',p_actor,p_document,p_document_version) RETURNING id INTO result;
  END IF;
  INSERT INTO party_documents(tenant_id,project_id,party_id,document_id,linked_by_membership_id)
    SELECT p_tenant,c.project_id,cp.party_id,p_document,p_actor FROM contract_parties cp
    WHERE cp.tenant_id=p_tenant AND cp.contract_id=c.id AND cp.effective_to IS NULL AND cp.participant_role IN ('buyer','co_buyer','assignee')
    ON CONFLICT DO NOTHING;
  IF c.current_status IN ('approved','signing') THEN
    PERFORM set_config('app.contract_status_command','on',true);
    UPDATE contracts SET current_status='draft' WHERE tenant_id=p_tenant AND id=p_contract;
    INSERT INTO contract_status_events(tenant_id,project_id,contract_id,from_status,to_status,command,reason,recorded_by_membership_id,source)
      VALUES(p_tenant,c.project_id,p_contract,c.current_status,'draft','externalDocument','Nový finální dokument vyžaduje schválení',p_actor,'automation');
  END IF;
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data)
    SELECT p_tenant,user_id,'contract.external_document_bound','contract_version',result,jsonb_build_object('contractId',p_contract,'documentVersionId',p_document_version)
    FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor;
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
    VALUES(p_tenant,'contract',p_contract,'contract.external_document_bound',jsonb_build_object('versionId',result,'documentVersionId',p_document_version));
  RETURN result;
END $$;
GRANT EXECUTE ON FUNCTION app.bind_external_contract_document(uuid,uuid,uuid,uuid,uuid) TO develocrm_app;

CREATE OR REPLACE FUNCTION app.record_document_graph_upload(
  p_tenant uuid,p_operation uuid,p_drive text,p_item text,p_url text,p_etag text,p_external_version text,
  p_size bigint,p_actor uuid,p_stored_hash text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app AS $$
BEGIN
  IF p_stored_hash IS NULL OR p_stored_hash!~'^sha256:[a-f0-9]{64}$' THEN RAISE EXCEPTION 'invalid stored content hash'; END IF;
  PERFORM app.record_document_graph_upload(p_tenant,p_operation,p_drive,p_item,p_url,p_etag,p_external_version,p_size,p_actor);
  UPDATE document_upload_operations SET content_hash=p_stored_hash WHERE tenant_id=p_tenant AND id=p_operation;
  RETURN p_operation;
END $$;
GRANT EXECUTE ON FUNCTION app.record_document_graph_upload(uuid,uuid,text,text,text,text,text,bigint,uuid,text) TO develocrm_app;

CREATE OR REPLACE FUNCTION app.reserve_document_upload(
  p_tenant uuid,p_project uuid,p_idempotency_key text,p_request_hash text,p_operation_type text,
  p_existing_document uuid,p_type_code text,p_document_name text,p_original_file_name text,p_mime_type text,
  p_file_size bigint,p_content_hash text,p_version_label text,p_status text,p_note text,
  p_unit uuid,p_party uuid,p_contract uuid,p_sales_case uuid,p_actor_membership uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app AS $$
DECLARE actor_user uuid; operation_id uuid; reserved_document_id uuid; reserved_version_id uuid:=gen_random_uuid(); existing_hash text;
BEGIN
  PERFORM app.lock_document_workflow_unit(p_tenant,COALESCE(p_unit,(SELECT unit_id FROM unit_documents WHERE tenant_id=p_tenant AND document_id=p_existing_document ORDER BY unit_id LIMIT 1)));
  SELECT user_id INTO actor_user FROM public.tenant_memberships
    WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF actor_user IS NULL OR NOT app.has_project_permission(p_tenant,p_actor_membership,p_project,'documents.upload')
    THEN RAISE EXCEPTION 'documents.upload permission required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.projects WHERE tenant_id=p_tenant AND id=p_project AND archived_at IS NULL)
    THEN RAISE EXCEPTION 'project not found'; END IF;
  IF p_operation_type NOT IN ('create','version') THEN RAISE EXCEPTION 'invalid upload operation'; END IF;
  IF p_file_size<1 OR p_file_size>4194304 THEN RAISE EXCEPTION 'invalid upload size'; END IF;

  SELECT id,request_hash INTO operation_id,existing_hash FROM public.document_upload_operations
    WHERE tenant_id=p_tenant AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF operation_id IS NOT NULL THEN
    IF existing_hash<>p_request_hash THEN RAISE EXCEPTION 'idempotency key payload mismatch'; END IF;
    RETURN operation_id;
  END IF;

  IF p_operation_type='version' THEN
    SELECT id INTO reserved_document_id FROM public.documents
      WHERE tenant_id=p_tenant AND project_id=p_project AND id=p_existing_document
        AND storage_provider='sharepoint' AND archived_at IS NULL FOR UPDATE;
    IF reserved_document_id IS NULL THEN RAISE EXCEPTION 'sharepoint document not found'; END IF;
    IF EXISTS(SELECT 1 FROM public.document_upload_operations WHERE tenant_id=p_tenant AND document_id=reserved_document_id AND state<>'completed')
      THEN RAISE EXCEPTION 'DOCUMENT_UPLOAD_IN_PROGRESS'; END IF;
  ELSE
    IF NOT EXISTS(SELECT 1 FROM public.document_types WHERE tenant_id=p_tenant AND code=p_type_code AND is_active AND archived_at IS NULL)
      THEN RAISE EXCEPTION 'unknown document type'; END IF;
    reserved_document_id:=gen_random_uuid();
  END IF;

  IF p_unit IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.units WHERE tenant_id=p_tenant AND project_id=p_project AND id=p_unit AND archived_at IS NULL)
    THEN RAISE EXCEPTION 'unit not found in project'; END IF;
  IF p_party IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.parties WHERE tenant_id=p_tenant AND id=p_party AND archived_at IS NULL)
    THEN RAISE EXCEPTION 'party not found'; END IF;
  IF p_contract IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.contracts WHERE tenant_id=p_tenant AND project_id=p_project AND id=p_contract)
    THEN RAISE EXCEPTION 'contract not found in project'; END IF;
  IF p_sales_case IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.sales_cases WHERE tenant_id=p_tenant AND project_id=p_project AND id=p_sales_case)
    THEN RAISE EXCEPTION 'sales case not found in project'; END IF;

  INSERT INTO public.document_upload_operations(
    tenant_id,project_id,idempotency_key,request_hash,operation_type,document_id,document_version_id,
    original_file_name,mime_type,file_size,content_hash,version_label,document_status,metadata,baseline_etag,created_by_membership_id
  ) VALUES(
    p_tenant,p_project,p_idempotency_key,p_request_hash,p_operation_type,reserved_document_id,reserved_version_id,
    p_original_file_name,p_mime_type,p_file_size,p_content_hash,p_version_label,p_status,
    jsonb_strip_nulls(jsonb_build_object('existingDocumentId',p_existing_document,'typeCode',p_type_code,'documentName',p_document_name,
      'note',p_note,'unitId',p_unit,'partyId',p_party,'contractId',p_contract,'salesCaseId',p_sales_case)),
    (SELECT etag FROM public.documents WHERE tenant_id=p_tenant AND id=reserved_document_id),p_actor_membership
  ) RETURNING id INTO operation_id;
  RETURN operation_id;
END $$;

CREATE OR REPLACE FUNCTION app.finalize_document_upload(
  p_tenant uuid,p_operation uuid,p_actor_membership uuid
) RETURNS TABLE(document_id uuid,document_version_id uuid,replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app AS $$
DECLARE upload public.document_upload_operations%ROWTYPE; actor_user uuid; type_id uuid; category_code text; version_identifier text;
BEGIN
  PERFORM app.lock_document_workflow_unit(p_tenant,(SELECT COALESCE((u.metadata->>'unitId')::uuid,(SELECT link.unit_id FROM unit_documents link WHERE link.tenant_id=p_tenant AND link.document_id=u.document_id ORDER BY link.unit_id LIMIT 1)) FROM document_upload_operations u WHERE u.tenant_id=p_tenant AND u.id=p_operation));
  SELECT * INTO upload FROM public.document_upload_operations
    WHERE tenant_id=p_tenant AND id=p_operation FOR UPDATE;
  SELECT user_id INTO actor_user FROM public.tenant_memberships
    WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF upload.id IS NULL OR actor_user IS NULL OR NOT app.has_project_permission(p_tenant,p_actor_membership,upload.project_id,'documents.upload')
    THEN RAISE EXCEPTION 'documents.upload permission required'; END IF;
  IF upload.state='completed' THEN
    RETURN QUERY SELECT upload.document_id,upload.document_version_id,true; RETURN;
  END IF;
  IF upload.state<>'uploaded' OR upload.graph_item_id IS NULL OR upload.graph_drive_id IS NULL
    THEN RAISE EXCEPTION 'graph upload is not recorded'; END IF;
  version_identifier:='upload:'||upload.document_version_id::text;

  IF upload.operation_type='create' THEN
    SELECT id INTO type_id FROM public.document_types WHERE tenant_id=p_tenant AND code=upload.metadata->>'typeCode' AND is_active AND archived_at IS NULL;
    IF type_id IS NULL THEN RAISE EXCEPTION 'unknown document type'; END IF;
    category_code:=CASE WHEN upload.metadata->>'typeCode' IN ('reservation_contract','future_purchase_contract','purchase_contract','amendment') THEN 'contract'
      WHEN upload.metadata->>'typeCode' IN ('handover_protocol','photo_documentation') THEN 'project_documentation'
      WHEN upload.metadata->>'typeCode' IN ('client_change','complaint_protocol') THEN 'client_document' ELSE 'other' END;
    INSERT INTO public.documents(id,tenant_id,project_id,document_type_id,name,category,mime_type,file_size,storage_provider,
      external_drive_id,external_item_id,web_url,etag,status_code,note,created_by_membership_id,updated_by_membership_id)
    VALUES(upload.document_id,p_tenant,upload.project_id,type_id,upload.metadata->>'documentName',category_code,upload.mime_type,
      COALESCE(upload.graph_file_size,upload.file_size),'sharepoint',upload.graph_drive_id,upload.graph_item_id,upload.graph_web_url,
      upload.graph_etag,upload.document_status,upload.metadata->>'note',p_actor_membership,p_actor_membership);
    INSERT INTO public.project_documents(tenant_id,project_id,document_id,linked_by_membership_id)
      VALUES(p_tenant,upload.project_id,upload.document_id,p_actor_membership);
    IF upload.metadata->>'unitId' IS NOT NULL THEN
      INSERT INTO public.unit_documents(tenant_id,project_id,unit_id,document_id,linked_by_membership_id)
      VALUES(p_tenant,upload.project_id,(upload.metadata->>'unitId')::uuid,upload.document_id,p_actor_membership);
    END IF;
    IF upload.metadata->>'partyId' IS NOT NULL THEN
      INSERT INTO public.party_documents(tenant_id,project_id,party_id,document_id,linked_by_membership_id)
      VALUES(p_tenant,upload.project_id,(upload.metadata->>'partyId')::uuid,upload.document_id,p_actor_membership);
    END IF;
    IF upload.metadata->>'contractId' IS NOT NULL THEN
      INSERT INTO public.contract_documents(tenant_id,project_id,contract_id,document_id,linked_by_membership_id)
      VALUES(p_tenant,upload.project_id,(upload.metadata->>'contractId')::uuid,upload.document_id,p_actor_membership);
    END IF;
    IF upload.metadata->>'salesCaseId' IS NOT NULL THEN
      INSERT INTO public.sales_case_documents(tenant_id,project_id,sales_case_id,document_id,linked_by_membership_id)
      VALUES(p_tenant,upload.project_id,(upload.metadata->>'salesCaseId')::uuid,upload.document_id,p_actor_membership);
    END IF;
    INSERT INTO public.document_events(tenant_id,project_id,document_id,event_type,title,note,actor_membership_id,details)
    VALUES(p_tenant,upload.project_id,upload.document_id,'created','Dokument vytvořen',upload.metadata->>'note',p_actor_membership,
      jsonb_build_object('typeCode',upload.metadata->>'typeCode','status',upload.document_status,'storageProvider','sharepoint'));
  ELSE
    UPDATE public.documents SET file_size=COALESCE(upload.graph_file_size,upload.file_size),external_drive_id=upload.graph_drive_id,
      external_item_id=upload.graph_item_id,web_url=upload.graph_web_url,etag=upload.graph_etag,status_code=upload.document_status,
      updated_by_membership_id=p_actor_membership WHERE tenant_id=p_tenant AND project_id=upload.project_id AND id=upload.document_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'document not found'; END IF;
  END IF;

  INSERT INTO public.document_versions(id,tenant_id,project_id,document_id,version_identifier,external_version_id,version_label,
    status_code,note,etag,file_size,content_hash,created_by_membership_id,metadata)
  VALUES(upload.document_version_id,p_tenant,upload.project_id,upload.document_id,version_identifier,upload.graph_version_id,
    upload.version_label,upload.document_status,upload.metadata->>'note',upload.graph_etag,COALESCE(upload.graph_file_size,upload.file_size),
    upload.content_hash,p_actor_membership,jsonb_build_object('uploadOperationId',upload.id,'sharePointPath',upload.target_path));
  INSERT INTO public.document_events(tenant_id,project_id,document_id,document_version_id,event_type,title,note,actor_membership_id,details)
  VALUES(p_tenant,upload.project_id,upload.document_id,upload.document_version_id,'version_created','Vytvořena nová verze',
    upload.metadata->>'note',p_actor_membership,jsonb_build_object('versionLabel',upload.version_label,'externalVersionId',upload.graph_version_id));
  INSERT INTO public.audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data,metadata)
  VALUES(p_tenant,actor_user,'document.uploaded','document_version',upload.document_version_id,
    jsonb_build_object('documentId',upload.document_id,'projectId',upload.project_id,'versionLabel',upload.version_label,'fileSize',COALESCE(upload.graph_file_size,upload.file_size)),
    jsonb_build_object('uploadOperationId',upload.id,'idempotencyKey',upload.idempotency_key));
  INSERT INTO public.outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'document',upload.document_id,'document.uploaded',jsonb_build_object('schemaVersion',1,'documentId',upload.document_id,
    'versionId',upload.document_version_id,'projectId',upload.project_id,'uploadOperationId',upload.id));
  UPDATE public.document_upload_operations SET state='completed',completed_at=now(),error_code=NULL WHERE tenant_id=p_tenant AND id=upload.id;
  RETURN QUERY SELECT upload.document_id,upload.document_version_id,false;
END $$;

CREATE OR REPLACE FUNCTION app.record_contract_party_signature(
  p_tenant uuid,p_contract_party uuid,p_version uuid,p_actor_membership uuid,p_reason text
) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE participant contract_parties%ROWTYPE;contract_row contracts%ROWTYPE;actor uuid;remaining integer;reason_text text:=COALESCE(NULLIF(btrim(p_reason),''),'Podpis účastníka zaznamenán');
BEGIN
  PERFORM app.lock_workflow_unit(p_tenant,(SELECT c.unit_id FROM contracts c JOIN contract_parties cp ON cp.tenant_id=c.tenant_id AND cp.contract_id=c.id WHERE cp.tenant_id=p_tenant AND cp.id=p_contract_party));
  SELECT * INTO participant FROM contract_parties WHERE tenant_id=p_tenant AND id=p_contract_party FOR UPDATE;
  SELECT * INTO contract_row FROM contracts WHERE tenant_id=p_tenant AND id=participant.contract_id FOR UPDATE;
  SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF participant.id IS NULL OR contract_row.current_status NOT IN ('approved','signing') OR actor IS NULL OR NOT app.has_project_permission(p_tenant,p_actor_membership,contract_row.project_id,'contract.sign') THEN RAISE EXCEPTION 'contract.sign permission and approved workflow are required';END IF;
  IF NOT EXISTS(SELECT 1 FROM contract_versions WHERE tenant_id=p_tenant AND contract_id=contract_row.id AND id=p_version AND version_status='approved_for_signing') THEN RAISE EXCEPTION 'approved contract version is required';END IF;
  IF participant.signature_status='signed' AND participant.signed_version_id=p_version THEN RETURN contract_row.current_status='signed';END IF;
  UPDATE contract_parties SET signature_status='signed',signed_at=now(),signed_version_id=p_version WHERE tenant_id=p_tenant AND id=p_contract_party;
  SELECT count(*) INTO remaining FROM contract_parties WHERE tenant_id=p_tenant AND contract_id=contract_row.id AND signing_required AND signature_status<>'signed';
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data) VALUES(p_tenant,actor,'contract.party_signed','contract_party',p_contract_party,jsonb_build_object('contractId',contract_row.id,'versionId',p_version));
  IF remaining>0 THEN RETURN false;END IF;
  UPDATE contract_versions SET version_status='signed',signed_at=now(),locked_at=now() WHERE tenant_id=p_tenant AND id=p_version;
  PERFORM set_config('app.contract_status_command','on',true);
  UPDATE contracts SET current_status='signed',signed_at=now() WHERE tenant_id=p_tenant AND id=contract_row.id;
  INSERT INTO contract_status_events(tenant_id,project_id,contract_id,from_status,to_status,command,reason,recorded_by_membership_id,source)
  VALUES(p_tenant,contract_row.project_id,contract_row.id,contract_row.current_status,'signed','completeSignatures',reason_text,p_actor_membership,'signature');
  PERFORM app.synchronize_signed_contract(p_tenant,contract_row.id,p_actor_membership,reason_text);
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data) VALUES(p_tenant,actor,'contract.signed','contract',contract_row.id,jsonb_build_object('versionId',p_version,'type',contract_row.contract_type));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload) VALUES(p_tenant,'contract',contract_row.id,'contract.signed.v1',jsonb_build_object('contractId',contract_row.id,'versionId',p_version,'type',contract_row.contract_type,'unitId',contract_row.unit_id));
  RETURN true;
END $$;

COMMIT;

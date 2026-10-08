BEGIN;

CREATE TABLE document_upload_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 8 AND 160),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  operation_type text NOT NULL CHECK (operation_type IN ('create','version')),
  document_id uuid NOT NULL,
  document_version_id uuid NOT NULL,
  original_file_name text NOT NULL CHECK (length(btrim(original_file_name)) BETWEEN 1 AND 240),
  sharepoint_file_name text,
  target_path text[],
  mime_type text NOT NULL CHECK (position('/' IN mime_type)>1),
  file_size bigint NOT NULL CHECK (file_size BETWEEN 1 AND 4194304),
  content_hash text NOT NULL CHECK (content_hash ~ '^sha256:[a-f0-9]{64}$'),
  version_label text NOT NULL CHECK (length(btrim(version_label)) BETWEEN 1 AND 80),
  document_status text NOT NULL CHECK (document_status IN ('draft','ready','sent','negotiation','signed','archived')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  baseline_etag text,
  state text NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved','uploaded','completed','failed')),
  graph_drive_id text,
  graph_item_id text,
  graph_web_url text,
  graph_etag text,
  graph_version_id text,
  graph_file_size bigint,
  error_code text,
  attempt_count integer NOT NULL DEFAULT 0,
  created_by_membership_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT document_upload_operations_project_fk FOREIGN KEY (tenant_id,project_id)
    REFERENCES projects(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT document_upload_operations_actor_fk FOREIGN KEY (tenant_id,created_by_membership_id)
    REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT document_upload_operations_tenant_pair_uq UNIQUE (tenant_id,id),
  CONSTRAINT document_upload_operations_idempotency_uq UNIQUE (tenant_id,idempotency_key),
  CONSTRAINT document_upload_operations_version_uq UNIQUE (tenant_id,document_version_id),
  CONSTRAINT document_upload_operations_shape CHECK (
    (operation_type='create' AND (metadata->>'existingDocumentId') IS NULL)
    OR (operation_type='version' AND metadata->>'existingDocumentId'=document_id::text)
  )
);

CREATE INDEX document_upload_operations_recovery_idx
  ON document_upload_operations(tenant_id,state,updated_at) WHERE state<>'completed';
CREATE TRIGGER document_upload_operations_touch_updated_at BEFORE UPDATE ON document_upload_operations
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE document_upload_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_upload_operations FORCE ROW LEVEL SECURITY;
CREATE POLICY document_upload_operations_tenant_policy ON document_upload_operations
  USING (tenant_id=app.current_tenant_id()) WITH CHECK (tenant_id=app.current_tenant_id());

CREATE OR REPLACE FUNCTION app.reserve_document_upload(
  p_tenant uuid,p_project uuid,p_idempotency_key text,p_request_hash text,p_operation_type text,
  p_existing_document uuid,p_type_code text,p_document_name text,p_original_file_name text,p_mime_type text,
  p_file_size bigint,p_content_hash text,p_version_label text,p_status text,p_note text,
  p_unit uuid,p_party uuid,p_contract uuid,p_sales_case uuid,p_actor_membership uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app AS $$
DECLARE actor_user uuid; operation_id uuid; reserved_document_id uuid; reserved_version_id uuid:=gen_random_uuid(); existing_hash text;
BEGIN
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

CREATE OR REPLACE FUNCTION app.prepare_document_upload_target(
  p_tenant uuid,p_operation uuid,p_target_path text[],p_sharepoint_file_name text,p_actor_membership uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app AS $$
DECLARE project uuid;
BEGIN
  SELECT project_id INTO project FROM public.document_upload_operations
    WHERE tenant_id=p_tenant AND id=p_operation AND created_by_membership_id=p_actor_membership FOR UPDATE;
  IF project IS NULL OR NOT app.has_project_permission(p_tenant,p_actor_membership,project,'documents.upload')
    THEN RAISE EXCEPTION 'documents.upload permission required'; END IF;
  IF cardinality(p_target_path)<1 OR EXISTS(SELECT 1 FROM unnest(p_target_path) segment WHERE segment IN ('','.','..') OR segment~'[\\/]')
    THEN RAISE EXCEPTION 'invalid upload path'; END IF;
  UPDATE public.document_upload_operations SET target_path=p_target_path,sharepoint_file_name=p_sharepoint_file_name
    WHERE tenant_id=p_tenant AND id=p_operation;
  RETURN p_operation;
END $$;

CREATE OR REPLACE FUNCTION app.record_document_graph_upload(
  p_tenant uuid,p_operation uuid,p_drive_id text,p_item_id text,p_web_url text,p_etag text,
  p_external_version_id text,p_file_size bigint,p_actor_membership uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app AS $$
DECLARE project uuid;
BEGIN
  SELECT project_id INTO project FROM public.document_upload_operations
    WHERE tenant_id=p_tenant AND id=p_operation AND created_by_membership_id=p_actor_membership FOR UPDATE;
  IF project IS NULL OR NOT app.has_project_permission(p_tenant,p_actor_membership,project,'documents.upload')
    THEN RAISE EXCEPTION 'documents.upload permission required'; END IF;
  UPDATE public.document_upload_operations SET state='uploaded',graph_drive_id=p_drive_id,graph_item_id=p_item_id,
    graph_web_url=p_web_url,graph_etag=p_etag,graph_version_id=p_external_version_id,graph_file_size=p_file_size,
    error_code=NULL,attempt_count=attempt_count+1
    WHERE tenant_id=p_tenant AND id=p_operation;
  RETURN p_operation;
END $$;

CREATE OR REPLACE FUNCTION app.finalize_document_upload(
  p_tenant uuid,p_operation uuid,p_actor_membership uuid
) RETURNS TABLE(document_id uuid,document_version_id uuid,replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app AS $$
DECLARE upload public.document_upload_operations%ROWTYPE; actor_user uuid; type_id uuid; category_code text; version_identifier text;
BEGIN
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

GRANT SELECT ON document_upload_operations TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.reserve_document_upload(uuid,uuid,text,text,text,uuid,text,text,text,text,bigint,text,text,text,text,uuid,uuid,uuid,uuid,uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.prepare_document_upload_target(uuid,uuid,text[],text,uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.record_document_graph_upload(uuid,uuid,text,text,text,text,text,bigint,uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.finalize_document_upload(uuid,uuid,uuid) TO develocrm_app;

COMMIT;

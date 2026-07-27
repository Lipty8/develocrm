BEGIN;

CREATE TABLE document_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[a-z][a-z0-9_]{1,63}$'),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  description text,
  sort_order integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT document_types_tenant_pair_uq UNIQUE (tenant_id,id),
  CONSTRAINT document_types_code_uq UNIQUE (tenant_id,code)
);

ALTER TABLE documents
  ADD COLUMN document_type_id uuid,
  ADD COLUMN status_code text NOT NULL DEFAULT 'draft'
    CHECK (status_code IN ('draft','ready','sent','negotiation','signed','archived')),
  ADD COLUMN note text,
  ADD CONSTRAINT documents_type_fk FOREIGN KEY (tenant_id,document_type_id)
    REFERENCES document_types(tenant_id,id) ON DELETE RESTRICT;

ALTER TABLE document_versions
  ADD COLUMN status_code text NOT NULL DEFAULT 'draft'
    CHECK (status_code IN ('draft','ready','sent','negotiation','signed','archived')),
  ADD COLUMN note text,
  ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE sales_case_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  sales_case_id uuid NOT NULL,
  document_id uuid NOT NULL,
  linked_by_membership_id uuid NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_case_documents_case_fk FOREIGN KEY (tenant_id,project_id,sales_case_id)
    REFERENCES sales_cases(tenant_id,project_id,id) ON DELETE RESTRICT,
  CONSTRAINT sales_case_documents_document_fk FOREIGN KEY (tenant_id,project_id,document_id)
    REFERENCES documents(tenant_id,project_id,id) ON DELETE RESTRICT,
  CONSTRAINT sales_case_documents_actor_fk FOREIGN KEY (tenant_id,linked_by_membership_id)
    REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT sales_case_documents_tenant_pair_uq UNIQUE (tenant_id,id),
  CONSTRAINT sales_case_document_link_uq UNIQUE (tenant_id,sales_case_id,document_id)
);

CREATE TABLE document_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  document_id uuid NOT NULL,
  document_version_id uuid,
  event_type text NOT NULL CHECK (event_type IN (
    'created','metadata_changed','status_changed','version_created','linked','note_changed','archived'
  )),
  previous_status text,
  new_status text,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 2 AND 200),
  note text,
  actor_membership_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT document_events_document_fk FOREIGN KEY (tenant_id,project_id,document_id)
    REFERENCES documents(tenant_id,project_id,id) ON DELETE RESTRICT,
  CONSTRAINT document_events_version_fk FOREIGN KEY (tenant_id,project_id,document_id,document_version_id)
    REFERENCES document_versions(tenant_id,project_id,document_id,id) ON DELETE RESTRICT,
  CONSTRAINT document_events_actor_fk FOREIGN KEY (tenant_id,actor_membership_id)
    REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT document_events_tenant_pair_uq UNIQUE (tenant_id,id)
);
CREATE INDEX document_events_timeline_idx ON document_events(tenant_id,document_id,occurred_at DESC,id DESC);

CREATE TRIGGER document_types_touch_updated_at BEFORE UPDATE ON document_types FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER document_events_append_only BEFORE UPDATE OR DELETE ON document_events FOR EACH ROW EXECUTE FUNCTION app.reject_append_only();

CREATE OR REPLACE FUNCTION app.create_document_record(
  p_tenant uuid,p_project uuid,p_type_code text,p_name text,p_mime_type text,p_status text,p_note text,
  p_storage_provider text,p_external_drive_id text,p_external_item_id text,p_external_url text,p_actor_membership uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app AS $$
DECLARE actor_user uuid; document_id uuid:=gen_random_uuid(); type_id uuid; category_code text;
BEGIN
  SELECT user_id INTO actor_user FROM public.tenant_memberships
    WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF actor_user IS NULL OR NOT app.has_project_permission(p_tenant,p_actor_membership,p_project,'documents.upload')
    THEN RAISE EXCEPTION 'documents.upload permission required'; END IF;
  SELECT id INTO type_id FROM public.document_types
    WHERE tenant_id=p_tenant AND code=p_type_code AND is_active AND archived_at IS NULL;
  IF type_id IS NULL THEN RAISE EXCEPTION 'unknown document type'; END IF;
  category_code:=CASE WHEN p_type_code IN ('reservation_contract','future_purchase_contract','purchase_contract','amendment') THEN 'contract'
    WHEN p_type_code='handover_protocol' THEN 'project_documentation'
    WHEN p_type_code='photo_documentation' THEN 'project_documentation'
    WHEN p_type_code IN ('client_change','complaint_protocol') THEN 'client_document'
    ELSE 'other' END;
  INSERT INTO public.documents(
    id,tenant_id,project_id,document_type_id,name,category,mime_type,storage_provider,
    external_drive_id,external_item_id,web_url,status_code,note,created_by_membership_id
  ) VALUES(
    document_id,p_tenant,p_project,type_id,p_name,category_code,p_mime_type,p_storage_provider,
    p_external_drive_id,p_external_item_id,p_external_url,p_status,p_note,p_actor_membership
  );
  INSERT INTO public.document_events(tenant_id,project_id,document_id,event_type,title,note,actor_membership_id,details)
  VALUES(p_tenant,p_project,document_id,'created','Dokument vytvořen',p_note,p_actor_membership,jsonb_build_object('typeCode',p_type_code,'status',p_status));
  INSERT INTO public.audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data)
  VALUES(p_tenant,actor_user,'document.created','document',document_id,jsonb_build_object('projectId',p_project,'typeCode',p_type_code,'name',p_name,'status',p_status));
  INSERT INTO public.outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'document',document_id,'document.created',jsonb_build_object('schemaVersion',2,'documentId',document_id,'projectId',p_project));
  RETURN document_id;
END $$;

CREATE OR REPLACE FUNCTION app.update_document_record(
  p_tenant uuid,p_document uuid,p_name text,p_type_code text,p_status text,p_note text,p_actor_membership uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app AS $$
DECLARE project uuid; actor_user uuid; type_id uuid; before_row jsonb; after_row jsonb; old_status text; old_name text; old_note text;
BEGIN
  SELECT project_id,status_code,name,note,to_jsonb(document) INTO project,old_status,old_name,old_note,before_row
    FROM public.documents document WHERE tenant_id=p_tenant AND id=p_document AND archived_at IS NULL FOR UPDATE;
  SELECT user_id INTO actor_user FROM public.tenant_memberships
    WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF project IS NULL OR actor_user IS NULL OR NOT app.has_project_permission(p_tenant,p_actor_membership,project,'documents.edit_metadata')
    THEN RAISE EXCEPTION 'documents.edit_metadata permission required'; END IF;
  SELECT id INTO type_id FROM public.document_types WHERE tenant_id=p_tenant AND code=p_type_code AND is_active AND archived_at IS NULL;
  IF type_id IS NULL THEN RAISE EXCEPTION 'unknown document type'; END IF;
  IF old_status<>p_status AND NOT (
    (old_status='draft' AND p_status IN ('ready','archived')) OR
    (old_status='ready' AND p_status IN ('draft','sent','archived')) OR
    (old_status='sent' AND p_status IN ('negotiation','signed','archived')) OR
    (old_status='negotiation' AND p_status IN ('ready','sent','signed','archived')) OR
    (old_status='signed' AND p_status='archived')
  ) THEN RAISE EXCEPTION 'invalid document status transition: % -> %',old_status,p_status; END IF;
  UPDATE public.documents SET name=p_name,document_type_id=type_id,status_code=p_status,note=p_note,updated_by_membership_id=p_actor_membership
    WHERE tenant_id=p_tenant AND id=p_document RETURNING to_jsonb(documents) INTO after_row;
  IF old_name IS DISTINCT FROM p_name OR old_note IS DISTINCT FROM p_note THEN
    INSERT INTO public.document_events(tenant_id,project_id,document_id,event_type,title,note,actor_membership_id,details)
    VALUES(p_tenant,project,p_document,'metadata_changed','Metadata dokumentu upravena',p_note,p_actor_membership,
      jsonb_build_object('previousName',old_name,'newName',p_name));
  END IF;
  IF old_status IS DISTINCT FROM p_status THEN
    INSERT INTO public.document_events(tenant_id,project_id,document_id,event_type,previous_status,new_status,title,note,actor_membership_id)
    VALUES(p_tenant,project,p_document,'status_changed',old_status,p_status,'Stav dokumentu změněn',p_note,p_actor_membership);
  END IF;
  INSERT INTO public.audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data)
  VALUES(p_tenant,actor_user,'document.updated','document',p_document,before_row,after_row);
  INSERT INTO public.outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'document',p_document,'document.updated',jsonb_build_object('schemaVersion',2,'documentId',p_document,'projectId',project,'status',p_status));
  RETURN p_document;
END $$;

CREATE OR REPLACE FUNCTION app.create_document_version_v2(
  p_tenant uuid,p_document uuid,p_version_identifier text,p_version_label text,p_status text,p_note text,
  p_file_size bigint,p_content_hash text,p_actor_membership uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app AS $$
DECLARE project uuid; actor_user uuid; version_id uuid:=gen_random_uuid();
BEGIN
  SELECT project_id INTO project FROM public.documents WHERE tenant_id=p_tenant AND id=p_document AND archived_at IS NULL FOR UPDATE;
  SELECT user_id INTO actor_user FROM public.tenant_memberships
    WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF project IS NULL OR actor_user IS NULL OR NOT app.has_project_permission(p_tenant,p_actor_membership,project,'documents.upload')
    THEN RAISE EXCEPTION 'documents.upload permission required'; END IF;
  INSERT INTO public.document_versions(id,tenant_id,project_id,document_id,version_identifier,version_label,status_code,note,file_size,content_hash,created_by_membership_id)
  VALUES(version_id,p_tenant,project,p_document,p_version_identifier,p_version_label,p_status,p_note,p_file_size,p_content_hash,p_actor_membership);
  UPDATE public.documents SET status_code=p_status,updated_by_membership_id=p_actor_membership WHERE tenant_id=p_tenant AND id=p_document;
  INSERT INTO public.document_events(tenant_id,project_id,document_id,document_version_id,event_type,title,note,actor_membership_id,details)
  VALUES(p_tenant,project,p_document,version_id,'version_created','Vytvořena nová verze',p_note,p_actor_membership,jsonb_build_object('versionLabel',p_version_label,'status',p_status));
  INSERT INTO public.audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data)
  VALUES(p_tenant,actor_user,'document.version_created','document_version',version_id,jsonb_build_object('documentId',p_document,'versionLabel',p_version_label,'status',p_status));
  INSERT INTO public.outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'document',p_document,'document.version_created',jsonb_build_object('schemaVersion',2,'documentId',p_document,'versionId',version_id,'projectId',project));
  RETURN version_id;
END $$;

CREATE OR REPLACE FUNCTION app.link_document_to_sales_case(
  p_tenant uuid,p_document uuid,p_sales_case uuid,p_actor_membership uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app AS $$
DECLARE project uuid; actor_user uuid; link_id uuid:=gen_random_uuid();
BEGIN
  SELECT document.project_id INTO project FROM public.documents document
    JOIN public.sales_cases sales_case ON sales_case.tenant_id=document.tenant_id
      AND sales_case.project_id=document.project_id AND sales_case.id=p_sales_case
    WHERE document.tenant_id=p_tenant AND document.id=p_document AND document.archived_at IS NULL;
  SELECT user_id INTO actor_user FROM public.tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF project IS NULL OR actor_user IS NULL OR NOT app.has_project_permission(p_tenant,p_actor_membership,project,'documents.manage')
    THEN RAISE EXCEPTION 'documents.manage permission required'; END IF;
  INSERT INTO public.sales_case_documents(id,tenant_id,project_id,sales_case_id,document_id,linked_by_membership_id)
  VALUES(link_id,p_tenant,project,p_sales_case,p_document,p_actor_membership);
  INSERT INTO public.document_events(tenant_id,project_id,document_id,event_type,title,actor_membership_id,details)
  VALUES(p_tenant,project,p_document,'linked','Dokument navázán na obchodní případ',p_actor_membership,jsonb_build_object('salesCaseId',p_sales_case));
  INSERT INTO public.audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data)
  VALUES(p_tenant,actor_user,'document.linked','sales_case_document',link_id,jsonb_build_object('documentId',p_document,'salesCaseId',p_sales_case));
  INSERT INTO public.outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'document',p_document,'document.linked',jsonb_build_object('schemaVersion',2,'documentId',p_document,'linkType','sales_case','linkId',p_sales_case,'projectId',project));
  RETURN link_id;
END $$;

DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['document_types','sales_case_documents','document_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('CREATE POLICY %I ON %I USING (tenant_id=app.current_tenant_id()) WITH CHECK (tenant_id=app.current_tenant_id())',table_name||'_tenant_policy',table_name);
  END LOOP;
END $$;

GRANT SELECT ON document_types,sales_case_documents,document_events TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.create_document_record(uuid,uuid,text,text,text,text,text,text,text,text,text,uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.update_document_record(uuid,uuid,text,text,text,text,uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.create_document_version_v2(uuid,uuid,text,text,text,text,bigint,text,uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.link_document_to_sales_case(uuid,uuid,uuid,uuid) TO develocrm_app;

COMMIT;

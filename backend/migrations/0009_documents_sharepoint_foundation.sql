BEGIN;

CREATE TABLE sharepoint_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  entra_tenant_id uuid,
  site_id text,
  drive_id text,
  authentication_mode text NOT NULL DEFAULT 'managed_identity'
    CHECK (authentication_mode IN ('managed_identity','application','delegated')),
  credential_reference text,
  connection_status text NOT NULL DEFAULT 'not_configured'
    CHECK (connection_status IN ('not_configured','connected','error','disabled')),
  sync_status text NOT NULL DEFAULT 'idle'
    CHECK (sync_status IN ('idle','syncing','error','paused')),
  last_successful_sync_at timestamptz,
  last_sync_error text,
  created_by_membership_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT sharepoint_connections_creator_fk FOREIGN KEY (tenant_id,created_by_membership_id)
    REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT sharepoint_connections_tenant_pair_uq UNIQUE (tenant_id,id),
  CONSTRAINT sharepoint_connections_connected_shape CHECK (
    connection_status <> 'connected' OR (entra_tenant_id IS NOT NULL AND site_id IS NOT NULL AND drive_id IS NOT NULL)
  ),
  CONSTRAINT sharepoint_connections_secret_shape CHECK (
    credential_reference IS NULL OR credential_reference ~ '^(managed-identity|key-vault|environment)://'
  )
);
CREATE UNIQUE INDEX sharepoint_connections_drive_uq
  ON sharepoint_connections(tenant_id,site_id,drive_id) WHERE archived_at IS NULL AND drive_id IS NOT NULL;

CREATE TABLE document_sync_cursors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  scope_key text NOT NULL CHECK (length(btrim(scope_key)) BETWEEN 1 AND 240),
  encrypted_delta_token bytea NOT NULL,
  cursor_fingerprint text NOT NULL,
  encryption_key_version text NOT NULL,
  last_processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_sync_cursors_connection_fk FOREIGN KEY (tenant_id,connection_id)
    REFERENCES sharepoint_connections(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT document_sync_cursors_tenant_pair_uq UNIQUE (tenant_id,id),
  CONSTRAINT document_sync_cursor_scope_uq UNIQUE (tenant_id,connection_id,scope_key)
);

CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 260),
  category text NOT NULL CHECK (category ~ '^[a-z][a-z0-9_]{1,63}$'),
  mime_type text NOT NULL CHECK (position('/' IN mime_type) > 1),
  file_size bigint CHECK (file_size IS NULL OR file_size >= 0),
  storage_provider text NOT NULL CHECK (storage_provider IN ('sharepoint','preview','external')),
  external_drive_id text,
  external_item_id text,
  web_url text,
  etag text,
  sensitivity text NOT NULL DEFAULT 'normal' CHECK (sensitivity IN ('normal','sensitive')),
  created_by_membership_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by_membership_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT documents_project_fk FOREIGN KEY (tenant_id,project_id)
    REFERENCES projects(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT documents_creator_fk FOREIGN KEY (tenant_id,created_by_membership_id)
    REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT documents_updater_fk FOREIGN KEY (tenant_id,updated_by_membership_id)
    REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT documents_tenant_pair_uq UNIQUE (tenant_id,id),
  CONSTRAINT documents_project_pair_uq UNIQUE (tenant_id,project_id,id),
  CONSTRAINT documents_sharepoint_shape CHECK (
    storage_provider <> 'sharepoint' OR (external_drive_id IS NOT NULL AND external_item_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX documents_external_item_uq
  ON documents(tenant_id,storage_provider,external_drive_id,external_item_id)
  WHERE archived_at IS NULL AND external_item_id IS NOT NULL;
CREATE INDEX documents_project_category_idx ON documents(tenant_id,project_id,category,updated_at DESC);

CREATE TABLE document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  document_id uuid NOT NULL,
  version_identifier text NOT NULL CHECK (length(btrim(version_identifier)) BETWEEN 1 AND 160),
  external_version_id text,
  version_label text NOT NULL CHECK (length(btrim(version_label)) BETWEEN 1 AND 80),
  etag text,
  file_size bigint CHECK (file_size IS NULL OR file_size >= 0),
  content_hash text,
  created_by_membership_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_versions_document_fk FOREIGN KEY (tenant_id,project_id,document_id)
    REFERENCES documents(tenant_id,project_id,id) ON DELETE RESTRICT,
  CONSTRAINT document_versions_creator_fk FOREIGN KEY (tenant_id,created_by_membership_id)
    REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT document_versions_tenant_pair_uq UNIQUE (tenant_id,id),
  CONSTRAINT document_versions_document_pair_uq UNIQUE (tenant_id,project_id,document_id,id),
  CONSTRAINT document_version_identifier_uq UNIQUE (tenant_id,document_id,version_identifier)
);
CREATE UNIQUE INDEX document_versions_external_uq
  ON document_versions(tenant_id,document_id,external_version_id)
  WHERE external_version_id IS NOT NULL;
CREATE INDEX document_versions_history_idx ON document_versions(tenant_id,document_id,created_at DESC);

CREATE TABLE project_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL,
  document_id uuid NOT NULL, linked_by_membership_id uuid NOT NULL, linked_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_documents_project_fk FOREIGN KEY (tenant_id,project_id) REFERENCES projects(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT project_documents_document_fk FOREIGN KEY (tenant_id,project_id,document_id) REFERENCES documents(tenant_id,project_id,id) ON DELETE RESTRICT,
  CONSTRAINT project_documents_actor_fk FOREIGN KEY (tenant_id,linked_by_membership_id) REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT project_documents_tenant_pair_uq UNIQUE (tenant_id,id),
  CONSTRAINT project_document_link_uq UNIQUE (tenant_id,project_id,document_id)
);

CREATE TABLE unit_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL,
  unit_id uuid NOT NULL, document_id uuid NOT NULL, linked_by_membership_id uuid NOT NULL, linked_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unit_documents_unit_fk FOREIGN KEY (tenant_id,project_id,unit_id) REFERENCES units(tenant_id,project_id,id) ON DELETE RESTRICT,
  CONSTRAINT unit_documents_document_fk FOREIGN KEY (tenant_id,project_id,document_id) REFERENCES documents(tenant_id,project_id,id) ON DELETE RESTRICT,
  CONSTRAINT unit_documents_actor_fk FOREIGN KEY (tenant_id,linked_by_membership_id) REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT unit_documents_tenant_pair_uq UNIQUE (tenant_id,id),
  CONSTRAINT unit_document_link_uq UNIQUE (tenant_id,unit_id,document_id)
);

CREATE TABLE party_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL,
  party_id uuid NOT NULL, document_id uuid NOT NULL, linked_by_membership_id uuid NOT NULL, linked_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT party_documents_project_fk FOREIGN KEY (tenant_id,project_id) REFERENCES projects(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT party_documents_party_fk FOREIGN KEY (tenant_id,party_id) REFERENCES parties(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT party_documents_document_fk FOREIGN KEY (tenant_id,project_id,document_id) REFERENCES documents(tenant_id,project_id,id) ON DELETE RESTRICT,
  CONSTRAINT party_documents_actor_fk FOREIGN KEY (tenant_id,linked_by_membership_id) REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT party_documents_tenant_pair_uq UNIQUE (tenant_id,id),
  CONSTRAINT party_document_link_uq UNIQUE (tenant_id,project_id,party_id,document_id)
);

CREATE TABLE contract_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL,
  contract_id uuid NOT NULL, contract_version_id uuid, document_id uuid NOT NULL, document_version_id uuid,
  linked_by_membership_id uuid NOT NULL, linked_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contract_documents_contract_fk FOREIGN KEY (tenant_id,project_id,contract_id) REFERENCES contracts(tenant_id,project_id,id) ON DELETE RESTRICT,
  CONSTRAINT contract_documents_contract_version_fk FOREIGN KEY (tenant_id,project_id,contract_id,contract_version_id)
    REFERENCES contract_versions(tenant_id,project_id,contract_id,id) ON DELETE RESTRICT,
  CONSTRAINT contract_documents_document_fk FOREIGN KEY (tenant_id,project_id,document_id) REFERENCES documents(tenant_id,project_id,id) ON DELETE RESTRICT,
  CONSTRAINT contract_documents_document_version_fk FOREIGN KEY (tenant_id,project_id,document_id,document_version_id)
    REFERENCES document_versions(tenant_id,project_id,document_id,id) ON DELETE RESTRICT,
  CONSTRAINT contract_documents_actor_fk FOREIGN KEY (tenant_id,linked_by_membership_id) REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT contract_documents_tenant_pair_uq UNIQUE (tenant_id,id),
  CONSTRAINT contract_document_version_shape CHECK (document_version_id IS NULL OR contract_version_id IS NOT NULL)
);
CREATE UNIQUE INDEX contract_documents_contract_level_uq
  ON contract_documents(tenant_id,contract_id,document_id) WHERE contract_version_id IS NULL;
CREATE UNIQUE INDEX contract_documents_version_level_uq
  ON contract_documents(tenant_id,contract_version_id,document_id) WHERE contract_version_id IS NOT NULL;

CREATE TRIGGER sharepoint_connections_touch_updated_at BEFORE UPDATE ON sharepoint_connections FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER document_sync_cursors_touch_updated_at BEFORE UPDATE ON document_sync_cursors FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER documents_touch_updated_at BEFORE UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER document_versions_append_only BEFORE UPDATE OR DELETE ON document_versions FOR EACH ROW EXECUTE FUNCTION app.reject_append_only();

CREATE OR REPLACE FUNCTION app.create_document_metadata(
  p_tenant uuid,p_project uuid,p_name text,p_category text,p_mime_type text,p_file_size bigint,
  p_storage_provider text,p_external_drive_id text,p_external_item_id text,p_web_url text,p_etag text,
  p_sensitivity text,p_actor_membership uuid,p_operation text DEFAULT 'import'
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app AS $$
DECLARE actor_user uuid; document_id uuid:=gen_random_uuid();
BEGIN
  IF p_operation NOT IN ('upload','import','sync') THEN RAISE EXCEPTION 'unsupported document operation'; END IF;
  SELECT user_id INTO actor_user FROM public.tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF actor_user IS NULL OR NOT app.has_project_permission(p_tenant,p_actor_membership,p_project,'documents.upload') THEN RAISE EXCEPTION 'documents.upload permission required'; END IF;
  INSERT INTO public.documents(id,tenant_id,project_id,name,category,mime_type,file_size,storage_provider,external_drive_id,external_item_id,web_url,etag,sensitivity,created_by_membership_id)
  VALUES(document_id,p_tenant,p_project,p_name,p_category,p_mime_type,p_file_size,p_storage_provider,p_external_drive_id,p_external_item_id,p_web_url,p_etag,COALESCE(p_sensitivity,'normal'),p_actor_membership);
  INSERT INTO public.audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data,metadata)
  VALUES(p_tenant,actor_user,'document.created','document',document_id,jsonb_build_object('projectId',p_project,'name',p_name,'category',p_category,'storageProvider',p_storage_provider),jsonb_build_object('operation',p_operation));
  INSERT INTO public.outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'document',document_id,'document.created',jsonb_build_object('schemaVersion',1,'documentId',document_id,'projectId',p_project,'operation',p_operation));
  RETURN document_id;
END $$;

CREATE OR REPLACE FUNCTION app.update_document_metadata(
  p_tenant uuid,p_document uuid,p_name text,p_category text,p_web_url text,p_etag text,p_file_size bigint,p_actor_membership uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app AS $$
DECLARE project uuid; actor_user uuid; before_row jsonb; after_row jsonb;
BEGIN
  SELECT project_id,to_jsonb(document) INTO project,before_row FROM public.documents document WHERE tenant_id=p_tenant AND id=p_document AND archived_at IS NULL FOR UPDATE;
  SELECT user_id INTO actor_user FROM public.tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF project IS NULL OR actor_user IS NULL OR NOT app.has_project_permission(p_tenant,p_actor_membership,project,'documents.edit_metadata') THEN RAISE EXCEPTION 'documents.edit_metadata permission required'; END IF;
  UPDATE public.documents SET name=p_name,category=p_category,web_url=p_web_url,etag=p_etag,file_size=p_file_size,updated_by_membership_id=p_actor_membership
  WHERE tenant_id=p_tenant AND id=p_document RETURNING to_jsonb(documents) INTO after_row;
  INSERT INTO public.audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data)
  VALUES(p_tenant,actor_user,'document.updated','document',p_document,before_row,after_row);
  INSERT INTO public.outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'document',p_document,'document.updated',jsonb_build_object('schemaVersion',1,'documentId',p_document,'projectId',project));
  RETURN p_document;
END $$;

CREATE OR REPLACE FUNCTION app.create_document_version(
  p_tenant uuid,p_document uuid,p_version_identifier text,p_external_version_id text,p_version_label text,
  p_etag text,p_file_size bigint,p_content_hash text,p_actor_membership uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app AS $$
DECLARE project uuid; actor_user uuid; version_id uuid:=gen_random_uuid();
BEGIN
  SELECT project_id INTO project FROM public.documents WHERE tenant_id=p_tenant AND id=p_document AND archived_at IS NULL FOR UPDATE;
  SELECT user_id INTO actor_user FROM public.tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF project IS NULL OR actor_user IS NULL OR NOT app.has_project_permission(p_tenant,p_actor_membership,project,'documents.upload') THEN RAISE EXCEPTION 'documents.upload permission required'; END IF;
  INSERT INTO public.document_versions(id,tenant_id,project_id,document_id,version_identifier,external_version_id,version_label,etag,file_size,content_hash,created_by_membership_id)
  VALUES(version_id,p_tenant,project,p_document,p_version_identifier,p_external_version_id,p_version_label,p_etag,p_file_size,p_content_hash,p_actor_membership);
  UPDATE public.documents SET etag=COALESCE(p_etag,etag),file_size=COALESCE(p_file_size,file_size),updated_by_membership_id=p_actor_membership WHERE tenant_id=p_tenant AND id=p_document;
  INSERT INTO public.audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data,metadata)
  VALUES(p_tenant,actor_user,'document.version_created','document_version',version_id,jsonb_build_object('documentId',p_document,'versionLabel',p_version_label),jsonb_build_object('projectId',project));
  INSERT INTO public.outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'document',p_document,'document.version_created',jsonb_build_object('schemaVersion',1,'documentId',p_document,'versionId',version_id,'projectId',project));
  RETURN version_id;
END $$;

CREATE OR REPLACE FUNCTION app.archive_document(
  p_tenant uuid,p_document uuid,p_actor_membership uuid,p_reason text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app AS $$
DECLARE project uuid; actor_user uuid; before_row jsonb; after_row jsonb;
BEGIN
  IF length(btrim(p_reason))<3 THEN RAISE EXCEPTION 'archive reason is required'; END IF;
  SELECT project_id,to_jsonb(document) INTO project,before_row FROM public.documents document WHERE tenant_id=p_tenant AND id=p_document AND archived_at IS NULL FOR UPDATE;
  SELECT user_id INTO actor_user FROM public.tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF project IS NULL OR actor_user IS NULL OR NOT app.has_project_permission(p_tenant,p_actor_membership,project,'documents.archive') THEN RAISE EXCEPTION 'documents.archive permission required'; END IF;
  UPDATE public.documents SET archived_at=now(),updated_by_membership_id=p_actor_membership WHERE tenant_id=p_tenant AND id=p_document RETURNING to_jsonb(documents) INTO after_row;
  INSERT INTO public.audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data,metadata)
  VALUES(p_tenant,actor_user,'document.archived','document',p_document,before_row,after_row,jsonb_build_object('reason',p_reason));
  INSERT INTO public.outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'document',p_document,'document.archived',jsonb_build_object('schemaVersion',1,'documentId',p_document,'projectId',project,'reason',p_reason));
  RETURN p_document;
END $$;

CREATE OR REPLACE FUNCTION app.link_document_to_project(p_tenant uuid,p_document uuid,p_project uuid,p_actor_membership uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app AS $$
DECLARE security_project uuid; actor_user uuid; link_id uuid:=gen_random_uuid();
BEGIN
  SELECT project_id INTO security_project FROM public.documents WHERE tenant_id=p_tenant AND id=p_document AND archived_at IS NULL;
  SELECT user_id INTO actor_user FROM public.tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF security_project IS NULL OR security_project<>p_project OR actor_user IS NULL OR NOT app.has_project_permission(p_tenant,p_actor_membership,p_project,'documents.manage') THEN RAISE EXCEPTION 'documents.manage permission required for the security project'; END IF;
  INSERT INTO public.project_documents(id,tenant_id,project_id,document_id,linked_by_membership_id) VALUES(link_id,p_tenant,p_project,p_document,p_actor_membership);
  INSERT INTO public.audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data,metadata)
  VALUES(p_tenant,actor_user,'document.linked','project_document',link_id,jsonb_build_object('documentId',p_document,'projectId',p_project),jsonb_build_object('projectId',p_project));
  INSERT INTO public.outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'document',p_document,'document.linked',jsonb_build_object('schemaVersion',1,'documentId',p_document,'linkType','project','projectId',p_project));
  RETURN link_id;
END $$;

CREATE OR REPLACE FUNCTION app.link_document_to_unit(p_tenant uuid,p_document uuid,p_unit uuid,p_actor_membership uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app AS $$
DECLARE project uuid; actor_user uuid; link_id uuid:=gen_random_uuid();
BEGIN
  SELECT document.project_id INTO project FROM public.documents document JOIN public.units unit ON unit.tenant_id=document.tenant_id AND unit.project_id=document.project_id AND unit.id=p_unit WHERE document.tenant_id=p_tenant AND document.id=p_document AND document.archived_at IS NULL;
  SELECT user_id INTO actor_user FROM public.tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF project IS NULL OR actor_user IS NULL OR NOT app.has_project_permission(p_tenant,p_actor_membership,project,'documents.manage') THEN RAISE EXCEPTION 'documents.manage permission required'; END IF;
  INSERT INTO public.unit_documents(id,tenant_id,project_id,unit_id,document_id,linked_by_membership_id) VALUES(link_id,p_tenant,project,p_unit,p_document,p_actor_membership);
  INSERT INTO public.audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data,metadata)
  VALUES(p_tenant,actor_user,'document.linked','unit_document',link_id,jsonb_build_object('documentId',p_document,'unitId',p_unit),jsonb_build_object('projectId',project));
  INSERT INTO public.outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'document',p_document,'document.linked',jsonb_build_object('schemaVersion',1,'documentId',p_document,'linkType','unit','linkId',p_unit,'projectId',project));
  RETURN link_id;
END $$;

CREATE OR REPLACE FUNCTION app.link_document_to_party(p_tenant uuid,p_document uuid,p_party uuid,p_actor_membership uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app AS $$
DECLARE project uuid; actor_user uuid; link_id uuid:=gen_random_uuid();
BEGIN
  SELECT document.project_id INTO project FROM public.documents document JOIN public.parties party ON party.tenant_id=document.tenant_id AND party.id=p_party WHERE document.tenant_id=p_tenant AND document.id=p_document AND document.archived_at IS NULL;
  SELECT user_id INTO actor_user FROM public.tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF project IS NULL OR actor_user IS NULL OR NOT app.has_project_permission(p_tenant,p_actor_membership,project,'documents.manage') THEN RAISE EXCEPTION 'documents.manage permission required'; END IF;
  INSERT INTO public.party_documents(id,tenant_id,project_id,party_id,document_id,linked_by_membership_id) VALUES(link_id,p_tenant,project,p_party,p_document,p_actor_membership);
  INSERT INTO public.audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data,metadata)
  VALUES(p_tenant,actor_user,'document.linked','party_document',link_id,jsonb_build_object('documentId',p_document,'partyId',p_party),jsonb_build_object('projectId',project));
  INSERT INTO public.outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'document',p_document,'document.linked',jsonb_build_object('schemaVersion',1,'documentId',p_document,'linkType','party','linkId',p_party,'projectId',project));
  RETURN link_id;
END $$;

CREATE OR REPLACE FUNCTION app.link_document_to_contract(
  p_tenant uuid,p_document uuid,p_contract uuid,p_contract_version uuid,p_document_version uuid,p_actor_membership uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app AS $$
DECLARE project uuid; actor_user uuid; link_id uuid:=gen_random_uuid();
BEGIN
  SELECT document.project_id INTO project FROM public.documents document JOIN public.contracts contract ON contract.tenant_id=document.tenant_id AND contract.project_id=document.project_id AND contract.id=p_contract WHERE document.tenant_id=p_tenant AND document.id=p_document AND document.archived_at IS NULL;
  SELECT user_id INTO actor_user FROM public.tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF project IS NULL OR actor_user IS NULL OR NOT app.has_project_permission(p_tenant,p_actor_membership,project,'documents.manage') THEN RAISE EXCEPTION 'documents.manage permission required'; END IF;
  INSERT INTO public.contract_documents(id,tenant_id,project_id,contract_id,contract_version_id,document_id,document_version_id,linked_by_membership_id)
  VALUES(link_id,p_tenant,project,p_contract,p_contract_version,p_document,p_document_version,p_actor_membership);
  INSERT INTO public.audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data,metadata)
  VALUES(p_tenant,actor_user,'document.linked','contract_document',link_id,jsonb_build_object('documentId',p_document,'contractId',p_contract,'contractVersionId',p_contract_version,'documentVersionId',p_document_version),jsonb_build_object('projectId',project));
  INSERT INTO public.outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'document',p_document,'document.linked',jsonb_build_object('schemaVersion',1,'documentId',p_document,'linkType','contract','linkId',p_contract,'contractVersionId',p_contract_version,'documentVersionId',p_document_version,'projectId',project));
  RETURN link_id;
END $$;

INSERT INTO permissions(code,description) VALUES
 ('documents.view','Zobrazit metadata a odkazy dokumentů'),
 ('documents.upload','Importovat nebo nahrát dokument do připojeného úložiště'),
 ('documents.edit_metadata','Upravovat metadata dokumentů'),
 ('documents.archive','Archivovat dokumenty bez ztráty historie'),
 ('documents.manage','Spravovat vazby a připojení dokumentů'),
 ('documents.view_sensitive','Zobrazit citlivé klientské a smluvní dokumenty')
ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(tenant_id,role_id,permission_id)
SELECT role.tenant_id,role.id,permission.id FROM roles role CROSS JOIN permissions permission WHERE role.code='admin' ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(tenant_id,role_id,permission_id)
SELECT role.tenant_id,role.id,permission.id FROM roles role JOIN permissions permission ON permission.code IN
 ('documents.view','documents.upload','documents.edit_metadata','documents.archive','documents.manage','documents.view_sensitive')
WHERE role.code IN ('project_manager','back_office') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(tenant_id,role_id,permission_id)
SELECT role.tenant_id,role.id,permission.id FROM roles role JOIN permissions permission ON permission.code IN ('documents.view','documents.upload')
WHERE role.code='sales' ON CONFLICT DO NOTHING;

DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'sharepoint_connections','document_sync_cursors','documents','document_versions',
    'project_documents','unit_documents','party_documents','contract_documents'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('CREATE POLICY %I ON %I USING (tenant_id=app.current_tenant_id()) WITH CHECK (tenant_id=app.current_tenant_id())',table_name||'_tenant_policy',table_name);
  END LOOP;
END $$;

GRANT SELECT ON sharepoint_connections,document_sync_cursors,documents,document_versions,project_documents,unit_documents,party_documents,contract_documents TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.create_document_metadata(uuid,uuid,text,text,text,bigint,text,text,text,text,text,text,uuid,text) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.update_document_metadata(uuid,uuid,text,text,text,text,bigint,uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.create_document_version(uuid,uuid,text,text,text,text,bigint,text,uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.archive_document(uuid,uuid,uuid,text) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.link_document_to_project(uuid,uuid,uuid,uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.link_document_to_unit(uuid,uuid,uuid,uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.link_document_to_party(uuid,uuid,uuid,uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.link_document_to_contract(uuid,uuid,uuid,uuid,uuid,uuid) TO develocrm_app;

COMMIT;

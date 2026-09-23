BEGIN;

CREATE TABLE client_change_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL,
  client_change_id uuid NOT NULL, document_id uuid NOT NULL, linked_by_membership_id uuid NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_change_documents_change_fk FOREIGN KEY (tenant_id,client_change_id) REFERENCES client_changes(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT client_change_documents_document_fk FOREIGN KEY (tenant_id,project_id,document_id) REFERENCES documents(tenant_id,project_id,id) ON DELETE RESTRICT,
  CONSTRAINT client_change_documents_actor_fk FOREIGN KEY (tenant_id,linked_by_membership_id) REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT client_change_documents_tenant_pair_uq UNIQUE (tenant_id,id),
  CONSTRAINT client_change_document_link_uq UNIQUE (tenant_id,client_change_id,document_id)
);

CREATE TABLE complaint_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL,
  complaint_id uuid NOT NULL, document_id uuid NOT NULL, linked_by_membership_id uuid NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT complaint_documents_complaint_fk FOREIGN KEY (tenant_id,complaint_id) REFERENCES complaints(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT complaint_documents_document_fk FOREIGN KEY (tenant_id,project_id,document_id) REFERENCES documents(tenant_id,project_id,id) ON DELETE RESTRICT,
  CONSTRAINT complaint_documents_actor_fk FOREIGN KEY (tenant_id,linked_by_membership_id) REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT complaint_documents_tenant_pair_uq UNIQUE (tenant_id,id),
  CONSTRAINT complaint_document_link_uq UNIQUE (tenant_id,complaint_id,document_id)
);

CREATE TABLE handover_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL,
  handover_id uuid NOT NULL, document_id uuid NOT NULL, linked_by_membership_id uuid NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT handover_documents_handover_fk FOREIGN KEY (tenant_id,handover_id) REFERENCES unit_handovers(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT handover_documents_document_fk FOREIGN KEY (tenant_id,project_id,document_id) REFERENCES documents(tenant_id,project_id,id) ON DELETE RESTRICT,
  CONSTRAINT handover_documents_actor_fk FOREIGN KEY (tenant_id,linked_by_membership_id) REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT handover_documents_tenant_pair_uq UNIQUE (tenant_id,id),
  CONSTRAINT handover_document_link_uq UNIQUE (tenant_id,handover_id,document_id)
);

DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['client_change_documents','complaint_documents','handover_documents'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('CREATE POLICY %I ON %I USING (tenant_id=app.current_tenant_id()) WITH CHECK (tenant_id=app.current_tenant_id())',table_name||'_tenant_policy',table_name);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION app.link_document_to_client_change(
  p_tenant uuid,p_document uuid,p_client_change uuid,p_actor_membership uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app AS $$
DECLARE project uuid;actor_user uuid;link_id uuid;
BEGIN
  SELECT document.project_id INTO project FROM documents document
    JOIN client_changes client_change ON client_change.tenant_id=document.tenant_id AND client_change.project_id=document.project_id AND client_change.id=p_client_change
    WHERE document.tenant_id=p_tenant AND document.id=p_document AND document.archived_at IS NULL AND client_change.archived_at IS NULL;
  SELECT user_id INTO actor_user FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF project IS NULL OR actor_user IS NULL OR NOT app.has_project_permission(p_tenant,p_actor_membership,project,'documents.manage')
    THEN RAISE EXCEPTION 'documents.manage permission required';END IF;
  SELECT id INTO link_id FROM client_change_documents WHERE tenant_id=p_tenant AND client_change_id=p_client_change AND document_id=p_document;
  IF link_id IS NOT NULL THEN RETURN link_id;END IF;
  INSERT INTO client_change_documents(tenant_id,project_id,client_change_id,document_id,linked_by_membership_id)
  VALUES(p_tenant,project,p_client_change,p_document,p_actor_membership) RETURNING id INTO link_id;
  INSERT INTO document_events(tenant_id,project_id,document_id,event_type,title,actor_membership_id,details)
  VALUES(p_tenant,project,p_document,'linked','Dokument navázán na klientskou změnu',p_actor_membership,jsonb_build_object('clientChangeId',p_client_change));
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data)
  VALUES(p_tenant,actor_user,'document.linked','client_change_document',link_id,jsonb_build_object('documentId',p_document,'clientChangeId',p_client_change));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'document',p_document,'document.linked',jsonb_build_object('schemaVersion',2,'documentId',p_document,'linkType','client_change','linkId',p_client_change,'projectId',project));
  RETURN link_id;
END $$;

CREATE OR REPLACE FUNCTION app.link_document_to_complaint(
  p_tenant uuid,p_document uuid,p_complaint uuid,p_actor_membership uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app AS $$
DECLARE project uuid;actor_user uuid;link_id uuid;
BEGIN
  SELECT document.project_id INTO project FROM documents document
    JOIN complaints complaint ON complaint.tenant_id=document.tenant_id AND complaint.project_id=document.project_id AND complaint.id=p_complaint
    WHERE document.tenant_id=p_tenant AND document.id=p_document AND document.archived_at IS NULL;
  SELECT user_id INTO actor_user FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF project IS NULL OR actor_user IS NULL OR NOT app.has_project_permission(p_tenant,p_actor_membership,project,'documents.manage')
    THEN RAISE EXCEPTION 'documents.manage permission required';END IF;
  SELECT id INTO link_id FROM complaint_documents WHERE tenant_id=p_tenant AND complaint_id=p_complaint AND document_id=p_document;
  IF link_id IS NOT NULL THEN RETURN link_id;END IF;
  INSERT INTO complaint_documents(tenant_id,project_id,complaint_id,document_id,linked_by_membership_id)
  VALUES(p_tenant,project,p_complaint,p_document,p_actor_membership) RETURNING id INTO link_id;
  INSERT INTO document_events(tenant_id,project_id,document_id,event_type,title,actor_membership_id,details)
  VALUES(p_tenant,project,p_document,'linked','Dokument navázán na reklamaci',p_actor_membership,jsonb_build_object('complaintId',p_complaint));
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data)
  VALUES(p_tenant,actor_user,'document.linked','complaint_document',link_id,jsonb_build_object('documentId',p_document,'complaintId',p_complaint));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'document',p_document,'document.linked',jsonb_build_object('schemaVersion',2,'documentId',p_document,'linkType','complaint','linkId',p_complaint,'projectId',project));
  RETURN link_id;
END $$;

CREATE OR REPLACE FUNCTION app.link_document_to_handover(
  p_tenant uuid,p_document uuid,p_handover uuid,p_actor_membership uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app AS $$
DECLARE project uuid;actor_user uuid;link_id uuid;
BEGIN
  SELECT document.project_id INTO project FROM documents document
    JOIN unit_handovers handover ON handover.tenant_id=document.tenant_id AND handover.project_id=document.project_id AND handover.id=p_handover
    WHERE document.tenant_id=p_tenant AND document.id=p_document AND document.archived_at IS NULL;
  SELECT user_id INTO actor_user FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF project IS NULL OR actor_user IS NULL OR NOT app.has_project_permission(p_tenant,p_actor_membership,project,'documents.manage')
    THEN RAISE EXCEPTION 'documents.manage permission required';END IF;
  SELECT id INTO link_id FROM handover_documents WHERE tenant_id=p_tenant AND handover_id=p_handover AND document_id=p_document;
  IF link_id IS NOT NULL THEN RETURN link_id;END IF;
  INSERT INTO handover_documents(tenant_id,project_id,handover_id,document_id,linked_by_membership_id)
  VALUES(p_tenant,project,p_handover,p_document,p_actor_membership) RETURNING id INTO link_id;
  INSERT INTO document_events(tenant_id,project_id,document_id,event_type,title,actor_membership_id,details)
  VALUES(p_tenant,project,p_document,'linked','Dokument navázán na předání',p_actor_membership,jsonb_build_object('handoverId',p_handover));
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data)
  VALUES(p_tenant,actor_user,'document.linked','handover_document',link_id,jsonb_build_object('documentId',p_document,'handoverId',p_handover));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'document',p_document,'document.linked',jsonb_build_object('schemaVersion',2,'documentId',p_document,'linkType','handover','linkId',p_handover,'projectId',project));
  RETURN link_id;
END $$;

GRANT SELECT,INSERT ON client_change_documents,complaint_documents,handover_documents TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.link_document_to_client_change(uuid,uuid,uuid,uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.link_document_to_complaint(uuid,uuid,uuid,uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.link_document_to_handover(uuid,uuid,uuid,uuid) TO develocrm_app;

COMMIT;

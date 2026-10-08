BEGIN;

CREATE TABLE document_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL,
  code text NOT NULL CHECK(code~'^[a-z0-9][a-z0-9_-]{2,79}$'), name text NOT NULL CHECK(length(btrim(name)) BETWEEN 2 AND 180),
  output_type_code text NOT NULL, status text NOT NULL DEFAULT 'active' CHECK(status IN('active','archived')),
  created_by_membership_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_templates_project_fk FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT document_templates_actor_fk FOREIGN KEY(tenant_id,created_by_membership_id) REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT document_templates_type_fk FOREIGN KEY(tenant_id,output_type_code) REFERENCES document_types(tenant_id,code) ON DELETE RESTRICT,
  CONSTRAINT document_templates_tenant_pair_uq UNIQUE(tenant_id,id), CONSTRAINT document_templates_code_uq UNIQUE(tenant_id,project_id,code)
);
CREATE TRIGGER document_templates_touch_updated_at BEFORE UPDATE ON document_templates FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE document_template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL, template_id uuid NOT NULL,
  source_document_id uuid NOT NULL, source_document_version_id uuid NOT NULL, version_label text NOT NULL CHECK(length(btrim(version_label)) BETWEEN 1 AND 80),
  content_hash text NOT NULL CHECK(content_hash~'^sha256:[a-f0-9]{64}$'), placeholder_schema jsonb NOT NULL,
  created_by_membership_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_template_versions_template_fk FOREIGN KEY(tenant_id,template_id) REFERENCES document_templates(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT document_template_versions_source_document_fk FOREIGN KEY(tenant_id,project_id,source_document_id) REFERENCES documents(tenant_id,project_id,id) ON DELETE RESTRICT,
  CONSTRAINT document_template_versions_source_version_fk FOREIGN KEY(tenant_id,project_id,source_document_id,source_document_version_id) REFERENCES document_versions(tenant_id,project_id,document_id,id) ON DELETE RESTRICT,
  CONSTRAINT document_template_versions_actor_fk FOREIGN KEY(tenant_id,created_by_membership_id) REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT document_template_versions_tenant_pair_uq UNIQUE(tenant_id,id), CONSTRAINT document_template_versions_label_uq UNIQUE(tenant_id,template_id,version_label),
  CONSTRAINT document_template_versions_schema_shape CHECK(jsonb_typeof(placeholder_schema)='object' AND jsonb_typeof(placeholder_schema->'fields')='object')
);

CREATE TABLE document_generation_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK(length(btrim(idempotency_key)) BETWEEN 8 AND 160), request_hash text NOT NULL CHECK(request_hash~'^[a-f0-9]{64}$'),
  template_version_id uuid NOT NULL, unit_id uuid, party_id uuid, sales_case_id uuid, contract_id uuid,
  output_document_id uuid, output_document_version_id uuid, generation_snapshot jsonb NOT NULL, snapshot_hash text NOT NULL CHECK(snapshot_hash~'^[a-f0-9]{64}$'),
  rendered_content_hash text, state text NOT NULL DEFAULT 'reserved' CHECK(state IN('reserved','completed')),
  created_by_membership_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  CONSTRAINT document_generation_project_fk FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT document_generation_template_fk FOREIGN KEY(tenant_id,template_version_id) REFERENCES document_template_versions(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT document_generation_unit_fk FOREIGN KEY(tenant_id,project_id,unit_id) REFERENCES units(tenant_id,project_id,id) ON DELETE RESTRICT,
  CONSTRAINT document_generation_party_fk FOREIGN KEY(tenant_id,party_id) REFERENCES parties(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT document_generation_case_fk FOREIGN KEY(tenant_id,project_id,sales_case_id) REFERENCES sales_cases(tenant_id,project_id,id) ON DELETE RESTRICT,
  CONSTRAINT document_generation_contract_fk FOREIGN KEY(tenant_id,project_id,contract_id) REFERENCES contracts(tenant_id,project_id,id) ON DELETE RESTRICT,
  CONSTRAINT document_generation_output_document_fk FOREIGN KEY(tenant_id,project_id,output_document_id) REFERENCES documents(tenant_id,project_id,id) ON DELETE RESTRICT,
  CONSTRAINT document_generation_output_version_fk FOREIGN KEY(tenant_id,project_id,output_document_id,output_document_version_id) REFERENCES document_versions(tenant_id,project_id,document_id,id) ON DELETE RESTRICT,
  CONSTRAINT document_generation_actor_fk FOREIGN KEY(tenant_id,created_by_membership_id) REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT document_generation_tenant_pair_uq UNIQUE(tenant_id,id), CONSTRAINT document_generation_idempotency_uq UNIQUE(tenant_id,idempotency_key)
);

CREATE OR REPLACE FUNCTION app.reject_immutable_document_generation_row() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'immutable document generation record'; END $$;
CREATE TRIGGER document_template_versions_append_only BEFORE UPDATE OR DELETE ON document_template_versions FOR EACH ROW EXECUTE FUNCTION app.reject_immutable_document_generation_row();
CREATE OR REPLACE FUNCTION app.protect_document_generation_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF ROW(OLD.tenant_id,OLD.project_id,OLD.idempotency_key,OLD.request_hash,OLD.template_version_id,OLD.unit_id,OLD.party_id,OLD.sales_case_id,OLD.contract_id,
      OLD.generation_snapshot,OLD.snapshot_hash,OLD.created_by_membership_id,OLD.created_at)
    IS DISTINCT FROM ROW(NEW.tenant_id,NEW.project_id,NEW.idempotency_key,NEW.request_hash,NEW.template_version_id,NEW.unit_id,NEW.party_id,NEW.sales_case_id,NEW.contract_id,
      NEW.generation_snapshot,NEW.snapshot_hash,NEW.created_by_membership_id,NEW.created_at) THEN
    RAISE EXCEPTION 'immutable document generation snapshot';
  END IF;
  IF OLD.state='completed' THEN RAISE EXCEPTION 'completed document generation is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER document_generation_snapshot_immutable BEFORE UPDATE ON document_generation_operations FOR EACH ROW EXECUTE FUNCTION app.protect_document_generation_snapshot();

ALTER TABLE document_templates ENABLE ROW LEVEL SECURITY; ALTER TABLE document_templates FORCE ROW LEVEL SECURITY;
ALTER TABLE document_template_versions ENABLE ROW LEVEL SECURITY; ALTER TABLE document_template_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE document_generation_operations ENABLE ROW LEVEL SECURITY; ALTER TABLE document_generation_operations FORCE ROW LEVEL SECURITY;
CREATE POLICY document_templates_tenant_policy ON document_templates USING(tenant_id=app.current_tenant_id()) WITH CHECK(tenant_id=app.current_tenant_id());
CREATE POLICY document_template_versions_tenant_policy ON document_template_versions USING(tenant_id=app.current_tenant_id()) WITH CHECK(tenant_id=app.current_tenant_id());
CREATE POLICY document_generation_operations_tenant_policy ON document_generation_operations USING(tenant_id=app.current_tenant_id()) WITH CHECK(tenant_id=app.current_tenant_id());

GRANT SELECT,INSERT,UPDATE ON document_templates TO develocrm_app;
GRANT SELECT,INSERT ON document_template_versions TO develocrm_app;
GRANT SELECT,INSERT,UPDATE ON document_generation_operations TO develocrm_app;

COMMIT;

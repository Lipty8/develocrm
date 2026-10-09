BEGIN;

CREATE TABLE project_contract_settings (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  seller_name text NOT NULL,
  seller_registration_number text NOT NULL,
  seller_address text NOT NULL,
  seller_registry_entry text NOT NULL,
  seller_representative text NOT NULL,
  seller_email text NOT NULL,
  seller_data_box text NOT NULL,
  seller_bank_account text NOT NULL,
  seller_bank_name text NOT NULL,
  reservation_period_days integer NOT NULL DEFAULT 30 CHECK(reservation_period_days BETWEEN 1 AND 180),
  created_by_membership_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,project_id),
  CONSTRAINT project_contract_settings_project_fk FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT project_contract_settings_actor_fk FOREIGN KEY(tenant_id,created_by_membership_id) REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT
);
CREATE TRIGGER project_contract_settings_touch BEFORE UPDATE ON project_contract_settings FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE document_templates ADD COLUMN contract_type text;
ALTER TABLE document_templates ADD CONSTRAINT document_templates_contract_type_check CHECK(contract_type IS NULL OR contract_type IN('rs','sbk','ks'));
CREATE UNIQUE INDEX document_templates_contract_type_uq ON document_templates(tenant_id,project_id,contract_type) WHERE contract_type IS NOT NULL AND status='active';

DROP TRIGGER document_template_versions_append_only ON document_template_versions;
ALTER TABLE document_template_versions
  ADD COLUMN approval_status text,
  ADD COLUMN effective_from date,
  ADD COLUMN approved_at timestamptz,
  ADD COLUMN approved_by_membership_id uuid;
UPDATE document_template_versions SET approval_status='approved',effective_from=created_at::date,approved_at=created_at,approved_by_membership_id=created_by_membership_id;
ALTER TABLE document_template_versions
  ALTER COLUMN approval_status SET NOT NULL,
  ALTER COLUMN approval_status SET DEFAULT 'draft',
  ALTER COLUMN effective_from SET NOT NULL,
  ALTER COLUMN effective_from SET DEFAULT CURRENT_DATE;
ALTER TABLE document_template_versions ADD CONSTRAINT document_template_versions_approval_status_check CHECK(approval_status IN('draft','approved','retired'));
ALTER TABLE document_template_versions ADD CONSTRAINT document_template_versions_approver_fk
  FOREIGN KEY(tenant_id,approved_by_membership_id) REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT;
ALTER TABLE document_template_versions ADD CONSTRAINT document_template_versions_approval_shape CHECK(
  (approval_status='approved' AND approved_at IS NOT NULL AND approved_by_membership_id IS NOT NULL)
  OR
  (approval_status<>'approved' AND approved_at IS NULL AND approved_by_membership_id IS NULL)
);
CREATE TRIGGER document_template_versions_append_only BEFORE UPDATE OR DELETE ON document_template_versions FOR EACH ROW EXECUTE FUNCTION app.reject_immutable_document_generation_row();

ALTER TABLE contract_versions
  ADD COLUMN document_id uuid,
  ADD COLUMN document_version_id uuid,
  ADD COLUMN template_version_id uuid,
  ADD COLUMN generation_operation_id uuid;
ALTER TABLE contract_versions ADD CONSTRAINT contract_versions_document_fk
  FOREIGN KEY(tenant_id,project_id,document_id) REFERENCES documents(tenant_id,project_id,id) ON DELETE RESTRICT;
ALTER TABLE contract_versions ADD CONSTRAINT contract_versions_document_version_fk
  FOREIGN KEY(tenant_id,project_id,document_id,document_version_id) REFERENCES document_versions(tenant_id,project_id,document_id,id) ON DELETE RESTRICT;
ALTER TABLE contract_versions ADD CONSTRAINT contract_versions_template_version_fk
  FOREIGN KEY(tenant_id,template_version_id) REFERENCES document_template_versions(tenant_id,id) ON DELETE RESTRICT;
ALTER TABLE contract_versions ADD CONSTRAINT contract_versions_generation_operation_fk
  FOREIGN KEY(tenant_id,generation_operation_id) REFERENCES document_generation_operations(tenant_id,id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX contract_versions_generation_operation_uq ON contract_versions(tenant_id,generation_operation_id) WHERE generation_operation_id IS NOT NULL;
ALTER TABLE contract_versions ADD CONSTRAINT contract_versions_generated_document_shape CHECK(
  (document_id IS NULL AND document_version_id IS NULL AND template_version_id IS NULL AND generation_operation_id IS NULL)
  OR
  (source_type='generated' AND document_id IS NOT NULL AND document_version_id IS NOT NULL AND template_version_id IS NOT NULL AND generation_operation_id IS NOT NULL)
);

ALTER TABLE project_contract_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_contract_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY project_contract_settings_tenant_policy ON project_contract_settings
  USING(tenant_id=app.current_tenant_id()) WITH CHECK(tenant_id=app.current_tenant_id());

GRANT SELECT,INSERT,UPDATE ON project_contract_settings TO develocrm_app;

COMMIT;

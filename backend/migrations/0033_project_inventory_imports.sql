BEGIN;

CREATE TABLE project_inventory_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN ('unit','cellar','parking')),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 8 AND 180),
  file_name text,
  strategy text NOT NULL CHECK (strategy IN ('update','skip')),
  source_rows integer NOT NULL CHECK (source_rows >= 0),
  created_count integer NOT NULL DEFAULT 0 CHECK (created_count >= 0),
  updated_count integer NOT NULL DEFAULT 0 CHECK (updated_count >= 0),
  skipped_count integer NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_by_membership_id uuid NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_inventory_import_project_fk FOREIGN KEY (tenant_id, project_id)
    REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT project_inventory_import_actor_fk FOREIGN KEY (tenant_id, imported_by_membership_id)
    REFERENCES tenant_memberships(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT project_inventory_import_tenant_pair_uq UNIQUE (tenant_id, id),
  CONSTRAINT project_inventory_import_idempotency_uq UNIQUE (tenant_id, project_id, idempotency_key)
);

ALTER TABLE project_inventory_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_inventory_import_batches FORCE ROW LEVEL SECURITY;
CREATE POLICY project_inventory_import_batches_tenant_policy ON project_inventory_import_batches
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

GRANT SELECT, INSERT ON project_inventory_import_batches TO develocrm_app;

COMMIT;

BEGIN;

CREATE TABLE media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  unit_id uuid,
  entity_type text NOT NULL CHECK (entity_type IN ('project', 'unit')),
  entity_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('cover', 'floorplan')),
  storage_key text NOT NULL CHECK (length(btrim(storage_key)) BETWEEN 1 AND 1024),
  file_name text NOT NULL CHECK (length(btrim(file_name)) BETWEEN 1 AND 512),
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  uploaded_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  active boolean NOT NULL DEFAULT true,
  replaced_at timestamptz,
  CONSTRAINT media_assets_project_fk FOREIGN KEY (tenant_id, project_id)
    REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT media_assets_unit_fk FOREIGN KEY (tenant_id, project_id, unit_id)
    REFERENCES units(tenant_id, project_id, id) ON DELETE RESTRICT,
  CONSTRAINT media_assets_tenant_pair_uq UNIQUE (tenant_id, id),
  CONSTRAINT media_assets_storage_key_uq UNIQUE (tenant_id, storage_key),
  CONSTRAINT media_assets_entity_shape CHECK (
    (entity_type = 'project' AND kind = 'cover' AND unit_id IS NULL AND entity_id = project_id)
    OR
    (entity_type = 'unit' AND kind = 'floorplan' AND unit_id IS NOT NULL AND entity_id = unit_id)
  ),
  CONSTRAINT media_assets_lifecycle_shape CHECK (
    (active AND replaced_at IS NULL) OR (NOT active AND replaced_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX media_assets_one_active_entity_kind_uq
  ON media_assets (tenant_id, entity_type, entity_id, kind)
  WHERE active;
CREATE INDEX media_assets_project_idx ON media_assets (tenant_id, project_id, active);
CREATE INDEX media_assets_unit_idx ON media_assets (tenant_id, unit_id, active) WHERE unit_id IS NOT NULL;

-- Preserve access to media uploaded before this migration. The owning project/unit
-- remains the source of truth; no client supplied tenant or project is trusted.
INSERT INTO media_assets (
  tenant_id, project_id, entity_type, entity_id, kind, storage_key, file_name,
  mime_type, uploaded_by_user_id, uploaded_at, active
)
SELECT
  project.tenant_id, project.id, 'project', project.id, 'cover', project.cover_image_external_id,
  COALESCE(NULLIF(regexp_replace(project.cover_image_external_id, '^.*/', ''), ''), 'Titulní obrázek'),
  COALESCE(project.cover_image_mime_type, 'image/jpeg'), NULL, project.updated_at, true
FROM projects project
WHERE project.cover_image_source = 'crm'
  AND project.cover_image_external_id IS NOT NULL
  AND (project.cover_image_mime_type IS NULL OR project.cover_image_mime_type IN ('image/jpeg', 'image/png', 'image/webp'))
ON CONFLICT (tenant_id, storage_key) DO NOTHING;

INSERT INTO media_assets (
  tenant_id, project_id, unit_id, entity_type, entity_id, kind, storage_key,
  file_name, mime_type, uploaded_by_user_id, uploaded_at, active
)
SELECT
  unit.tenant_id, unit.project_id, unit.id, 'unit', unit.id, 'floorplan', unit.floorplan_image_external_id,
  COALESCE(NULLIF(regexp_replace(unit.floorplan_image_external_id, '^.*/', ''), ''), 'Půdorys'),
  COALESCE(unit.floorplan_image_mime_type, 'image/jpeg'), NULL, unit.updated_at, true
FROM units unit
WHERE unit.floorplan_image_source = 'crm'
  AND unit.floorplan_image_external_id IS NOT NULL
  AND (unit.floorplan_image_mime_type IS NULL OR unit.floorplan_image_mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf'))
ON CONFLICT (tenant_id, storage_key) DO NOTHING;

ALTER TABLE media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_assets FORCE ROW LEVEL SECURITY;
CREATE POLICY media_assets_tenant_policy ON media_assets
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON media_assets TO develocrm_app;

COMMIT;

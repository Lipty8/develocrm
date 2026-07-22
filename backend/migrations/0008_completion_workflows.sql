BEGIN;

ALTER TABLE projects ADD COLUMN cover_image_url text;
ALTER TABLE projects ADD COLUMN cover_image_mime_type text;
ALTER TABLE projects ADD COLUMN cover_image_source text CHECK (cover_image_source IS NULL OR cover_image_source IN ('crm','sharepoint'));
ALTER TABLE projects ADD COLUMN cover_image_external_id text;
ALTER TABLE units ADD COLUMN floorplan_image_url text;
ALTER TABLE units ADD COLUMN floorplan_image_mime_type text;
ALTER TABLE units ADD COLUMN floorplan_image_source text CHECK (floorplan_image_source IS NULL OR floorplan_image_source IN ('crm','sharepoint'));
ALTER TABLE units ADD COLUMN floorplan_image_external_id text;

CREATE TABLE tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid,
  unit_id uuid, party_id uuid, contract_id uuid,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 2 AND 240), description text,
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','completed','cancelled')),
  due_at timestamptz, assigned_to_membership_id uuid NOT NULL, created_by_membership_id uuid NOT NULL,
  completed_at timestamptz, completed_by_membership_id uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tasks_project_fk FOREIGN KEY (tenant_id,project_id) REFERENCES projects(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT tasks_unit_fk FOREIGN KEY (tenant_id,project_id,unit_id) REFERENCES units(tenant_id,project_id,id) ON DELETE RESTRICT,
  CONSTRAINT tasks_party_fk FOREIGN KEY (tenant_id,party_id) REFERENCES parties(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT tasks_contract_fk FOREIGN KEY (tenant_id,project_id,contract_id) REFERENCES contracts(tenant_id,project_id,id) ON DELETE RESTRICT,
  CONSTRAINT tasks_assignee_fk FOREIGN KEY (tenant_id,assigned_to_membership_id) REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT tasks_creator_fk FOREIGN KEY (tenant_id,created_by_membership_id) REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT tasks_completer_fk FOREIGN KEY (tenant_id,completed_by_membership_id) REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT tasks_tenant_pair_uq UNIQUE (tenant_id,id),
  CONSTRAINT tasks_link_shape CHECK (num_nonnulls(unit_id,party_id,contract_id) <= 1),
  CONSTRAINT tasks_project_link_shape CHECK (project_id IS NOT NULL OR (unit_id IS NULL AND contract_id IS NULL)),
  CONSTRAINT tasks_completion_shape CHECK ((status='completed')=(completed_at IS NOT NULL))
);
CREATE INDEX tasks_assignee_status_due_idx ON tasks(tenant_id,assigned_to_membership_id,status,due_at);
CREATE INDEX tasks_project_status_idx ON tasks(tenant_id,project_id,status,due_at);
CREATE INDEX tasks_unit_idx ON tasks(tenant_id,unit_id,created_at DESC) WHERE unit_id IS NOT NULL;

CREATE TRIGGER tasks_touch_updated_at BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

INSERT INTO permissions(code,description) VALUES
 ('media.read','Zobrazit projektová a jednotková média'),('media.manage','Spravovat projektová a jednotková média'),
 ('tasks.read','Zobrazit úkoly'),('tasks.manage','Vytvářet a upravovat úkoly'),('users.manage','Spravovat členství a role')
ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(tenant_id,role_id,permission_id)
SELECT role.tenant_id,role.id,permission.id FROM roles role CROSS JOIN permissions permission WHERE role.code='admin' ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(tenant_id,role_id,permission_id)
SELECT role.tenant_id,role.id,permission.id FROM roles role JOIN permissions permission ON permission.code IN ('media.read','media.manage','tasks.read','tasks.manage')
WHERE role.code IN ('project_manager','back_office') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(tenant_id,role_id,permission_id)
SELECT role.tenant_id,role.id,permission.id FROM roles role JOIN permissions permission ON permission.code IN ('media.read','tasks.read','tasks.manage')
WHERE role.code='sales' ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION app.set_project_cover(p_tenant uuid,p_project uuid,p_url text,p_mime text,p_source text,p_external_id text,p_actor uuid)
RETURNS uuid LANGUAGE plpgsql AS $$ DECLARE actor_user uuid; before_row jsonb; after_row jsonb;
BEGIN
 IF NOT app.has_project_permission(p_tenant,p_actor,p_project,'media.manage') THEN RAISE EXCEPTION 'media.manage permission required'; END IF;
 SELECT user_id INTO actor_user FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor;
 SELECT to_jsonb(project) INTO before_row FROM projects project WHERE tenant_id=p_tenant AND id=p_project FOR UPDATE;
 IF before_row IS NULL THEN RAISE EXCEPTION 'project not found'; END IF;
 UPDATE projects SET cover_image_url=p_url,cover_image_mime_type=p_mime,cover_image_source=p_source,cover_image_external_id=p_external_id WHERE tenant_id=p_tenant AND id=p_project RETURNING to_jsonb(projects) INTO after_row;
 INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data) VALUES(p_tenant,actor_user,'project.cover_changed','project',p_project,before_row,after_row);
 INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload) VALUES(p_tenant,'project',p_project,'project.cover_changed.v1',jsonb_build_object('projectId',p_project,'url',p_url,'source',p_source)); RETURN p_project;
END $$;

CREATE OR REPLACE FUNCTION app.set_unit_floorplan(p_tenant uuid,p_unit uuid,p_url text,p_mime text,p_source text,p_external_id text,p_actor uuid)
RETURNS uuid LANGUAGE plpgsql AS $$ DECLARE actor_user uuid;project uuid;before_row jsonb;after_row jsonb;
BEGIN
 SELECT project_id INTO project FROM units WHERE tenant_id=p_tenant AND id=p_unit;
 IF project IS NULL OR NOT app.has_project_permission(p_tenant,p_actor,project,'media.manage') THEN RAISE EXCEPTION 'media.manage permission required'; END IF;
 SELECT user_id INTO actor_user FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor;
 SELECT to_jsonb(unit) INTO before_row FROM units unit WHERE tenant_id=p_tenant AND id=p_unit FOR UPDATE;
 UPDATE units SET floorplan_image_url=p_url,floorplan_image_mime_type=p_mime,floorplan_image_source=p_source,floorplan_image_external_id=p_external_id WHERE tenant_id=p_tenant AND id=p_unit RETURNING to_jsonb(units) INTO after_row;
 INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data,metadata) VALUES(p_tenant,actor_user,'unit.floorplan_changed','unit',p_unit,before_row,after_row,jsonb_build_object('projectId',project,'unitId',p_unit));
 INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload) VALUES(p_tenant,'unit',p_unit,'unit.floorplan_changed.v1',jsonb_build_object('projectId',project,'unitId',p_unit,'url',p_url,'source',p_source)); RETURN p_unit;
END $$;

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY; ALTER TABLE tasks FORCE ROW LEVEL SECURITY;
CREATE POLICY tasks_tenant_policy ON tasks USING (tenant_id=app.current_tenant_id()) WITH CHECK (tenant_id=app.current_tenant_id());
GRANT SELECT,INSERT,UPDATE ON tasks TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.set_project_cover(uuid,uuid,text,text,text,text,uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.set_unit_floorplan(uuid,uuid,text,text,text,text,uuid) TO develocrm_app;

COMMIT;

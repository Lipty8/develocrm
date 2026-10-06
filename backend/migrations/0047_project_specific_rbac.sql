BEGIN;

-- Project access is either one or more project roles, or a compact custom
-- access profile. Workspace administration never implies business-data access.
CREATE TABLE project_custom_access (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  area text NOT NULL CHECK (area IN (
    'project','units','clients','contracts','payments','documents',
    'client_changes','handovers','complaints','tasks'
  )),
  access_level text NOT NULL CHECK (access_level IN ('read','edit')),
  assigned_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,project_id,membership_id,area),
  CONSTRAINT project_custom_access_project_fk FOREIGN KEY (tenant_id,project_id)
    REFERENCES projects(tenant_id,id) ON DELETE CASCADE,
  CONSTRAINT project_custom_access_membership_fk FOREIGN KEY (tenant_id,membership_id)
    REFERENCES tenant_memberships(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX project_custom_access_member_idx
  ON project_custom_access(tenant_id,membership_id,project_id);

CREATE OR REPLACE FUNCTION app.guard_project_access_mode()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='project_custom_access' AND EXISTS (
    SELECT 1 FROM project_role_assignments assignment
    WHERE assignment.tenant_id=NEW.tenant_id AND assignment.project_id=NEW.project_id
      AND assignment.membership_id=NEW.membership_id
  ) THEN RAISE EXCEPTION 'project access must use roles or custom access, not both'; END IF;
  IF TG_TABLE_NAME='project_role_assignments' AND EXISTS (
    SELECT 1 FROM project_custom_access access
    WHERE access.tenant_id=NEW.tenant_id AND access.project_id=NEW.project_id
      AND access.membership_id=NEW.membership_id
  ) THEN RAISE EXCEPTION 'project access must use roles or custom access, not both'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER project_custom_access_mode_guard BEFORE INSERT OR UPDATE ON project_custom_access
  FOR EACH ROW EXECUTE FUNCTION app.guard_project_access_mode();
CREATE TRIGGER project_role_access_mode_guard BEFORE INSERT OR UPDATE ON project_role_assignments
  FOR EACH ROW EXECUTE FUNCTION app.guard_project_access_mode();

-- Creating a project never broadens access for all administrators. The active
-- creator alone receives an explicit full-project assignment.
CREATE OR REPLACE FUNCTION app.assign_project_creator_access()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,app AS $$
DECLARE creator_membership uuid;creator_user uuid;project_role uuid;
BEGIN
  creator_user:=app.current_user_id();
  IF creator_user IS NULL THEN RETURN NEW; END IF;
  SELECT membership.id INTO creator_membership FROM tenant_memberships membership
  WHERE membership.tenant_id=NEW.tenant_id AND membership.user_id=creator_user AND membership.status='active'
  ORDER BY membership.accepted_at DESC NULLS LAST LIMIT 1;
  SELECT role.id INTO project_role FROM roles role
  WHERE role.tenant_id=NEW.tenant_id AND role.code='project_admin' AND role.status='active';
  IF creator_membership IS NOT NULL AND project_role IS NOT NULL THEN
    INSERT INTO project_role_assignments(tenant_id,project_id,membership_id,role_id,assigned_by_user_id)
    VALUES(NEW.tenant_id,NEW.id,creator_membership,project_role,creator_user)
    ON CONFLICT(tenant_id,project_id,membership_id,role_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER projects_assign_creator_access AFTER INSERT ON projects
  FOR EACH ROW EXECUTE FUNCTION app.assign_project_creator_access();

-- Keep a transaction-local baseline. The migration aborts if the explicit
-- project conversion changes any project permission unexpectedly.
CREATE TEMP TABLE rbac_access_before ON COMMIT DROP AS
SELECT membership.tenant_id,membership.id membership_id,project.id project_id,permission.code,
  app.has_project_permission(membership.tenant_id,membership.id,project.id,permission.code) allowed
FROM tenant_memberships membership
JOIN projects project ON project.tenant_id=membership.tenant_id AND project.archived_at IS NULL
CROSS JOIN permissions permission
WHERE membership.status='active'
  AND permission.code NOT IN (
    'users.manage','roles.manage','role.manage','role.read','system.manage',
    'integrations.manage','projects.create','audit.read'
  );

-- A real project role preserves the former business part of Administrator for
-- existing projects, without granting future projects automatically.
INSERT INTO roles(tenant_id,code,name,description,is_system)
SELECT tenant.id,'project_admin','Plný projektový přístup','Kompletní provozní přístup k jednomu projektu.',true
FROM tenants tenant
ON CONFLICT(tenant_id,(lower(code))) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,status='active',archived_at=NULL;

INSERT INTO role_permissions(tenant_id,role_id,permission_id,scope)
SELECT admin.tenant_id,project_admin.id,grant_row.permission_id,
  CASE WHEN grant_row.scope IN ('own','partner') THEN grant_row.scope ELSE 'project' END
FROM roles admin
JOIN roles project_admin ON project_admin.tenant_id=admin.tenant_id AND project_admin.code='project_admin'
JOIN role_permissions grant_row ON grant_row.tenant_id=admin.tenant_id AND grant_row.role_id=admin.id
JOIN permissions permission ON permission.id=grant_row.permission_id
WHERE admin.code='admin'
  AND permission.code NOT IN ('users.manage','roles.manage','role.manage','role.read','system.manage','integrations.manage','projects.create','audit.read')
ON CONFLICT(tenant_id,role_id,permission_id) DO UPDATE SET scope=EXCLUDED.scope;

-- Existing workspace administrators keep their current business access, but
-- now through explicit assignments to projects that exist at migration time.
INSERT INTO project_role_assignments(tenant_id,project_id,membership_id,role_id,assigned_by_user_id)
SELECT assignment.tenant_id,project.id,assignment.membership_id,project_admin.id,assignment.assigned_by_user_id
FROM role_assignments assignment
JOIN roles admin ON admin.tenant_id=assignment.tenant_id AND admin.id=assignment.role_id AND admin.code='admin'
JOIN roles project_admin ON project_admin.tenant_id=admin.tenant_id AND project_admin.code='project_admin'
JOIN projects project ON project.tenant_id=assignment.tenant_id AND project.archived_at IS NULL
ON CONFLICT(tenant_id,project_id,membership_id,role_id) DO NOTHING;

-- A historically project-scoped Administrator assignment becomes the new
-- explicit project role and never grants workspace administration.
INSERT INTO project_role_assignments(tenant_id,project_id,membership_id,role_id,assigned_by_user_id,assigned_at)
SELECT assignment.tenant_id,assignment.project_id,assignment.membership_id,project_admin.id,assignment.assigned_by_user_id,assignment.assigned_at
FROM project_role_assignments assignment
JOIN roles admin ON admin.tenant_id=assignment.tenant_id AND admin.id=assignment.role_id AND admin.code='admin'
JOIN roles project_admin ON project_admin.tenant_id=admin.tenant_id AND project_admin.code='project_admin'
ON CONFLICT(tenant_id,project_id,membership_id,role_id) DO NOTHING;
DELETE FROM project_role_assignments assignment USING roles role
WHERE role.tenant_id=assignment.tenant_id AND role.id=assignment.role_id AND role.code='admin';

-- Any other legacy workspace business role is made explicit for all projects
-- that existed when it had workspace-wide effect. New projects remain private.
INSERT INTO project_role_assignments(tenant_id,project_id,membership_id,role_id,assigned_by_user_id,assigned_at)
SELECT assignment.tenant_id,project.id,assignment.membership_id,assignment.role_id,assignment.assigned_by_user_id,assignment.assigned_at
FROM role_assignments assignment
JOIN roles role ON role.tenant_id=assignment.tenant_id AND role.id=assignment.role_id AND role.code<>'admin'
JOIN projects project ON project.tenant_id=assignment.tenant_id AND project.archived_at IS NULL
ON CONFLICT(tenant_id,project_id,membership_id,role_id) DO NOTHING;
DELETE FROM role_assignments assignment USING roles role
WHERE role.tenant_id=assignment.tenant_id AND role.id=assignment.role_id AND role.code<>'admin';

-- Administrator is workspace administration only.
DELETE FROM role_permissions grant_row USING roles role,permissions permission
WHERE role.tenant_id=grant_row.tenant_id AND role.id=grant_row.role_id AND role.code='admin'
  AND permission.id=grant_row.permission_id
  AND permission.code NOT IN ('users.manage','roles.manage','role.manage','role.read','system.manage','integrations.manage','projects.create','audit.read');
UPDATE role_permissions grant_row SET scope='workspace'
FROM roles role,permissions permission
WHERE role.tenant_id=grant_row.tenant_id AND role.id=grant_row.role_id AND role.code='admin'
  AND permission.id=grant_row.permission_id;

-- Project presets cannot accidentally become workspace grants. Own/partner
-- remain row-level refinements used by the sales role.
UPDATE role_permissions grant_row SET scope='project'
FROM roles role,permissions permission
WHERE role.tenant_id=grant_row.tenant_id AND role.id=grant_row.role_id
  AND permission.id=grant_row.permission_id
  AND role.code IN ('project_admin','executive','project_manager','back_office','finance','handover_complaints','read_only')
  AND permission.code<>'projects.create';
UPDATE role_permissions grant_row SET scope='project'
FROM roles role,permissions permission
WHERE role.tenant_id=grant_row.tenant_id AND role.id=grant_row.role_id
  AND permission.id=grant_row.permission_id AND role.code='sales'
  AND grant_row.scope NOT IN ('own','partner') AND permission.code<>'projects.create';

CREATE OR REPLACE FUNCTION app.requested_project_permissions(p_permission text)
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_permission
    WHEN 'project.read' THEN ARRAY['projects.read'] WHEN 'project.manage' THEN ARRAY['projects.update']
    WHEN 'unit.read' THEN ARRAY['units.read'] WHEN 'unit.manage' THEN ARRAY['units.update']
    WHEN 'accessory.read' THEN ARRAY['accessories.read'] WHEN 'accessory.manage' THEN ARRAY['accessories.update']
    WHEN 'clients.read' THEN ARRAY['clients.read_all','clients.read_own'] WHEN 'clients.manage' THEN ARRAY['clients.update']
    WHEN 'clients.export' THEN ARRAY['exports.run'] WHEN 'sales_case.read' THEN ARRAY['sales_cases.read']
    WHEN 'sales_case.manage' THEN ARRAY['sales_cases.manage'] WHEN 'holds.manage' THEN ARRAY['holds.confirm']
    WHEN 'price.read' THEN ARRAY['prices.read'] WHEN 'price.manage' THEN ARRAY['prices.propose']
    WHEN 'price.approve' THEN ARRAY['prices.approve'] WHEN 'contract.read' THEN ARRAY['contracts.read']
    WHEN 'contract.manage' THEN ARRAY['contracts.create','contracts.update'] WHEN 'contract.approve' THEN ARRAY['contracts.mark_ready']
    WHEN 'contract.sign' THEN ARRAY['contracts.record_signature'] WHEN 'documents.view' THEN ARRAY['documents.read']
    WHEN 'documents.upload' THEN ARRAY['documents.create'] WHEN 'documents.edit_metadata' THEN ARRAY['documents.update']
    WHEN 'documents.manage' THEN ARRAY['documents.update'] WHEN 'handover.read' THEN ARRAY['handovers.read']
    WHEN 'handover.manage' THEN ARRAY['handovers.manage'] ELSE ARRAY[p_permission] END
$$;

CREATE OR REPLACE FUNCTION app.custom_project_access_allows(p_area text,p_level text,p_permission text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_area
    WHEN 'project' THEN p_permission=ANY(CASE p_level WHEN 'edit' THEN ARRAY['project.read','projects.read','project.manage','projects.update','projects.change_manager','projects.change_status','media.read','media.manage'] ELSE ARRAY['project.read','projects.read','media.read'] END)
    WHEN 'units' THEN p_permission=ANY(CASE p_level WHEN 'edit' THEN ARRAY['unit.read','units.read','unit.manage','units.update','units.update_sales_status','accessory.read','accessories.read','accessory.manage','accessories.update','price.read','prices.read','price.manage','prices.propose','media.read','media.manage'] ELSE ARRAY['unit.read','units.read','accessory.read','accessories.read','price.read','prices.read','media.read'] END)
    WHEN 'clients' THEN p_permission=ANY(CASE p_level WHEN 'edit' THEN ARRAY['clients.read','clients.read_all','clients.read_contact_details','clients.create','clients.manage','clients.update','interests.manage','sales_case.read','sales_cases.read','sales_case.manage','sales_cases.manage','holds.create','holds.cancel'] ELSE ARRAY['clients.read','clients.read_all','clients.read_contact_details','sales_case.read','sales_cases.read'] END)
    WHEN 'contracts' THEN p_permission=ANY(CASE p_level WHEN 'edit' THEN ARRAY['contract.read','contracts.read','contract.manage','contracts.create','contracts.update'] ELSE ARRAY['contract.read','contracts.read'] END)
    WHEN 'payments' THEN p_permission=ANY(CASE p_level WHEN 'edit' THEN ARRAY['payments.read','payments.record'] ELSE ARRAY['payments.read'] END)
    WHEN 'documents' THEN p_permission=ANY(CASE p_level WHEN 'edit' THEN ARRAY['documents.view','documents.read','documents.upload','documents.create','documents.edit_metadata','documents.update'] ELSE ARRAY['documents.view','documents.read'] END)
    WHEN 'client_changes' THEN p_permission=ANY(CASE p_level WHEN 'edit' THEN ARRAY['client_changes.read','client_changes.manage'] ELSE ARRAY['client_changes.read'] END)
    WHEN 'handovers' THEN p_permission=ANY(CASE p_level WHEN 'edit' THEN ARRAY['handover.read','handovers.read','handover.manage','handovers.manage'] ELSE ARRAY['handover.read','handovers.read'] END)
    WHEN 'complaints' THEN p_permission=ANY(CASE p_level WHEN 'edit' THEN ARRAY['complaints.read','complaints.manage'] ELSE ARRAY['complaints.read'] END)
    WHEN 'tasks' THEN p_permission=ANY(CASE p_level WHEN 'edit' THEN ARRAY['tasks.read','tasks.manage'] ELSE ARRAY['tasks.read'] END)
    ELSE false END
$$;

CREATE OR REPLACE FUNCTION app.has_project_permission(p_tenant_id uuid,p_membership_id uuid,p_project_id uuid,p_permission text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,app AS $$
  SELECT EXISTS(
    SELECT 1 FROM tenant_memberships membership
    WHERE membership.tenant_id=p_tenant_id AND membership.id=p_membership_id AND membership.status='active'
      AND (
        EXISTS(
          SELECT 1 FROM project_role_assignments assignment
          JOIN role_permissions grant_row ON grant_row.tenant_id=assignment.tenant_id AND grant_row.role_id=assignment.role_id
            AND grant_row.scope IN ('project','own','partner')
          JOIN permissions permission ON permission.id=grant_row.permission_id
          WHERE assignment.tenant_id=p_tenant_id AND assignment.membership_id=p_membership_id
            AND assignment.project_id=p_project_id
            AND permission.code=ANY(app.requested_project_permissions(p_permission))
        )
        OR EXISTS(
          SELECT 1 FROM project_custom_access access
          WHERE access.tenant_id=p_tenant_id AND access.membership_id=p_membership_id
            AND access.project_id=p_project_id
            AND app.custom_project_access_allows(access.area,access.access_level,p_permission)
        )
      )
  )
$$;

-- Workspace checks accept workspace grants only.
CREATE OR REPLACE FUNCTION app.current_user_has_permission(requested_code text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM tenant_memberships membership
    JOIN role_assignments assignment ON assignment.tenant_id=membership.tenant_id AND assignment.membership_id=membership.id
    JOIN role_permissions grant_row ON grant_row.tenant_id=assignment.tenant_id AND grant_row.role_id=assignment.role_id AND grant_row.scope='workspace'
    JOIN permissions permission ON permission.id=grant_row.permission_id
    WHERE membership.tenant_id=app.current_tenant_id() AND membership.user_id=app.current_user_id()
      AND membership.status='active' AND permission.code=requested_code
  )
$$;

DO $$
DECLARE drift_count integer;
BEGIN
  SELECT count(*) INTO drift_count
  FROM rbac_access_before before_access
  WHERE before_access.allowed IS DISTINCT FROM app.has_project_permission(
    before_access.tenant_id,before_access.membership_id,before_access.project_id,before_access.code
  );
  IF drift_count<>0 THEN
    RAISE EXCEPTION 'RBAC migration aborted: % unexpected project permission changes',drift_count;
  END IF;
END $$;

ALTER TABLE project_custom_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_custom_access FORCE ROW LEVEL SECURITY;
CREATE POLICY project_custom_access_admin_policy ON project_custom_access FOR ALL
  USING (tenant_id=app.current_tenant_id() AND app.current_user_has_permission('users.manage'))
  WITH CHECK (tenant_id=app.current_tenant_id() AND app.current_user_has_permission('users.manage'));
CREATE POLICY project_custom_access_own_select_policy ON project_custom_access FOR SELECT
  USING (
    tenant_id=app.current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM tenant_memberships membership
      WHERE membership.tenant_id=project_custom_access.tenant_id
        AND membership.id=project_custom_access.membership_id
        AND membership.user_id=app.current_user_id()
        AND membership.status='active'
    )
  );
GRANT SELECT,INSERT,UPDATE,DELETE ON project_custom_access TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.requested_project_permissions(text) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.custom_project_access_allows(text,text,text) TO develocrm_app;

COMMIT;

BEGIN;

ALTER TABLE contract_status_events
  ADD COLUMN source text NOT NULL DEFAULT 'manual'
  CHECK (source IN ('manual','automation','signature','import'));

DROP TRIGGER contract_status_append_only ON contract_status_events;
UPDATE contract_status_events
SET source = CASE
  WHEN command = 'completeSignatures' THEN 'signature'
  WHEN command ILIKE '%import%' THEN 'import'
  ELSE 'manual'
END;
CREATE TRIGGER contract_status_append_only
  BEFORE UPDATE OR DELETE ON contract_status_events
  FOR EACH ROW EXECUTE FUNCTION app.reject_append_only();

CREATE OR REPLACE FUNCTION app.contract_event_source()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.command = 'completeSignatures' THEN NEW.source := 'signature'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER contract_status_events_source
  BEFORE INSERT ON contract_status_events
  FOR EACH ROW EXECUTE FUNCTION app.contract_event_source();

ALTER TABLE users ADD COLUMN job_title text;
ALTER TABLE users ADD COLUMN work_phone text;

CREATE OR REPLACE FUNCTION app.current_user_has_permission(requested_code text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM tenant_memberships membership
    JOIN role_assignments assignment
      ON assignment.tenant_id = membership.tenant_id
     AND assignment.membership_id = membership.id
    JOIN role_permissions role_permission
      ON role_permission.tenant_id = assignment.tenant_id
     AND role_permission.role_id = assignment.role_id
    JOIN permissions permission ON permission.id = role_permission.permission_id
    WHERE membership.tenant_id = app.current_tenant_id()
      AND membership.user_id = app.current_user_id()
      AND membership.status = 'active'
      AND permission.code = requested_code
  );
$$;
REVOKE ALL ON FUNCTION app.current_user_has_permission(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.current_user_has_permission(text) TO develocrm_app;

DROP POLICY users_identity_select ON users;
DROP POLICY users_identity_insert ON users;
DROP POLICY users_identity_update ON users;
CREATE POLICY users_identity_or_tenant_admin_select ON users FOR SELECT USING (
  id = app.current_user_id()
  OR (entra_issuer = app.current_identity_issuer() AND entra_subject = app.current_identity_subject())
  OR (
    app.current_user_has_permission('users.manage')
    AND EXISTS (
      SELECT 1 FROM tenant_memberships membership
      WHERE membership.tenant_id = app.current_tenant_id()
        AND membership.user_id = users.id
    )
  )
);
CREATE POLICY users_identity_or_tenant_admin_insert ON users FOR INSERT WITH CHECK (
  (entra_issuer = app.current_identity_issuer() AND entra_subject = app.current_identity_subject())
  OR app.current_user_has_permission('users.manage')
);
CREATE POLICY users_identity_or_tenant_admin_update ON users FOR UPDATE
  USING (
    id = app.current_user_id()
    OR (
      app.current_user_has_permission('users.manage')
      AND EXISTS (
        SELECT 1 FROM tenant_memberships membership
        WHERE membership.tenant_id = app.current_tenant_id()
          AND membership.user_id = users.id
      )
    )
  )
  WITH CHECK (
    id = app.current_user_id()
    OR (
      app.current_user_has_permission('users.manage')
      AND EXISTS (
        SELECT 1 FROM tenant_memberships membership
        WHERE membership.tenant_id = app.current_tenant_id()
          AND membership.user_id = users.id
      )
    )
  );

DROP POLICY memberships_tenant_insert ON tenant_memberships;
DROP POLICY memberships_tenant_update ON tenant_memberships;
CREATE POLICY memberships_tenant_admin_insert ON tenant_memberships FOR INSERT
  WITH CHECK (
    tenant_id = app.current_tenant_id()
    AND app.current_user_has_permission('users.manage')
  );
CREATE POLICY memberships_tenant_admin_update ON tenant_memberships FOR UPDATE
  USING (
    tenant_id = app.current_tenant_id()
    AND app.current_user_has_permission('users.manage')
  )
  WITH CHECK (
    tenant_id = app.current_tenant_id()
    AND app.current_user_has_permission('users.manage')
  );

INSERT INTO permissions(code,description) VALUES
 ('users.manage','Spravovat uživatele workspace'),
 ('role.manage','Upravovat bezpečně oprávnění rolí'),
 ('finance.read','Zobrazit finanční agendu'),('finance.manage','Spravovat finanční agendu'),
 ('handover.read','Zobrazit předání a reklamace'),('handover.manage','Spravovat předání a reklamace'),
 ('complaints.read','Zobrazit reklamace'),('complaints.manage','Spravovat reklamace')
ON CONFLICT(code) DO NOTHING;

INSERT INTO roles(tenant_id,code,name,description,is_system)
SELECT tenant.id,definition.code,definition.name,definition.description,true
FROM tenants tenant CROSS JOIN (VALUES
 ('finance','Finance','Platební a finanční agenda'),
 ('handover_complaints','Předání a reklamace','Předání jednotek, vady a reklamace'),
 ('read_only','Pouze pro čtení','Čtení dostupných projektů bez editace')
) definition(code,name,description)
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions(tenant_id,role_id,permission_id)
SELECT role.tenant_id,role.id,permission.id
FROM roles role CROSS JOIN permissions permission
WHERE role.code='admin'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions(tenant_id,role_id,permission_id)
SELECT role.tenant_id,role.id,permission.id
FROM roles role JOIN permissions permission ON permission.code=ANY(CASE role.code
 WHEN 'finance' THEN ARRAY['tenant.read','project.read','unit.read','clients.read','price.read','contract.read','documents.view','finance.read','finance.manage','clients.export']
 WHEN 'handover_complaints' THEN ARRAY['tenant.read','project.read','unit.read','clients.read','documents.view','tasks.read','tasks.manage','handover.read','handover.manage','complaints.read','complaints.manage']
 WHEN 'read_only' THEN ARRAY['tenant.read','project.read','unit.read','accessory.read','clients.read','sales_case.read','price.read','contract.read','documents.view','tasks.read','handover.read']
 ELSE ARRAY[]::text[] END)
WHERE role.code IN ('finance','handover_complaints','read_only')
ON CONFLICT DO NOTHING;

CREATE TABLE unit_handovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  unit_id uuid NOT NULL,
  scheduled_at timestamptz NOT NULL,
  responsible_membership_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','ready','in_progress','completed','cancelled')),
  readiness_percent integer NOT NULL DEFAULT 0 CHECK(readiness_percent BETWEEN 0 AND 100),
  attention text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unit_handovers_unit_fk FOREIGN KEY(tenant_id,project_id,unit_id) REFERENCES units(tenant_id,project_id,id) ON DELETE RESTRICT,
  CONSTRAINT unit_handovers_responsible_fk FOREIGN KEY(tenant_id,responsible_membership_id) REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT unit_handovers_tenant_pair_uq UNIQUE(tenant_id,id)
);
CREATE INDEX unit_handovers_schedule_idx ON unit_handovers(tenant_id,scheduled_at,id);
CREATE TRIGGER unit_handovers_touch_updated_at BEFORE UPDATE ON unit_handovers FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
ALTER TABLE unit_handovers ENABLE ROW LEVEL SECURITY;
ALTER TABLE unit_handovers FORCE ROW LEVEL SECURITY;
CREATE POLICY unit_handovers_tenant_policy ON unit_handovers USING(tenant_id=app.current_tenant_id()) WITH CHECK(tenant_id=app.current_tenant_id());
GRANT SELECT,INSERT,UPDATE ON unit_handovers TO develocrm_app;

COMMIT;

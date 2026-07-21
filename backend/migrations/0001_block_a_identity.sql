BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'develocrm_app') THEN
    CREATE ROLE develocrm_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS app;

CREATE OR REPLACE FUNCTION app.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app.current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app.current_identity_issuer()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.identity_issuer', true), '')
$$;

CREATE OR REPLACE FUNCTION app.current_identity_subject()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.identity_subject', true), '')
$$;

CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 160),
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('provisioning', 'active', 'suspended', 'archived')),
  locale text NOT NULL DEFAULT 'cs-CZ',
  timezone text NOT NULL DEFAULT 'Europe/Prague',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT tenants_archived_state CHECK ((status = 'archived') = (archived_at IS NOT NULL))
);
CREATE UNIQUE INDEX tenants_slug_uq ON tenants (lower(slug));

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entra_issuer text NOT NULL,
  entra_subject text NOT NULL,
  email text NOT NULL CHECK (position('@' IN email) > 1),
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 160),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'archived')),
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT users_identity_uq UNIQUE (entra_issuer, entra_subject),
  CONSTRAINT users_archived_state CHECK ((status = 'archived') = (archived_at IS NOT NULL))
);
CREATE INDEX users_email_idx ON users (lower(email));

CREATE TABLE tenant_identity_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  provider text NOT NULL DEFAULT 'entra' CHECK (provider = 'entra'),
  entra_tenant_id uuid NOT NULL,
  issuer text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_identity_provider_uq UNIQUE (tenant_id, provider, entra_tenant_id),
  CONSTRAINT tenant_identity_provider_tenant_pair_uq UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX tenant_identity_provider_primary_uq
  ON tenant_identity_providers (tenant_id)
  WHERE is_primary AND status = 'active';

CREATE TABLE tenant_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'suspended', 'archived')),
  invited_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT tenant_membership_uq UNIQUE (tenant_id, user_id),
  CONSTRAINT tenant_membership_tenant_pair_uq UNIQUE (tenant_id, id),
  CONSTRAINT tenant_memberships_active_accepted CHECK (status <> 'active' OR accepted_at IS NOT NULL),
  CONSTRAINT tenant_memberships_archived_state CHECK ((status = 'archived') = (archived_at IS NOT NULL))
);
CREATE INDEX tenant_memberships_user_idx ON tenant_memberships (user_id, status);

CREATE TABLE permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[a-z][a-z0-9_]*$'),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 100),
  description text,
  is_system boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT roles_tenant_pair_uq UNIQUE (tenant_id, id),
  CONSTRAINT roles_archived_state CHECK ((status = 'archived') = (archived_at IS NOT NULL))
);
CREATE UNIQUE INDEX roles_tenant_code_uq ON roles (tenant_id, lower(code));

CREATE TABLE role_permissions (
  tenant_id uuid NOT NULL,
  role_id uuid NOT NULL,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, role_id, permission_id),
  CONSTRAINT role_permissions_role_fk FOREIGN KEY (tenant_id, role_id)
    REFERENCES roles(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE role_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  role_id uuid NOT NULL,
  assigned_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT role_assignments_membership_fk FOREIGN KEY (tenant_id, membership_id)
    REFERENCES tenant_memberships(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT role_assignments_role_fk FOREIGN KEY (tenant_id, role_id)
    REFERENCES roles(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT role_assignment_uq UNIQUE (tenant_id, membership_id, role_id),
  CONSTRAINT role_assignments_tenant_pair_uq UNIQUE (tenant_id, id)
);

CREATE TABLE audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  actor_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (length(btrim(action)) BETWEEN 3 AND 120),
  entity_type text NOT NULL CHECK (length(btrim(entity_type)) BETWEEN 2 AND 80),
  entity_id uuid,
  request_id text,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_log_tenant_pair_uq UNIQUE (tenant_id, id)
);
CREATE INDEX audit_log_tenant_time_idx ON audit_log (tenant_id, occurred_at DESC);

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error text,
  CONSTRAINT outbox_events_tenant_pair_uq UNIQUE (tenant_id, id),
  CONSTRAINT outbox_publish_state CHECK (published_at IS NULL OR published_at >= occurred_at)
);
CREATE INDEX outbox_pending_idx ON outbox_events (available_at, occurred_at) WHERE published_at IS NULL;

CREATE OR REPLACE FUNCTION app.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END
$$;

CREATE TRIGGER tenants_touch_updated_at BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER users_touch_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER tenant_identity_providers_touch_updated_at BEFORE UPDATE ON tenant_identity_providers
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER tenant_memberships_touch_updated_at BEFORE UPDATE ON tenant_memberships
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER roles_touch_updated_at BEFORE UPDATE ON roles
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE OR REPLACE FUNCTION app.reject_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END
$$;
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION app.reject_audit_mutation();

INSERT INTO permissions (code, description) VALUES
  ('tenant.read', 'Zobrazit workspace a jeho nastavení'),
  ('tenant.manage', 'Měnit nastavení workspace'),
  ('membership.read', 'Zobrazit členy workspace'),
  ('membership.invite', 'Pozvat uživatele do workspace'),
  ('membership.manage', 'Aktivovat, pozastavit a archivovat členství'),
  ('role.read', 'Zobrazit role a oprávnění'),
  ('role.manage', 'Vytvářet a archivovat vlastní role'),
  ('role.assign', 'Přiřazovat role členům'),
  ('audit.read', 'Zobrazit bezpečnostní audit')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_identity_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_identity_providers FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
ALTER TABLE role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_assignments FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox_events FORCE ROW LEVEL SECURITY;

CREATE POLICY users_identity_select ON users FOR SELECT USING (
  id = app.current_user_id()
  OR (entra_issuer = app.current_identity_issuer() AND entra_subject = app.current_identity_subject())
);
CREATE POLICY users_identity_insert ON users FOR INSERT WITH CHECK (
  entra_issuer = app.current_identity_issuer() AND entra_subject = app.current_identity_subject()
);
CREATE POLICY users_identity_update ON users FOR UPDATE
  USING (id = app.current_user_id()) WITH CHECK (id = app.current_user_id());

CREATE POLICY tenants_member_select ON tenants FOR SELECT USING (
  id = app.current_tenant_id()
  OR EXISTS (
    SELECT 1 FROM tenant_memberships membership
    WHERE membership.tenant_id = tenants.id
      AND membership.user_id = app.current_user_id()
      AND membership.status = 'active'
  )
);
CREATE POLICY tenants_context_insert ON tenants FOR INSERT WITH CHECK (id = app.current_tenant_id());
CREATE POLICY tenants_context_update ON tenants FOR UPDATE
  USING (id = app.current_tenant_id()) WITH CHECK (id = app.current_tenant_id());

CREATE POLICY identity_providers_tenant_all ON tenant_identity_providers
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY memberships_self_or_tenant_select ON tenant_memberships FOR SELECT USING (
  user_id = app.current_user_id() OR tenant_id = app.current_tenant_id()
);
CREATE POLICY memberships_tenant_insert ON tenant_memberships FOR INSERT
  WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY memberships_tenant_update ON tenant_memberships FOR UPDATE
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY roles_tenant_all ON roles
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY role_permissions_tenant_all ON role_permissions
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY role_assignments_tenant_all ON role_assignments
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id() AND assigned_by_user_id = app.current_user_id());
CREATE POLICY audit_log_tenant_select ON audit_log FOR SELECT
  USING (tenant_id = app.current_tenant_id());
CREATE POLICY audit_log_tenant_insert ON audit_log FOR INSERT
  WITH CHECK (
    tenant_id = app.current_tenant_id()
    AND (actor_user_id IS NULL OR actor_user_id = app.current_user_id())
  );
CREATE POLICY outbox_events_tenant_all ON outbox_events
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());

GRANT USAGE ON SCHEMA public, app TO develocrm_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO develocrm_app;
GRANT SELECT, INSERT, UPDATE ON tenants, users, tenant_identity_providers, tenant_memberships, roles TO develocrm_app;
GRANT SELECT ON permissions TO develocrm_app;
GRANT SELECT, INSERT, DELETE ON role_permissions, role_assignments TO develocrm_app;
GRANT SELECT, INSERT ON audit_log TO develocrm_app;
GRANT SELECT, INSERT, UPDATE ON outbox_events TO develocrm_app;

COMMIT;

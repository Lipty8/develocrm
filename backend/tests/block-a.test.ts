import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const ids = {
  tenantA: "10000000-0000-4000-8000-000000000001",
  tenantB: "10000000-0000-4000-8000-000000000002",
  userA: "20000000-0000-4000-8000-000000000001",
  userB: "20000000-0000-4000-8000-000000000002",
  memberA: "30000000-0000-4000-8000-000000000001",
  memberB: "30000000-0000-4000-8000-000000000002",
  roleA: "40000000-0000-4000-8000-000000000001",
  roleB: "40000000-0000-4000-8000-000000000002",
};

async function databaseWithFixtures() {
  const db = new PGlite();
  const migration = await readFile(new URL("../migrations/0001_block_a_identity.sql", import.meta.url), "utf8");
  await db.exec(migration);
  await db.exec(`
    INSERT INTO tenants (id, name, slug) VALUES
      ('${ids.tenantA}', 'Tenant A', 'tenant-a'),
      ('${ids.tenantB}', 'Tenant B', 'tenant-b');
    INSERT INTO users (id, entra_issuer, entra_subject, email, display_name) VALUES
      ('${ids.userA}', 'issuer-a', 'subject-a', 'a@example.test', 'User A'),
      ('${ids.userB}', 'issuer-b', 'subject-b', 'b@example.test', 'User B');
    INSERT INTO tenant_memberships (id, tenant_id, user_id, status, accepted_at) VALUES
      ('${ids.memberA}', '${ids.tenantA}', '${ids.userA}', 'active', now()),
      ('${ids.memberB}', '${ids.tenantB}', '${ids.userB}', 'active', now());
    INSERT INTO roles (id, tenant_id, code, name, is_system) VALUES
      ('${ids.roleA}', '${ids.tenantA}', 'admin', 'Admin', true),
      ('${ids.roleB}', '${ids.tenantB}', 'admin', 'Admin', true);
  `);
  return db;
}

test("migrace A obsahuje pouze schválené identity/RBAC tabulky", async () => {
  const db = await databaseWithFixtures();
  const result = await db.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
  );
  assert.deepEqual(result.rows.map((row) => row.tablename), [
    "audit_log", "outbox_events", "permissions", "role_assignments", "role_permissions",
    "roles", "tenant_identity_providers", "tenant_memberships", "tenants", "users",
  ]);
  await db.close();
});

test("RLS před výběrem workspace zpřístupní jen vlastní členství", async () => {
  const db = await databaseWithFixtures();
  await db.exec(`SET ROLE develocrm_app; SELECT set_config('app.user_id', '${ids.userA}', false);`);
  const result = await db.query<{ tenant_id: string }>("SELECT tenant_id FROM tenant_memberships ORDER BY tenant_id");
  assert.deepEqual(result.rows.map((row) => row.tenant_id), [ids.tenantA]);
  await db.close();
});

test("RLS izoluje tenantové role a odmítne zápis do cizího tenantu", async () => {
  const db = await databaseWithFixtures();
  await db.exec(`
    SET ROLE develocrm_app;
    SELECT set_config('app.user_id', '${ids.userA}', false);
    SELECT set_config('app.tenant_id', '${ids.tenantA}', false);
  `);
  const visible = await db.query<{ tenant_id: string }>("SELECT tenant_id FROM roles");
  assert.deepEqual(visible.rows.map((row) => row.tenant_id), [ids.tenantA]);
  await assert.rejects(
    db.query("INSERT INTO roles (tenant_id, code, name) VALUES ($1, 'sales', 'Sales')", [ids.tenantB]),
    /row-level security|violates row-level security/i,
  );
  await db.close();
});

test("kompozitní cizí klíče zakážou přiřazení role napříč tenanty", async () => {
  const db = await databaseWithFixtures();
  await assert.rejects(
    db.query(
      "INSERT INTO role_assignments (tenant_id, membership_id, role_id, assigned_by_user_id) VALUES ($1, $2, $3, $4)",
      [ids.tenantA, ids.memberA, ids.roleB, ids.userA],
    ),
    /foreign key/i,
  );
  await db.close();
});

test("všechny tenantové tabulky mají zapnuté a vynucené RLS", async () => {
  const db = await databaseWithFixtures();
  const tenantTables = [
    "audit_log", "outbox_events", "role_assignments", "role_permissions", "roles",
    "tenant_identity_providers", "tenant_memberships", "tenants",
  ];
  const result = await db.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
    `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
     WHERE relname = ANY($1::text[]) ORDER BY relname`,
    [tenantTables],
  );
  assert.equal(result.rows.length, tenantTables.length);
  assert.ok(result.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity));
  await db.close();
});

test("unikátní a stavové constraints odmítnou nekonzistentní členství", async () => {
  const db = await databaseWithFixtures();
  await assert.rejects(
    db.query(
      "INSERT INTO tenant_memberships (tenant_id, user_id, status) VALUES ($1, $2, 'active')",
      [ids.tenantA, ids.userB],
    ),
    /tenant_memberships_active_accepted/i,
  );
  await assert.rejects(
    db.query(
      "INSERT INTO tenant_memberships (tenant_id, user_id, status, accepted_at) VALUES ($1, $2, 'active', now())",
      [ids.tenantA, ids.userA],
    ),
    /tenant_membership_uq/i,
  );
  await db.close();
});

test("auditní záznam je append-only", async () => {
  const db = await databaseWithFixtures();
  const auditId = "50000000-0000-4000-8000-000000000001";
  await db.query(
    "INSERT INTO audit_log (id, tenant_id, action, entity_type) VALUES ($1, $2, 'tenant.created', 'tenant')",
    [auditId, ids.tenantA],
  );
  await assert.rejects(db.query("DELETE FROM audit_log WHERE id = $1", [auditId]), /append-only/i);
  await db.close();
});

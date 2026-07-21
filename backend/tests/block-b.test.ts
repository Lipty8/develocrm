import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { InventoryRepository } from "../src/inventory/repository.js";
import type { Database } from "../src/database.js";

const id = {
  tenantA: "11000000-0000-4000-8000-000000000001", tenantB: "11000000-0000-4000-8000-000000000002",
  userA: "21000000-0000-4000-8000-000000000001", userB: "21000000-0000-4000-8000-000000000002",
  memberA: "31000000-0000-4000-8000-000000000001", memberB: "31000000-0000-4000-8000-000000000002",
  roleA: "41000000-0000-4000-8000-000000000001", roleB: "41000000-0000-4000-8000-000000000002",
  projectA: "51000000-0000-4000-8000-000000000001", projectB: "51000000-0000-4000-8000-000000000002",
  stageA: "61000000-0000-4000-8000-000000000001", buildingA: "61000000-0000-4000-8000-000000000002",
  sectionA: "61000000-0000-4000-8000-000000000003", sectionA2: "61000000-0000-4000-8000-000000000004",
  buildingB: "61000000-0000-4000-8000-000000000005",
  unitA: "71000000-0000-4000-8000-000000000001", unitA2: "71000000-0000-4000-8000-000000000002",
  unitB: "71000000-0000-4000-8000-000000000003",
  parkingTypeA: "81000000-0000-4000-8000-000000000001", sharedTypeA: "81000000-0000-4000-8000-000000000002",
  parkingA: "91000000-0000-4000-8000-000000000001", sharedA: "91000000-0000-4000-8000-000000000002",
};

async function blockBDatabase() {
  const db = new PGlite();
  for (const name of ["0001_block_a_identity.sql", "0002_block_b_inventory.sql"]) {
    await db.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  }
  await db.exec(`
    INSERT INTO tenants (id, name, slug) VALUES ('${id.tenantA}', 'Tenant A', 'tenant-a'), ('${id.tenantB}', 'Tenant B', 'tenant-b');
    INSERT INTO users (id, entra_issuer, entra_subject, email, display_name) VALUES
      ('${id.userA}', 'issuer-a', 'subject-a', 'a@example.test', 'User A'),
      ('${id.userB}', 'issuer-b', 'subject-b', 'b@example.test', 'User B');
    INSERT INTO tenant_memberships (id, tenant_id, user_id, status, accepted_at) VALUES
      ('${id.memberA}', '${id.tenantA}', '${id.userA}', 'active', now()),
      ('${id.memberB}', '${id.tenantB}', '${id.userB}', 'active', now());
    INSERT INTO roles (id, tenant_id, code, name) VALUES
      ('${id.roleA}', '${id.tenantA}', 'project_manager', 'Project Manager'),
      ('${id.roleB}', '${id.tenantB}', 'project_manager', 'Project Manager');
    INSERT INTO projects (id, tenant_id, code, name, slug, manager_membership_id) VALUES
      ('${id.projectA}', '${id.tenantA}', 'PA', 'Project A', 'project-a', '${id.memberA}'),
      ('${id.projectB}', '${id.tenantB}', 'PB', 'Project B', 'project-b', '${id.memberB}');
    INSERT INTO project_structures (id, tenant_id, project_id, parent_id, kind, code, name) VALUES
      ('${id.stageA}', '${id.tenantA}', '${id.projectA}', NULL, 'stage', 'S1', 'Stage 1'),
      ('${id.buildingA}', '${id.tenantA}', '${id.projectA}', '${id.stageA}', 'building', 'BA', 'Building A'),
      ('${id.sectionA}', '${id.tenantA}', '${id.projectA}', '${id.buildingA}', 'section', 'SA', 'Section A'),
      ('${id.sectionA2}', '${id.tenantA}', '${id.projectA}', '${id.sectionA}', 'section', 'SA2', 'Section A2'),
      ('${id.buildingB}', '${id.tenantB}', '${id.projectB}', NULL, 'building', 'BB', 'Building B');
    INSERT INTO units (id, tenant_id, project_id, structure_id, code, layout, area_m2) VALUES
      ('${id.unitA}', '${id.tenantA}', '${id.projectA}', '${id.sectionA2}', 'A101', '2+kk', 55),
      ('${id.unitA2}', '${id.tenantA}', '${id.projectA}', '${id.sectionA2}', 'A102', '3+kk', 75),
      ('${id.unitB}', '${id.tenantB}', '${id.projectB}', '${id.buildingB}', 'B101', '2+kk', 50);
    INSERT INTO accessory_types (id, tenant_id, code, name, category, allows_sharing) VALUES
      ('${id.parkingTypeA}', '${id.tenantA}', 'parking', 'Parking', 'parking', false),
      ('${id.sharedTypeA}', '${id.tenantA}', 'garden', 'Shared garden', 'other', true);
    INSERT INTO accessories (id, tenant_id, project_id, accessory_type_id, code) VALUES
      ('${id.parkingA}', '${id.tenantA}', '${id.projectA}', '${id.parkingTypeA}', 'P01'),
      ('${id.sharedA}', '${id.tenantA}', '${id.projectA}', '${id.sharedTypeA}', 'G01');
  `);
  return db;
}

test("blok B nevytváří tabulky bloků C a D", async () => {
  const db = await blockBDatabase();
  const result = await db.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname='public'");
  const names = new Set(result.rows.map((row) => row.tablename));
  for (const forbidden of ["parties", "interests", "sales_cases", "holds", "contracts", "unit_price_history"]) assert.equal(names.has(forbidden), false);
  await db.close();
});

test("preview seed je opakovatelný a zachová známé projekty a jednotky", async () => {
  const db = new PGlite();
  for (const name of ["0001_block_a_identity.sql", "0002_block_b_inventory.sql"]) {
    await db.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  }
  const seed = await readFile(new URL("../seeds/0001_preview_block_b.sql", import.meta.url), "utf8");
  await db.exec(seed);
  await db.exec(seed);
  const projects = await db.query<{ name: string }>("SELECT name FROM projects ORDER BY name");
  const units = await db.query<{ code: string }>("SELECT code FROM units ORDER BY code");
  assert.deepEqual(projects.rows.map((row) => row.name), ["Parková čtvrť", "Rezidence Javorová", "Vily Stráň"]);
  assert.deepEqual(units.rows.map((row) => row.code), ["A101", "A203", "A305", "B104", "B207", "B308", "C102", "C211", "D404", "E106"]);
  assert.equal((await db.query("SELECT id FROM accessory_price_history")).rows.length, 20);
  await db.close();
});

test("inventory repository vrátí seedované projekty a jednotky přes RBAC", async () => {
  const db = new PGlite();
  for (const name of ["0001_block_a_identity.sql", "0002_block_b_inventory.sql"]) {
    await db.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  }
  await db.exec(await readFile(new URL("../seeds/0001_preview_block_b.sql", import.meta.url), "utf8"));
  const adapter = {
    withContext: async <T>(context: { tenantId?: string; userId?: string }, work: (client: { query: typeof db.query }) => Promise<T>) => {
      await db.exec(`SET ROLE develocrm_app; SELECT set_config('app.user_id','${context.userId ?? ""}',false); SELECT set_config('app.tenant_id','${context.tenantId ?? ""}',false);`);
      return work({ query: db.query.bind(db) });
    },
  } as unknown as Database;
  const repository = new InventoryRepository(adapter);
  const catalog = await repository.getCatalog({
    tenantId: "d0000000-0000-4000-8000-000000000001",
    userId: "d1000000-0000-4000-8000-000000000001",
    membershipId: "d3000000-0000-4000-8000-000000000001",
  });
  assert.equal(catalog.projects.length, 3);
  assert.equal(catalog.units.length, 10);
  assert.equal(catalog.units.find((unit) => unit.code === "A203")?.accessories.length, 3);
  await db.close();
});

test("RLS izoluje projekty a jednotky mezi tenanty", async () => {
  const db = await blockBDatabase();
  await db.exec(`SET ROLE develocrm_app; SELECT set_config('app.user_id','${id.userA}',false); SELECT set_config('app.tenant_id','${id.tenantA}',false);`);
  const projects = await db.query<{ id: string }>("SELECT id FROM projects");
  const units = await db.query<{ id: string }>("SELECT id FROM units ORDER BY id");
  assert.deepEqual(projects.rows.map((row) => row.id), [id.projectA]);
  assert.deepEqual(units.rows.map((row) => row.id), [id.unitA, id.unitA2]);
  await assert.rejects(db.query("INSERT INTO units (tenant_id,project_id,code,area_m2) VALUES ($1,$2,'X1',40)", [id.tenantB, id.projectB]), /row-level security/i);
  await db.close();
});

test("všechny tabulky bloku B mají ENABLE a FORCE RLS", async () => {
  const db = await blockBDatabase();
  const tables = ["projects","project_structures","construction_status_events","units","unit_completion_status_events",
    "unit_commercial_status_events","accessory_types","accessories","accessory_relations","unit_accessory_assignments",
    "accessory_price_history","project_role_assignments"];
  const result = await db.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
    "SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=ANY($1::text[])", [tables],
  );
  assert.equal(result.rows.length, tables.length);
  assert.ok(result.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity));
  await db.close();
});

test("hierarchie odmítne cyklus i parent z jiného projektu", async () => {
  const db = await blockBDatabase();
  await assert.rejects(db.query("UPDATE project_structures SET parent_id=$1 WHERE id=$2", [id.sectionA2, id.sectionA]), /cycle/i);
  await assert.rejects(db.query(
    "UPDATE project_structures SET parent_id=$1 WHERE id=$2",
    [id.buildingB, id.sectionA],
  ), /foreign key/i);
  await db.close();
});

test("project-scoped role má skutečné tenantové FK a je izolovaná RLS", async () => {
  const db = await blockBDatabase();
  await db.query(
    "INSERT INTO role_permissions (tenant_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE code IN ('project.read','unit.read')",
    [id.tenantA, id.roleA],
  );
  await assert.rejects(db.query(
    "INSERT INTO project_role_assignments (tenant_id,project_id,membership_id,role_id,assigned_by_user_id) VALUES ($1,$2,$3,$4,$5)",
    [id.tenantA, id.projectA, id.memberA, id.roleB, id.userA],
  ), /foreign key/i);
  await db.query(
    "INSERT INTO project_role_assignments (tenant_id,project_id,membership_id,role_id,assigned_by_user_id) VALUES ($1,$2,$3,$4,$5)",
    [id.tenantA, id.projectA, id.memberA, id.roleA, id.userA],
  );
  await db.exec(`SET ROLE develocrm_app; SELECT set_config('app.user_id','${id.userA}',false); SELECT set_config('app.tenant_id','${id.tenantA}',false);`);
  assert.equal((await db.query<{ allowed: boolean }>(
    "SELECT app.has_project_permission($1,$2,$3,'unit.read') allowed",
    [id.tenantA, id.memberA, id.projectA],
  )).rows[0].allowed, true);
  await db.exec("RESET ROLE");
  await db.exec(`SET ROLE develocrm_app; SELECT set_config('app.user_id','${id.userB}',false); SELECT set_config('app.tenant_id','${id.tenantB}',false);`);
  assert.equal((await db.query("SELECT id FROM project_role_assignments")).rows.length, 0);
  await db.close();
});

test("nesdílené příslušenství nelze časově přiřadit dvěma jednotkám", async () => {
  const db = await blockBDatabase();
  await db.query(
    "INSERT INTO unit_accessory_assignments (tenant_id,project_id,unit_id,accessory_id,valid_from,assigned_by_membership_id) VALUES ($1,$2,$3,$4,'2026-01-01',$5)",
    [id.tenantA, id.projectA, id.unitA, id.parkingA, id.memberA],
  );
  await assert.rejects(db.query(
    "INSERT INTO unit_accessory_assignments (tenant_id,project_id,unit_id,accessory_id,valid_from,assigned_by_membership_id) VALUES ($1,$2,$3,$4,'2026-02-01',$5)",
    [id.tenantA, id.projectA, id.unitA2, id.parkingA, id.memberA],
  ), /overlaps/i);
  await db.query(
    "INSERT INTO unit_accessory_assignments (tenant_id,project_id,unit_id,accessory_id,valid_from,assigned_by_membership_id) VALUES ($1,$2,$3,$4,'2026-01-01',$5),($1,$2,$6,$4,'2026-01-01',$5)",
    [id.tenantA, id.projectA, id.unitA, id.sharedA, id.memberA, id.unitA2],
  );
  await db.close();
});

test("ceny příslušenství jsou nepřekrývající a append-only", async () => {
  const db = await blockBDatabase();
  const priceId = "a1000000-0000-4000-8000-000000000001";
  await db.query(
    "INSERT INTO accessory_price_history (id,tenant_id,project_id,accessory_id,amount,valid_from,reason,recorded_by_membership_id) VALUES ($1,$2,$3,$4,500000,'2026-01-01','Ceník Q1',$5)",
    [priceId, id.tenantA, id.projectA, id.parkingA, id.memberA],
  );
  await assert.rejects(db.query(
    "INSERT INTO accessory_price_history (tenant_id,project_id,accessory_id,amount,valid_from,reason,recorded_by_membership_id) VALUES ($1,$2,$3,510000,'2026-01-01','Duplicitní počátek',$4)",
    [id.tenantA, id.projectA, id.parkingA, id.memberA],
  ), /accessory_price_effective_uq|unique/i);
  await db.query(
    "INSERT INTO accessory_price_history (tenant_id,project_id,accessory_id,amount,valid_from,reason,recorded_by_membership_id) VALUES ($1,$2,$3,510000,'2026-07-01','Ceník Q2',$4)",
    [id.tenantA, id.projectA, id.parkingA, id.memberA],
  );
  const intervals = await db.query<{ valid_from: string; valid_to: string | null }>(
    `SELECT valid_from::text, lead(valid_from) OVER (PARTITION BY accessory_id ORDER BY valid_from)::text AS valid_to
     FROM accessory_price_history WHERE accessory_id=$1 ORDER BY valid_from`, [id.parkingA],
  );
  assert.equal(intervals.rows.length, 2);
  assert.match(intervals.rows[0].valid_to ?? "", /2026-07-01/);
  await assert.rejects(db.query("UPDATE accessory_price_history SET amount=1 WHERE id=$1", [priceId]), /append-only/i);
  await db.close();
});

test("stavební stav se dědí a explicitní override lze append-only zrušit", async () => {
  const db = await blockBDatabase();
  await db.query(
    "INSERT INTO construction_status_events (tenant_id,project_id,structure_id,status_code,effective_at,recorded_by_membership_id) VALUES ($1,$2,NULL,'construction','2026-01-01',$3),($1,$2,$4,'fit_out','2026-02-01',$3)",
    [id.tenantA, id.projectA, id.memberA, id.buildingA],
  );
  assert.equal((await db.query<{ status: string }>("SELECT app.effective_unit_construction_status($1,$2) status", [id.tenantA, id.unitA])).rows[0].status, "fit_out");
  await db.query(
    "INSERT INTO unit_completion_status_events (tenant_id,project_id,unit_id,event_type,status_code,effective_at,reason,recorded_by_membership_id) VALUES ($1,$2,$3,'set_override','completed','2026-03-01','Individuálně dokončeno',$4)",
    [id.tenantA, id.projectA, id.unitA, id.memberA],
  );
  assert.equal((await db.query<{ status: string }>("SELECT app.effective_unit_construction_status($1,$2) status", [id.tenantA, id.unitA])).rows[0].status, "completed");
  await db.query(
    "INSERT INTO unit_completion_status_events (tenant_id,project_id,unit_id,event_type,status_code,effective_at,reason,recorded_by_membership_id) VALUES ($1,$2,$3,'clear_override',NULL,'2026-04-01','Návrat k budově',$4)",
    [id.tenantA, id.projectA, id.unitA, id.memberA],
  );
  assert.equal((await db.query<{ status: string }>("SELECT app.effective_unit_construction_status($1,$2) status", [id.tenantA, id.unitA])).rows[0].status, "fit_out");
  await assert.rejects(db.query("DELETE FROM construction_status_events"), /append-only/i);
  await db.close();
});

test("obchodní status nelze přepsat přímo a doménový příkaz zapisuje historii, audit i outbox", async () => {
  const db = await blockBDatabase();
  await assert.rejects(db.query("UPDATE units SET commercial_status='blocked' WHERE id=$1", [id.unitA]), /domain command/i);
  await db.exec(`SET ROLE develocrm_app; SELECT set_config('app.user_id','${id.userA}',false); SELECT set_config('app.tenant_id','${id.tenantA}',false);`);
  await db.query("SELECT app.transition_unit_commercial_status($1,$2,'blocked','blockUnit','Dočasně staženo z nabídky',$3)", [id.tenantA, id.unitA, id.memberA]);
  assert.equal((await db.query<{ commercial_status: string }>("SELECT commercial_status FROM units WHERE id=$1", [id.unitA])).rows[0].commercial_status, "blocked");
  assert.equal((await db.query("SELECT id FROM unit_commercial_status_events WHERE unit_id=$1", [id.unitA])).rows.length, 1);
  assert.equal((await db.query("SELECT id FROM audit_log WHERE entity_id=$1", [id.unitA])).rows.length, 1);
  assert.equal((await db.query("SELECT id FROM outbox_events WHERE aggregate_id=$1", [id.unitA])).rows.length, 1);
  await assert.rejects(
    db.query("SELECT app.transition_unit_commercial_status($1,$2,'pre_reserved','createPreReservation','Bez zdrojového hold modulu',$3)", [id.tenantA, id.unitA2, id.memberA]),
    /requires its source module/i,
  );
  await db.close();
});

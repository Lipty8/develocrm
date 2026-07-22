import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { Database } from "../src/database.js";
import { DocumentRepository } from "../src/documents/repository.js";
import { GraphUnavailableError, PreviewGraphAdapter } from "../src/documents/graph-adapter.js";
import { SharePointFolderStrategy } from "../src/documents/folder-strategy.js";
import { planDocumentDelta } from "../src/documents/sync-service.js";

const tenant = "d0000000-0000-4000-8000-000000000001";
const user = "d1000000-0000-4000-8000-000000000001";
const member = "d3000000-0000-4000-8000-000000000001";
const project = "e0000000-0000-4000-8000-000000000001";
const unit = "f0000000-0000-4000-8000-000000000001";
const party = "c0000000-0000-4000-8000-000000000001";
const contract = "bd200000-0000-4000-8000-000000000001";
const contractVersion = "bd300000-0000-4000-8000-000000000004";

const beforeSeed = [
  "0001_block_a_identity.sql", "0002_block_b_inventory.sql", "0003_block_c_sales.sql",
  "0004_block_d_pricing_contracts.sql", "0005_pilot_import_compatibility.sql", "0006_crud_operations.sql",
];
const afterSeed = ["0007_practical_editing_rbac.sql", "0008_completion_workflows.sql", "0009_documents_sharepoint_foundation.sql"];

async function database() {
  const db = new PGlite();
  for (const name of beforeSeed) await db.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  for (const name of ["0001_preview_block_b.sql", "0002_preview_block_c.sql", "0003_preview_block_d.sql"]) await db.exec(await readFile(new URL(`../seeds/${name}`, import.meta.url), "utf8"));
  for (const name of afterSeed) await db.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  return db;
}

async function asApp(db: PGlite, userId = user, tenantId = tenant) {
  await db.exec(`SET ROLE develocrm_app; SELECT set_config('app.user_id','${userId}',false); SELECT set_config('app.tenant_id','${tenantId}',false);`);
}

async function asRoot(db: PGlite) { await db.exec("RESET ROLE"); }

async function createDocument(db: PGlite, name = "Půdorys A203.pdf", sensitivity = "normal") {
  const result = await db.query<{ id: string }>(
    "SELECT app.create_document_metadata($1,$2,$3,'floor_plan','application/pdf',1234,'external',NULL,NULL,NULL,'etag-1',$4,$5,'import') id",
    [tenant, project, name, sensitivity, member],
  );
  return result.rows[0].id;
}

test("migrace dokumentů zavede konkrétní vazby, composite FK, RLS a FORCE", async () => {
  const db = await database();
  const tables = ["sharepoint_connections", "document_sync_cursors", "documents", "document_versions", "project_documents", "unit_documents", "party_documents", "contract_documents"];
  const security = await db.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
    "SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=ANY($1::text[])", [tables],
  );
  assert.equal(security.rows.length, tables.length);
  assert.ok(security.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity));
  const linkTables = await db.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('project_documents','unit_documents','party_documents','contract_documents')");
  assert.equal(linkTables.rows.length, 4);
  assert.equal((await db.query("SELECT table_name FROM information_schema.tables WHERE table_name='document_links'")).rows.length, 0);
  await db.close();
});

test("create, link a version operace jsou auditované a emitují outbox", async () => {
  const db = await database();
  await asApp(db);
  const documentId = await createDocument(db);
  const documentVersionId = (await db.query<{ id: string }>(
    "SELECT app.create_document_version($1,$2,'graph-v1','1.0','1.0','etag-2',1400,'sha256:test',$3) id", [tenant, documentId, member],
  )).rows[0].id;
  await db.query("SELECT app.link_document_to_project($1,$2,$3,$4)", [tenant, documentId, project, member]);
  await db.query("SELECT app.link_document_to_unit($1,$2,$3,$4)", [tenant, documentId, unit, member]);
  await db.query("SELECT app.link_document_to_party($1,$2,$3,$4)", [tenant, documentId, party, member]);
  await db.query("SELECT app.link_document_to_contract($1,$2,$3,$4,$5,$6)", [tenant, documentId, contract, contractVersion, documentVersionId, member]);
  assert.equal((await db.query("SELECT id FROM project_documents WHERE document_id=$1", [documentId])).rows.length, 1);
  assert.equal((await db.query("SELECT id FROM unit_documents WHERE document_id=$1", [documentId])).rows.length, 1);
  assert.equal((await db.query("SELECT id FROM party_documents WHERE document_id=$1", [documentId])).rows.length, 1);
  assert.equal((await db.query("SELECT id FROM contract_documents WHERE document_id=$1 AND contract_version_id=$2 AND document_version_id=$3", [documentId, contractVersion, documentVersionId])).rows.length, 1);
  assert.ok((await db.query("SELECT id FROM audit_log WHERE entity_id IN ($1,$2)", [documentId, documentVersionId])).rows.length >= 2);
  assert.ok((await db.query("SELECT id FROM outbox_events WHERE aggregate_id=$1 AND event_type LIKE 'document.%'", [documentId])).rows.length >= 6);
  await db.close();
});

test("document_versions jsou oddělené od contract_versions a append-only", async () => {
  const db = await database();
  await asApp(db);
  const documentId = await createDocument(db);
  const versionId = (await db.query<{ id: string }>("SELECT app.create_document_version($1,$2,'local-1',NULL,'1.0',NULL,NULL,NULL,$3) id", [tenant, documentId, member])).rows[0].id;
  await asRoot(db);
  await assert.rejects(db.query("UPDATE document_versions SET version_label='2.0' WHERE id=$1", [versionId]), /append-only/i);
  assert.equal((await db.query("SELECT id FROM contract_versions WHERE id=$1", [versionId])).rows.length, 0);
  await db.close();
});

test("přejmenování projektu a jednotky nezruší vazbu dokumentu", async () => {
  const db = await database();
  await asApp(db);
  const documentId = await createDocument(db);
  await db.query("SELECT app.link_document_to_unit($1,$2,$3,$4)", [tenant, documentId, unit, member]);
  await asRoot(db);
  await db.query("UPDATE projects SET name='Rezidence Javorová – nové jméno' WHERE id=$1", [project]);
  await db.query("UPDATE units SET code='A203-N' WHERE id=$1", [unit]);
  assert.equal((await db.query("SELECT id FROM unit_documents WHERE document_id=$1 AND unit_id=$2", [documentId, unit])).rows.length, 1);
  await db.close();
});

test("archivace zachová historii a vazby, ale dokument zmizí z běžného seznamu", async () => {
  const db = await database();
  await asApp(db);
  const documentId = await createDocument(db);
  await db.query("SELECT app.link_document_to_project($1,$2,$3,$4)", [tenant, documentId, project, member]);
  await db.query("SELECT app.archive_document($1,$2,$3,'Dokument nahrazen novou verzí')", [tenant, documentId, member]);
  assert.equal((await db.query("SELECT id FROM project_documents WHERE document_id=$1", [documentId])).rows.length, 1);
  assert.equal((await db.query("SELECT id FROM documents WHERE id=$1 AND archived_at IS NOT NULL", [documentId])).rows.length, 1);
  await db.close();
});

test("cross-tenant RLS izoluje dokumenty i jejich vazby", async () => {
  const db = await database();
  await db.exec(`
    INSERT INTO tenants(id,name,slug) VALUES('aa000000-0000-4000-8000-000000000001','Other tenant','other-docs');
    INSERT INTO users(id,entra_issuer,entra_subject,email,display_name) VALUES('aa100000-0000-4000-8000-000000000001','other','docs','docs@other.test','Other User');
    INSERT INTO tenant_memberships(id,tenant_id,user_id,status,accepted_at) VALUES('aa200000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000001','aa100000-0000-4000-8000-000000000001','active',now());
    INSERT INTO projects(id,tenant_id,code,name,slug) VALUES('aa300000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000001','OD','Other docs','other-docs-project');
    INSERT INTO documents(id,tenant_id,project_id,name,category,mime_type,storage_provider,created_by_membership_id)
      VALUES('aa400000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000001','aa300000-0000-4000-8000-000000000001','Secret.pdf','other','application/pdf','external','aa200000-0000-4000-8000-000000000001');
  `);
  await asApp(db);
  assert.equal((await db.query("SELECT id FROM documents WHERE id='aa400000-0000-4000-8000-000000000001'")).rows.length, 0);
  await assert.rejects(db.query("SELECT app.link_document_to_project($1,'aa400000-0000-4000-8000-000000000001',$2,$3)", [tenant, project, member]), /permission required/i);
  await db.close();
});

test("repository u project-scoped uživatele vrátí pouze povolený projekt", async () => {
  const db = await database();
  await asRoot(db);
  await db.query("INSERT INTO documents(tenant_id,project_id,name,category,mime_type,storage_provider,created_by_membership_id) VALUES($1,$2,'RJ.pdf','other','application/pdf','external',$3),($1,'e0000000-0000-4000-8000-000000000002','PC.pdf','other','application/pdf','external',$3)", [tenant, project, member]);
  const adapter = { withContext: async <T>(context: { tenantId?: string; userId?: string }, work: (client: { query: typeof db.query }) => Promise<T>) => {
    await db.exec(`SET ROLE develocrm_app; SELECT set_config('app.user_id','${context.userId ?? ""}',false); SELECT set_config('app.tenant_id','${context.tenantId ?? ""}',false);`);
    return work({ query: db.query.bind(db) });
  } } as unknown as Database;
  const repository = new DocumentRepository(adapter);
  const context = { tenantId: tenant, userId: "d1000000-0000-4000-8000-000000000002", membershipId: "d3000000-0000-4000-8000-000000000002" };
  assert.equal((await repository.listProject({ ...context, projectId: project })).length, 1);
  assert.equal((await repository.listProject({ ...context, projectId: "e0000000-0000-4000-8000-000000000002" })).length, 0);
  await db.close();
});

test("citlivý dokument vyžaduje documents.view_sensitive", async () => {
  const db = await database();
  await asApp(db);
  const documentId = await createDocument(db, "Citlivý doklad.pdf", "sensitive");
  await asRoot(db);
  await db.query("DELETE FROM role_permissions WHERE tenant_id=$1 AND role_id='d4000000-0000-4000-8000-000000000002' AND permission_id=(SELECT id FROM permissions WHERE code='documents.view_sensitive')", [tenant]);
  const adapter = { withContext: async <T>(context: { tenantId?: string; userId?: string }, work: (client: { query: typeof db.query }) => Promise<T>) => {
    await db.exec(`SET ROLE develocrm_app; SELECT set_config('app.user_id','${context.userId ?? ""}',false); SELECT set_config('app.tenant_id','${context.tenantId ?? ""}',false);`);
    return work({ query: db.query.bind(db) });
  } } as unknown as Database;
  const repository = new DocumentRepository(adapter);
  const result = await repository.getById({ tenantId: tenant, userId: "d1000000-0000-4000-8000-000000000002", membershipId: "d3000000-0000-4000-8000-000000000002", documentId });
  assert.equal(result, null);
  await db.close();
});

test("SharePoint connection odmítá plaintext secret a bez konfigurace hlásí not_configured", async () => {
  const db = await database();
  await assert.rejects(db.query("INSERT INTO sharepoint_connections(tenant_id,name,credential_reference,created_by_membership_id) VALUES($1,'Unsafe','client-secret-plain',$2)", [tenant, member]), /sharepoint_connections_secret_shape|check constraint/i);
  const adapter = { withContext: async <T>(_context: unknown, work: (client: { query: typeof db.query }) => Promise<T>) => work({ query: db.query.bind(db) }) } as unknown as Database;
  assert.equal((await new DocumentRepository(adapter).connectionStatus({ tenantId: tenant, userId: user, membershipId: member })).status, "not_configured");
  await db.close();
});

test("preview Graph adapter je skutečný no-op a nevyrábí falešná ID", async () => {
  const graph = new PreviewGraphAdapter();
  assert.deepEqual(await graph.listFiles({ driveId: "", siteId: "" }), []);
  assert.equal(await graph.getFileMetadata({ driveId: "", siteId: "" }, "missing"), null);
  await assert.rejects(graph.uploadFile({ driveId: "", siteId: "" }, "root", "x.pdf", new Uint8Array(), "application/pdf"), GraphUnavailableError);
});

test("folder strategy je konfigurovatelná a používá stabilní identifikátory", () => {
  const strategy = new SharePointFolderStrategy();
  const before = strategy.unitDocuments({ projectId: project, projectCode: "RJ", unitId: unit, unitCode: "A203", category: "floor_plan" });
  const after = strategy.unitDocuments({ projectId: project, projectCode: "Rezidence Javorová", unitId: unit, unitCode: "Byt A203", category: "floor_plan" });
  assert.match(before.join("/"), /e00000000000/);
  assert.match(after.join("/"), /f00000000000/);
  assert.equal(before.at(-1), "floor-plans");
});

test("delta plán je idempotentní pro přímý upload, novou verzi, přejmenování i smazání", () => {
  const current = [
    { documentId: "doc-1", externalItemId: "item-1", name: "Smlouva.pdf", etag: "v1", webUrl: "https://example.invalid/old", archived: false },
    { documentId: "doc-2", externalItemId: "item-2", name: "Starý.pdf", etag: "v1", webUrl: null, archived: false },
  ];
  const delta = {
    items: [
      { driveId: "drive", itemId: "item-1", name: "Smlouva-final.pdf", mimeType: "application/pdf", size: 20, etag: "v2", webUrl: "https://example.invalid/new", parentItemId: "folder-2", isFolder: false },
      { driveId: "drive", itemId: "item-3", name: "Nový.pdf", mimeType: "application/pdf", size: 10, etag: "v1", webUrl: null, parentItemId: "folder-1", isFolder: false },
    ],
    deletedItemIds: ["item-2"], nextCursor: "delta-link",
  };
  const actions = planDocumentDelta(current, delta);
  assert.deepEqual(actions.map((action) => action.type), ["update_metadata", "append_version", "import_metadata", "archive"]);
  const replayState = [
    { ...current[0], name: "Smlouva-final.pdf", etag: "v2", webUrl: "https://example.invalid/new" },
    { ...current[1], archived: true },
    { documentId: "doc-3", externalItemId: "item-3", name: "Nový.pdf", etag: "v1", webUrl: null, archived: false },
  ];
  assert.deepEqual(planDocumentDelta(replayState, delta), []);
});

test("composite FK odmítne vazbu dokumentu na jednotku jiného projektu", async () => {
  const db = await database();
  await asApp(db);
  const documentId = await createDocument(db);
  await assert.rejects(db.query("SELECT app.link_document_to_unit($1,$2,'f0000000-0000-4000-8000-000000000007',$3)", [tenant, documentId, member]), /permission required/i);
  await db.close();
});

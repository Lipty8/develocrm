import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {PGlite} from "@electric-sql/pglite";
import {
  availableContractTransitions,
  contractStatusLabel,
  isValidContractTransition,
  recommendedContractAction,
} from "../src/shared/contract-workflow.js";

test("centrální workflow vrací pouze validní přechody a vždy čerstvou doporučenou akci",()=>{
  assert.deepEqual(availableContractTransitions("draft"),["sent","cancelled"]);
  assert.equal(isValidContractTransition("draft","signed"),false);
  assert.equal(recommendedContractAction({status:"draft",type:"SBK"}).label,"Odeslat SBK");
  assert.equal(recommendedContractAction({status:"negotiation",type:"SBK"}).label,"Zapracovat připomínky");
  assert.equal(recommendedContractAction({status:"signed",type:"SBK"}).tone,"neutral");
  assert.equal(contractStatusLabel("approved"),"Schválena");
});

test("stabilní řazení zachová deterministický sekundární klíč i po filtrování",async()=>{
  const {stableSort}=await import("../../app/lib/sorting.js");
  const rows=[
    {id:"c",project:"B",state:"sent"},
    {id:"b",project:"A",state:"draft"},
    {id:"a",project:"A",state:"draft"},
  ].filter(row=>row.project==="A");
  const sorted=stableSort(rows,row=>row.state,"asc",row=>row.id);
  assert.deepEqual(sorted.map(row=>row.id),["a","b"]);
});

test("migrace v31 přidává zdroj historie, role, RLS předání a auditovatelnou administraci",async()=>{
  const db=new PGlite();
  for(const name of ["0001_block_a_identity.sql","0002_block_b_inventory.sql","0003_block_c_sales.sql","0004_block_d_pricing_contracts.sql","0011_v31_workflow_and_administration.sql"]){
    await db.exec(await readFile(new URL(`../migrations/${name}`,import.meta.url),"utf8"));
  }
  const columns=await db.query<{column_name:string}>("SELECT column_name FROM information_schema.columns WHERE table_name='contract_status_events'");
  assert.ok(columns.rows.some(row=>row.column_name==="source"));
  const roles=await db.query<{code:string}>("SELECT code FROM roles WHERE code IN ('finance','handover_complaints','read_only')");
  assert.equal(roles.rows.length,0,"role templates are inserted only for an existing tenant");
  const handoverRls=await db.query<{relrowsecurity:boolean;relforcerowsecurity:boolean}>("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='unit_handovers'");
  assert.equal(handoverRls.rows[0].relrowsecurity,true);
  assert.equal(handoverRls.rows[0].relforcerowsecurity,true);
  await db.close();
});

test("celý řetězec migrací 0001–0011 projde nad existujícími pilotními daty",async()=>{
  const db=new PGlite();
  for(const name of ["0001_block_a_identity.sql","0002_block_b_inventory.sql","0003_block_c_sales.sql","0004_block_d_pricing_contracts.sql","0005_pilot_import_compatibility.sql","0006_crud_operations.sql"]){
    await db.exec(await readFile(new URL(`../migrations/${name}`,import.meta.url),"utf8"));
  }
  for(const name of ["0001_preview_block_b.sql","0002_preview_block_c.sql","0003_preview_block_d.sql"]){
    await db.exec(await readFile(new URL(`../seeds/${name}`,import.meta.url),"utf8"));
  }
  for(const name of ["0007_practical_editing_rbac.sql","0008_completion_workflows.sql","0009_documents_sharepoint_foundation.sql","0010_document_workspace.sql","0011_v31_workflow_and_administration.sql"]){
    await db.exec(await readFile(new URL(`../migrations/${name}`,import.meta.url),"utf8"));
  }
  const roles=await db.query<{code:string}>("SELECT code FROM roles WHERE code IN ('finance','handover_complaints','read_only') ORDER BY code");
  assert.deepEqual(roles.rows.map(row=>row.code),["finance","handover_complaints","read_only"]);
  assert.equal((await db.query("SELECT code FROM permissions WHERE code='users.manage'")).rows.length,1);
  await db.close();
});

test("users.manage zpřístupní pouze uživatele aktuálního workspace a dovolí bezpečnou pozvánku",async()=>{
  const db=new PGlite();
  for(const name of ["0001_block_a_identity.sql","0002_block_b_inventory.sql","0003_block_c_sales.sql","0004_block_d_pricing_contracts.sql","0011_v31_workflow_and_administration.sql"]){
    await db.exec(await readFile(new URL(`../migrations/${name}`,import.meta.url),"utf8"));
  }
  const tenantA="10000000-0000-4000-8000-000000000001";
  const tenantB="10000000-0000-4000-8000-000000000002";
  const admin="20000000-0000-4000-8000-000000000001";
  const colleague="20000000-0000-4000-8000-000000000002";
  const outsider="20000000-0000-4000-8000-000000000003";
  const adminMembership="30000000-0000-4000-8000-000000000001";
  const role="40000000-0000-4000-8000-000000000001";
  await db.exec(`
    INSERT INTO tenants(id,name,slug) VALUES
      ('${tenantA}','Tenant A','tenant-a'),('${tenantB}','Tenant B','tenant-b');
    INSERT INTO users(id,entra_issuer,entra_subject,email,display_name) VALUES
      ('${admin}','issuer','admin','admin@example.test','Admin'),
      ('${colleague}','issuer','colleague','colleague@example.test','Colleague'),
      ('${outsider}','issuer','outsider','outsider@example.test','Outsider');
    INSERT INTO tenant_memberships(id,tenant_id,user_id,status,accepted_at) VALUES
      ('${adminMembership}','${tenantA}','${admin}','active',now()),
      ('30000000-0000-4000-8000-000000000002','${tenantA}','${colleague}','active',now()),
      ('30000000-0000-4000-8000-000000000003','${tenantB}','${outsider}','active',now());
    INSERT INTO roles(id,tenant_id,code,name) VALUES('${role}','${tenantA}','workspace_admin','Workspace admin');
    INSERT INTO role_permissions(tenant_id,role_id,permission_id)
      SELECT '${tenantA}','${role}',id FROM permissions WHERE code='users.manage';
    INSERT INTO role_assignments(tenant_id,membership_id,role_id,assigned_by_user_id)
      VALUES('${tenantA}','${adminMembership}','${role}','${admin}');
    SET ROLE develocrm_app;
    SELECT set_config('app.tenant_id','${tenantA}',false);
    SELECT set_config('app.user_id','${admin}',false);
  `);
  const visible=await db.query<{email:string}>("SELECT email FROM users ORDER BY email");
  assert.deepEqual(visible.rows.map(row=>row.email),["admin@example.test","colleague@example.test"]);
  await db.query("UPDATE users SET work_phone='+420 222 111 000' WHERE id=$1",[colleague]);
  const invited="20000000-0000-4000-8000-000000000004";
  await db.query("INSERT INTO users(id,entra_issuer,entra_subject,email,display_name) VALUES($1,'pending','invited','new@example.test','New user')",[invited]);
  await db.query("INSERT INTO tenant_memberships(tenant_id,user_id,status,invited_at) VALUES($1,$2,'invited',now())",[tenantA,invited]);
  await assert.rejects(
    db.query("INSERT INTO tenant_memberships(tenant_id,user_id,status,invited_at) VALUES($1,$2,'invited',now())",[tenantB,invited]),
    /row-level security/i,
  );
  await db.close();
});

test("pražské datum drží kalendářní den i kolem UTC půlnoci",async()=>{
  const {addPragueCalendarDaysKey,formatPragueDate}=await import("../../app/lib/date-time.js");
  assert.equal(formatPragueDate("2026-01-01T23:30:00Z"),"2. 1. 2026");
  assert.equal(addPragueCalendarDaysKey(new Date("2026-03-28T23:30:00Z"),1),"2026-03-30");
});

import test from "node:test";
import assert from "node:assert/strict";
import {readFile,readdir} from "node:fs/promises";
import {PGlite} from "@electric-sql/pglite";
import {renderDejviceImport} from "../src/imports/dejvice.js";

const tenant="d0000000-0000-4000-8000-000000000001";

async function fixture(){
  const db=new PGlite();
  const migrations=(await readdir(new URL("../migrations/",import.meta.url))).filter(name=>name.endsWith(".sql")&&name<"0015").sort();
  for(const name of migrations)await db.exec(await readFile(new URL(`../migrations/${name}`,import.meta.url),"utf8"));
  for(const name of ["0001_preview_block_b.sql","0002_preview_block_c.sql","0003_preview_block_d.sql","0004_pilot_rezidence_dejvice.sql","0005_preview_documents.sql"]){
    const source=await readFile(new URL(`../seeds/${name}`,import.meta.url),"utf8");
    await db.exec(name==="0004_pilot_rezidence_dejvice.sql"
      ?`BEGIN;${renderDejviceImport(source,{tenantId:tenant,membershipId:"d3000000-0000-4000-8000-000000000001"})}COMMIT;`
      :source);
  }
  return db;
}

test("pilot cleanup archivuje jen přesně určené demo projekty a je idempotentní",async()=>{
  const db=await fixture();
  const cleanup=await readFile(new URL("../migrations/0015_pilot_demo_cleanup.sql",import.meta.url),"utf8");
  const dejviceBefore=(await db.query<{units:number;parties:number;contracts:number}>(
    `SELECT (SELECT count(*)::int FROM units WHERE tenant_id=$1 AND project_id=project.id AND archived_at IS NULL) units,
      (SELECT count(DISTINCT party_id)::int FROM party_project_links WHERE tenant_id=$1 AND project_id=project.id) parties,
      (SELECT count(*)::int FROM contracts WHERE tenant_id=$1 AND project_id=project.id) contracts
     FROM projects project WHERE tenant_id=$1 AND code='DEJ'`,[tenant])).rows[0];
  await db.exec(cleanup);
  await db.exec(cleanup);

  assert.deepEqual((await db.query<{name:string}>("SELECT name FROM projects WHERE tenant_id=$1 AND archived_at IS NULL ORDER BY name",[tenant])).rows.map(row=>row.name),["Rezidence Dejvice"]);
  assert.equal((await db.query("SELECT id FROM units WHERE tenant_id=$1 AND archived_at IS NULL",[tenant])).rows.length,19);
  const dejviceAfter=(await db.query<{units:number;parties:number;contracts:number}>(
    `SELECT (SELECT count(*)::int FROM units WHERE tenant_id=$1 AND project_id=project.id AND archived_at IS NULL) units,
      (SELECT count(DISTINCT party_id)::int FROM party_project_links WHERE tenant_id=$1 AND project_id=project.id) parties,
      (SELECT count(*)::int FROM contracts WHERE tenant_id=$1 AND project_id=project.id) contracts
     FROM projects project WHERE tenant_id=$1 AND code='DEJ'`,[tenant])).rows[0];
  assert.deepEqual(dejviceAfter,dejviceBefore);
  assert.equal((await db.query("SELECT cleanup_key FROM pilot_data_cleanup_runs WHERE tenant_id=$1",[tenant])).rows.length,1);
  assert.equal((await db.query("SELECT id FROM audit_log WHERE tenant_id=$1 AND action='pilot.demo_project_archived'",[tenant])).rows.length,3);
  assert.equal((await db.query("SELECT id FROM outbox_events WHERE tenant_id=$1 AND event_type='project.archived.v1'",[tenant])).rows.length,3);

  const report=(await db.query<{report:Record<string,unknown>}>("SELECT report FROM pilot_data_cleanup_runs WHERE tenant_id=$1",[tenant])).rows[0].report;
  assert.equal(report.sharedParties,0);
  assert.equal(report.units,10);
  assert.equal(report.parties,11);
  assert.equal(report.contracts,7);
  console.log("PILOT_CLEANUP_REPORT",JSON.stringify(report));
  await db.close();
});

test("preview pilot source neobsahuje demo projekty ani jejich vyhledatelné záznamy",async()=>{
  const source=await readFile(new URL("../../app/crm-data.ts",import.meta.url),"utf8");
  const documents=await readFile(new URL("../../app/api/documents/route.ts",import.meta.url),"utf8");
  const payments=await readFile(new URL("../../app/repositories/payment-repository.ts",import.meta.url),"utf8");
  for(const demo of ["Rezidence Javorová","Parková čtvrť","Vily Stráň"]){
    assert.doesNotMatch(source,new RegExp(demo));
    assert.doesNotMatch(documents,new RegExp(demo));
    assert.doesNotMatch(payments,new RegExp(demo));
  }
});

test("celý migrační řetězec včetně cleanupu funguje na čisté databázi",async()=>{
  const db=new PGlite();
  const migrations=(await readdir(new URL("../migrations/",import.meta.url))).filter(name=>name.endsWith(".sql")).sort();
  for(const name of migrations)await db.exec(await readFile(new URL(`../migrations/${name}`,import.meta.url),"utf8"));
  assert.equal((await db.query("SELECT cleanup_key FROM pilot_data_cleanup_runs")).rows.length,0);
  await db.close();
});

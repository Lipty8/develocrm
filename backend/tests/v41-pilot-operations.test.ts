import assert from "node:assert/strict";
import {readFile,readdir} from "node:fs/promises";
import test from "node:test";
import {PGlite} from "@electric-sql/pglite";
import {bootstrapIds,bootstrapPilotWorkspace,normalizeBootstrapInput} from "../src/iam/pilot-bootstrap.js";
import {importDejvice,renderDejviceImport} from "../src/imports/dejvice.js";
import {applyMigrations,migrationFromSource} from "../src/migrations/runner.js";

async function migrated(){
  const db=new PGlite();
  const directory=new URL("../migrations/",import.meta.url);
  for(const name of (await readdir(directory)).filter(name=>/^\d+.*\.sql$/.test(name)).sort())
    await db.exec(await readFile(new URL(name,directory),"utf8"));
  return db;
}
function clientFor(db:PGlite){
  return{query:async(sql:string,parameters?:unknown[])=>{
    if(!parameters&&sql.includes(";")){await db.exec(sql);return{rows:[],rowCount:null};}
    const result=await db.query(sql,parameters as never[]|undefined);return{rows:result.rows,rowCount:result.affectedRows??null};
  }} as never;
}
const bootstrapInput={
  entraTenantId:"10000000-0000-4000-8000-000000000041",adminOid:"20000000-0000-4000-8000-000000000041",
  adminEmail:"pilot.admin@example.test",adminName:"Pilot Admin",workspaceName:"Pilotní workspace",workspaceId:"30000000-0000-4000-8000-000000000041",
};

test("pilotní bootstrap vytvoří skutečného administrátora právě jednou",async()=>{
  const db=await migrated();const normalized=normalizeBootstrapInput(bootstrapInput);const ids=bootstrapIds(normalized);
  const input={...normalized,...ids};
  const client=clientFor(db);
  const first=await bootstrapPilotWorkspace(client,input);const second=await bootstrapPilotWorkspace(client,input);
  assert.equal(first.created,true);assert.equal(second.created,false);
  assert.equal((await db.query("SELECT id FROM tenants WHERE id=$1",[ids.tenantId])).rows.length,1);
  assert.equal((await db.query("SELECT id FROM users WHERE entra_subject=$1",[bootstrapInput.adminOid])).rows.length,1);
  assert.equal((await db.query("SELECT id FROM tenant_memberships WHERE tenant_id=$1",[ids.tenantId])).rows.length,1);
  assert.equal((await db.query("SELECT id FROM role_assignments WHERE tenant_id=$1",[ids.tenantId])).rows.length,1);
  assert.equal((await db.query("SELECT id FROM audit_log WHERE tenant_id=$1 AND action='tenant.pilot_bootstrapped'",[ids.tenantId])).rows.length,1);
  await db.close();
});

test("import Rezidence Dejvice podporuje dry-run, commit a opakování bez duplicit",async()=>{
  const db=await migrated();const normalized=normalizeBootstrapInput(bootstrapInput);const ids=bootstrapIds(normalized);
  const client=clientFor(db);
  await bootstrapPilotWorkspace(client,{...normalized,...ids});
  const source=await readFile(new URL("../seeds/0004_pilot_rezidence_dejvice.sql",import.meta.url),"utf8");
  assert.doesNotMatch(renderDejviceImport(source,{tenantId:ids.tenantId,membershipId:ids.membershipId}),/\{\{|d3000000-0000-4000-8000-00000000000/);
  const dry=await importDejvice(client,source,{tenantId:ids.tenantId,membershipId:ids.membershipId,dryRun:true});
  assert.deepEqual([dry.after.projects,dry.after.units,dry.after.accessories,dry.after.contracts],[1,19,48,4]);
  assert.equal((await db.query("SELECT id FROM projects WHERE tenant_id=$1 AND code='DEJ'",[ids.tenantId])).rows.length,0);
  const first=await importDejvice(client,source,{tenantId:ids.tenantId,membershipId:ids.membershipId,dryRun:false});
  assert.deepEqual([first.created.projects,first.created.units,first.created.accessories],[1,19,48]);
  const second=await importDejvice(client,source,{tenantId:ids.tenantId,membershipId:ids.membershipId,dryRun:false});
  assert.ok(Object.values(second.created).every(value=>value===0));
  await db.close();
});

test("migration runner kontroluje lock, checksum a rollbackuje chybu",async()=>{
  const calls:string[]=[];const ledger=new Map<string,string>();
  const client={query:async(sql:string,parameters?:unknown[])=>{
    calls.push(sql);
    if(sql.startsWith("SELECT filename"))return{rows:[...ledger].map(([filename,checksum])=>({filename,checksum}))};
    if(sql.startsWith("INSERT INTO schema_migrations")){ledger.set(parameters?.[0] as string,parameters?.[1] as string);return{rows:[]};}
    if(sql==="BROKEN")throw new Error("middle failure");
    return{rows:[]};
  }};
  const good=migrationFromSource("0001.sql","BEGIN; SELECT 1; COMMIT;");
  await applyMigrations(client,[good]);
  assert.ok(calls[0].includes("pg_advisory_lock"));assert.equal(ledger.get("0001.sql"),good.checksum);
  await assert.rejects(applyMigrations(client,[{...good,checksum:"changed"}]),/změněna/);
  await assert.rejects(applyMigrations(client,[good,migrationFromSource("0002.sql","BEGIN; BROKEN COMMIT;")]),/middle failure/);
  assert.ok(calls.includes("ROLLBACK"));
});

test("runtime role je LOGIN, bezpečná a členem develocrm_app",async()=>{
  const db=new PGlite();await db.exec(await readFile(new URL("../migrations/0001_block_a_identity.sql",import.meta.url),"utf8"));
  const source=await readFile(new URL("../sql/create-runtime-role.sql",import.meta.url),"utf8");await db.exec(source);await db.exec(source);
  const role=(await db.query<{rolcanlogin:boolean;rolsuper:boolean;rolinherit:boolean;rolbypassrls:boolean}>("SELECT rolcanlogin,rolsuper,rolinherit,rolbypassrls FROM pg_roles WHERE rolname='develocrm_runtime'")).rows[0];
  assert.deepEqual(role,{rolcanlogin:true,rolsuper:false,rolinherit:true,rolbypassrls:false});
  assert.equal((await db.query<{member:boolean}>("SELECT pg_has_role('develocrm_runtime','develocrm_app','member') member")).rows[0].member,true);
  await db.close();
});

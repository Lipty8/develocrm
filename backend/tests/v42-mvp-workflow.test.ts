import assert from "node:assert/strict";
import {readFile,readdir} from "node:fs/promises";
import test from "node:test";
import {PGlite} from "@electric-sql/pglite";
import {bootstrapIds,bootstrapPilotWorkspace,normalizeBootstrapInput} from "../src/iam/pilot-bootstrap.js";
import {importDejvice} from "../src/imports/dejvice.js";

async function migrated(){const db=new PGlite();const directory=new URL("../migrations/",import.meta.url);for(const name of (await readdir(directory)).filter(name=>/^\d+.*\.sql$/.test(name)).sort())await db.exec(await readFile(new URL(name,directory),"utf8"));return db;}
function clientFor(db:PGlite){return{query:async(sql:string,parameters?:unknown[])=>{if(!parameters&&sql.includes(";")){await db.exec(sql);return{rows:[],rowCount:null};}const result=await db.query(sql,parameters as never[]|undefined);return{rows:result.rows,rowCount:result.affectedRows??null};}} as never;}

test("plánování předání je auditované a dovolí jen jedno otevřené předání jednotky",async()=>{
  const db=await migrated();const normalized=normalizeBootstrapInput({entraTenantId:"10000000-0000-4000-8000-000000000042",adminOid:"20000000-0000-4000-8000-000000000042",adminEmail:"mvp.admin@example.test",adminName:"MVP Admin",workspaceName:"MVP workspace",workspaceId:"30000000-0000-4000-8000-000000000042"});const ids=bootstrapIds(normalized);const client=clientFor(db);await bootstrapPilotWorkspace(client,{...normalized,...ids});const source=await readFile(new URL("../seeds/0004_pilot_rezidence_dejvice.sql",import.meta.url),"utf8");await importDejvice(client,source,{tenantId:ids.tenantId,membershipId:ids.membershipId,dryRun:false});
  await db.exec(`SELECT set_config('app.tenant_id','${ids.tenantId}',false);SELECT set_config('app.user_id','${ids.userId}',false);`);
  const unit=(await db.query<{id:string}>("SELECT id FROM units WHERE tenant_id=$1 AND code='101'",[ids.tenantId])).rows[0];
  const handover=(await db.query<{id:string}>("SELECT app.schedule_unit_handover($1,$2,now()+interval '7 days',$3,$3) id",[ids.tenantId,unit.id,ids.membershipId])).rows[0].id;
  assert.equal((await db.query("SELECT id FROM audit_log WHERE tenant_id=$1 AND entity_id=$2 AND action='handover.scheduled'",[ids.tenantId,handover])).rows.length,1);
  assert.equal((await db.query("SELECT id FROM outbox_events WHERE tenant_id=$1 AND aggregate_id=$2 AND event_type='handover.scheduled.v1'",[ids.tenantId,handover])).rows.length,1);
  await assert.rejects(db.query("SELECT app.schedule_unit_handover($1,$2,now()+interval '8 days',$3,$3)",[ids.tenantId,unit.id,ids.membershipId]),/active handover|unique/i);
  await db.close();
});

test("handover repository používá skutečný název role účastníka a kanonické oprávnění",async()=>{const source=await readFile(new URL("../src/handovers/repository.ts",import.meta.url),"utf8");assert.match(source,/participant\.participant_role/);assert.doesNotMatch(source,/participant\.role\b/);assert.match(source,/handovers\.read/);});
test("klientský endpoint stránkuje a zachovává kombinované filtry na backendu",async()=>{const repository=await readFile(new URL("../src/sales/repository.ts",import.meta.url),"utf8");const app=await readFile(new URL("../src/app.ts",import.meta.url),"utf8");assert.match(repository,/async getPage/);assert.match(repository,/total,page,pageSize/);assert.match(app,/request\.query\.page/);assert.match(app,/types:request\.query\.types/);});

import assert from "node:assert/strict";
import {readFile,readdir} from "node:fs/promises";
import test from "node:test";
import {PGlite} from "@electric-sql/pglite";
import {bootstrapIds,bootstrapPilotWorkspace,normalizeBootstrapInput} from "../src/iam/pilot-bootstrap.js";
import {importDejvice} from "../src/imports/dejvice.js";
import {ComplaintRepository} from "../src/complaints/repository.js";
import type {Database} from "../src/database.js";

test("reklamace: založení, změna stavu, historie, idempotence a projektový rozsah",async()=>{
  const db=new PGlite();
  try{
    const directory=new URL("../migrations/",import.meta.url);
    for(const name of (await readdir(directory)).filter(name=>/^\d+.*\.sql$/.test(name)).sort())await db.exec(await readFile(new URL(name,directory),"utf8"));
    const normalized=normalizeBootstrapInput({entraTenantId:"10000000-0000-4000-8000-000000000063",adminOid:"20000000-0000-4000-8000-000000000063",adminEmail:"complaints@example.test",adminName:"Complaint Admin",workspaceName:"Complaint fixture",workspaceId:"30000000-0000-4000-8000-000000000063"});
    const ids=bootstrapIds(normalized);
    const client={query:async(sql:string,parameters?:unknown[])=>{if(!parameters&&sql.includes(";")){await db.exec(sql);return{rows:[],rowCount:null};}const result=await db.query(sql,parameters as never[]|undefined);return{rows:result.rows,rowCount:result.affectedRows??null};}} as never;
    await bootstrapPilotWorkspace(client,{...normalized,...ids});
    await importDejvice(client,await readFile(new URL("../seeds/0004_pilot_rezidence_dejvice.sql",import.meta.url),"utf8"),{tenantId:ids.tenantId,membershipId:ids.membershipId,dryRun:false});
    await db.exec(`SET ROLE develocrm_app; SELECT set_config('app.tenant_id','${ids.tenantId}',false); SELECT set_config('app.user_id','${ids.userId}',false);`);
    const context=(await db.query<{project_id:string;unit_id:string;party_id:string}>("SELECT unit.project_id,unit.id unit_id,link.party_id FROM units unit JOIN party_project_links link ON link.tenant_id=unit.tenant_id AND link.project_id=unit.project_id AND link.valid_to IS NULL WHERE unit.tenant_id=$1 ORDER BY unit.code LIMIT 1",[ids.tenantId])).rows[0];
    const adapter={withContext:async<T>(scope:{tenantId:string;userId:string},work:(client:{query:(sql:string,params?:unknown[])=>Promise<unknown>})=>Promise<T>)=>{await db.exec(`SELECT set_config('app.tenant_id','${scope.tenantId}',false); SELECT set_config('app.user_id','${scope.userId}',false);`);return work({query:async(sql:string,params?:unknown[])=>{const result=await db.query(sql,params as never[]|undefined);return{rows:result.rows,rowCount:result.affectedRows??result.rows.length};}});}} as unknown as Database;
    const repository=new ComplaintRepository(adapter);
    const common={tenantId:ids.tenantId,userId:ids.userId,membershipId:ids.membershipId};
    const input={...common,projectId:context.project_id,unitId:context.unit_id,partyId:context.party_id,title:"Vadná podlaha",description:"Poškození podlahové krytiny",assigneeMembershipId:ids.membershipId,dueAt:"2026-10-15",idempotencyKey:"complaint-fixture-1"};
    const created=await repository.create(input);
    assert.equal(created.status,"new");assert.equal(created.history.length,1);
    await assert.rejects(repository.create({...input,idempotencyKey:"complaint-no-permission",membershipId:"90000000-0000-4000-8000-000000000063"}),/complaints.manage permission required/);
    await assert.rejects(repository.create({...input,idempotencyKey:"complaint-other-project",projectId:"90000000-0000-4000-8000-000000000064"}),/unit must belong to complaint project|permission required/);
    assert.equal((await repository.create(input)).id,created.id);
    assert.equal((await repository.list({...common,projectId:context.project_id})).length,1);
    assert.equal((await repository.list({...common,projectId:"90000000-0000-4000-8000-000000000063"})).length,0);
    const update={...common,complaintId:created.id,status:"in_progress",note:"Převzato k vyřízení",assigneeMembershipId:ids.membershipId,dueAt:"2026-10-15",idempotencyKey:"complaint-update-1"};
    const progress=await repository.transition(update);
    assert.equal(progress.status,"in_progress");assert.equal(progress.history.length,2);
    assert.equal((await repository.transition(update)).history.length,2);
    assert.equal((await repository.transition({...update,status:"in_progress",note:"Dodavatel objednán",idempotencyKey:"complaint-note-1"})).history.length,3);
    assert.equal((await repository.transition({...update,status:"resolved",note:"Opraveno",idempotencyKey:"complaint-update-2"})).status,"resolved");
    await assert.rejects(repository.transition({...update,status:"new",idempotencyKey:"complaint-invalid"}),/invalid complaint transition/);
    assert.equal((await db.query<{count:number}>("SELECT count(*)::int count FROM complaint_events WHERE complaint_id=$1",[created.id])).rows[0].count,4);
    assert.equal((await db.query<{count:number}>("SELECT count(*)::int count FROM audit_log WHERE entity_id=$1 AND entity_type='complaint'",[created.id])).rows[0].count,4);
    assert.equal((await db.query<{count:number}>("SELECT count(*)::int count FROM outbox_events WHERE aggregate_id=$1 AND aggregate_type='complaint'",[created.id])).rows[0].count,4);
  }finally{await db.close();}
});

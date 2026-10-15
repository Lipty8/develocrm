import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {bootstrapIds,bootstrapPilotWorkspace,normalizeBootstrapInput} from '../src/iam/pilot-bootstrap.js';
import {SalesRepository} from '../src/sales/repository.js';
import {CommercialService} from '../src/commercial/service.js';
import {ActivityRepository} from '../src/activity/repository.js';
import type {Database,SqlClient} from '../src/database.js';

test('UUID contexts, current-case holds and workspace activity enforce tenant/project/archive scope',async()=>{
 const db=new PGlite();
 try{
  const migrations=new URL('../migrations/',import.meta.url);
  for(const name of (await readdir(migrations)).filter(name=>/^\d+.*\.sql$/.test(name)).sort())await db.exec(await readFile(new URL(name,migrations),'utf8'));
  const sql={query:async(text:string,values?:unknown[])=>{const result=await db.query(text,values);return{rows:result.rows,rowCount:result.affectedRows??null};}} as SqlClient;
  const input=normalizeBootstrapInput({entraTenantId:randomUUID(),adminOid:randomUUID(),adminEmail:'context@example.test',adminName:'Context test',workspaceName:'Context tests',workspaceId:randomUUID()});
  const ids=bootstrapIds(input);await bootstrapPilotWorkspace(sql,{...input,...ids});
  await db.query("SELECT set_config('app.tenant_id',$1,false),set_config('app.user_id',$2,false)",[ids.tenantId,ids.userId]);
  const a=randomUUID(),b=randomUUID(),unitA=randomUUID(),unitB=randomUUID();
  for(const [project,code,unit] of [[a,'CTA',unitA],[b,'CTB',unitB]]){
   await db.query('INSERT INTO projects(id,tenant_id,code,name,slug) VALUES($1,$2,$3,$3,lower($3))',[project,ids.tenantId,code]);
   await db.query("INSERT INTO units(id,tenant_id,project_id,code,area_m2) VALUES($1,$2,$3,'417',50)",[unit,ids.tenantId,project]);
  }
  const adapter={withContext:async(context:{tenantId:string;userId:string},work:(client:SqlClient)=>unknown)=>{
   await db.exec('BEGIN; SET LOCAL ROLE develocrm_app;');
   await db.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)",[context.tenantId,context.userId]);
   try{const result=await work(sql);await db.exec('COMMIT');return result;}catch(error){await db.exec('ROLLBACK');throw error;}
  }} as unknown as Database;
  const context={tenantId:ids.tenantId,userId:ids.userId,membershipId:ids.membershipId};
  const sales=new SalesRepository(adapter),activity=new ActivityRepository(adapter);
  const directory=await sales.getDirectory(context);
  assert.deepEqual(Object.keys(directory.unitContexts).sort(),[unitA,unitB].sort());
  assert.equal(directory.unitContexts[unitA].projectId,a);
  assert.equal(directory.unitContexts[unitB].projectId,b);
  assert.equal(directory.unitContexts['417'],undefined);
  // The live next-action query must work with the same schema, including case-scoped handovers.
  const next=await new CommercialService(adapter).nextContractAction({...context,unitId:unitA});
  assert.equal(next.kind,'missing_sales_case');
  for(const unit of [unitA,unitB])await db.query("INSERT INTO audit_log(tenant_id,entity_type,entity_id,action,actor_user_id,after_data) VALUES($1,'unit',$2,'unit.updated',$3,'{}')",[ids.tenantId,unit,ids.userId]);
  assert.equal((await activity.workspaceTimeline(context)).length,2);
  await db.query('UPDATE projects SET archived_at=now() WHERE id=$1',[b]);
  assert.equal((await activity.workspaceTimeline(context)).length,1);
  await db.query('DELETE FROM project_custom_access WHERE tenant_id=$1 AND project_id=$2',[ids.tenantId,a]);
  assert.equal((await activity.workspaceTimeline(context)).length,0);
  assert.equal(Object.keys((await sales.getDirectory(context)).unitContexts).length,0);
  assert.equal((await activity.workspaceTimeline({...context,tenantId:randomUUID()})).length,0);
 }finally{await db.close();}
});

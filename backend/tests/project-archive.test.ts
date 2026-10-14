import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {bootstrapIds,bootstrapPilotWorkspace,normalizeBootstrapInput} from '../src/iam/pilot-bootstrap.js';
import {InventoryRepository} from '../src/inventory/repository.js';
import type {Database,SqlClient} from '../src/database.js';

test('archive / restore preserves lifecycle, children, scope and idempotent audit',async()=>{
 const db=new PGlite();
 try{
 const migrations=new URL('../migrations/',import.meta.url);
 for(const name of (await readdir(migrations)).filter(name=>/^\d+.*\.sql$/.test(name)).sort())await db.exec(await readFile(new URL(name,migrations),'utf8'));
 const sql={query:async(text:string,values?:unknown[])=>{const result=await db.query(text,values);return {rows:result.rows,rowCount:result.affectedRows??null};}} as SqlClient;
 const normalized=normalizeBootstrapInput({entraTenantId:randomUUID(),adminOid:randomUUID(),adminEmail:'archive@example.test',adminName:'Archive test',workspaceName:'Archive tests',workspaceId:randomUUID()});
 const ids=bootstrapIds(normalized);await bootstrapPilotWorkspace(sql,{...normalized,...ids});
 await db.query("SELECT set_config('app.tenant_id',$1,false),set_config('app.user_id',$2,false)",[ids.tenantId,ids.userId]);
 const project=randomUUID(),unit=randomUUID();
 await db.query("INSERT INTO projects(id,tenant_id,code,name,slug,lifecycle_status) VALUES($1,$2,'ARCH','Archive test','archive-test','completed')",[project,ids.tenantId]);
 await db.query("INSERT INTO units(id,tenant_id,project_id,code,area_m2) VALUES($1,$2,$3,'TEST',50)",[unit,ids.tenantId,project]);
 const hold=(await db.query<{sales_case_id:string}>(`SELECT * FROM app.create_party_and_unit_hold($1,$2,'pre_reservation',now()+interval '48 hours',$3,$4,'Archive test','individual',NULL,'Archive','Buyer',NULL,NULL,$5,NULL)`,[ids.tenantId,unit,ids.membershipId,randomUUID(),'archive.buyer@example.test'])).rows[0];
 await db.query("SELECT * FROM app.create_contract_with_payment($1,$2,'rs','RS-ARCHIVE-TEST','Archive test RS',$3,NULL,$4,'fixed',250000,now()+interval '7 days')",[ids.tenantId,hold.sales_case_id,ids.membershipId,randomUUID()]);
 const children=async()=>Promise.all(['units','sales_cases','unit_holds','contracts','payment_obligations'].map(async table=>(await db.query(`SELECT to_jsonb(child) snapshot FROM ${table} child WHERE tenant_id=$1 AND project_id=$2 ORDER BY id`,[ids.tenantId,project])).rows));
 const originalChildren=await children();
 const adapter={withContext:async(context:{tenantId:string;userId:string},work:(client:SqlClient)=>unknown)=>{
   await db.exec('BEGIN; SET LOCAL ROLE develocrm_app;');
   await db.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)",[context.tenantId,context.userId]);
   try{const result=await work(sql);await db.exec('COMMIT');return result;}catch(error){await db.exec('ROLLBACK');throw error;}
 }} as unknown as Database;
 const repository=new InventoryRepository(adapter);const context={tenantId:ids.tenantId,userId:ids.userId,membershipId:ids.membershipId};
 assert.equal((await repository.getCatalog(context)).projects.length,1);
 assert.equal((await repository.getCatalog({...context,visibility:'active'})).projects.length,0);
 assert.equal((await repository.getCatalog({...context,visibility:'completed'})).projects.length,1);
 assert.equal((await repository.setArchived({...context,projectId:project,archived:true})).changed,true);
 assert.equal((await repository.setArchived({...context,projectId:project,archived:true})).changed,false);
 assert.deepEqual(await children(),originalChildren);
 assert.deepEqual(await repository.archiveImpact({...context,projectId:project}),{activeCases:1,activeContracts:1,unpaidObligations:1});
 assert.equal((await repository.getCatalog(context)).projects.length,0);
 assert.equal((await repository.getCatalog(context)).units.length,0);
 assert.equal((await repository.getCatalog({...context,visibility:'archived'})).projects.length,1);
 assert.equal((await repository.getCatalog({...context,projectId:project})).units.length,1);
 assert.equal((await repository.getCatalog({...context,unitId:unit})).projects[0]?.id,project);
 const contractId=(await db.query<{id:string}>('SELECT id FROM contracts WHERE sales_case_id=$1',[hold.sales_case_id])).rows[0].id;
 assert.equal((await repository.getCatalog({...context,contractId})).projects[0]?.id,project);
 const partyId=(await db.query<{party_id:string}>('SELECT party_id FROM sales_case_parties WHERE sales_case_id=$1 LIMIT 1',[hold.sales_case_id])).rows[0].party_id;
 assert.equal((await repository.getCatalog({...context,partyId})).projects[0]?.id,project);
 assert.equal((await repository.getCatalog({...context,unitId:randomUUID()})).projects.length,0);
 assert.equal((await db.query<{lifecycle_status:string}>('SELECT lifecycle_status FROM projects WHERE id=$1',[project])).rows[0].lifecycle_status,'completed');
 assert.equal((await db.query('SELECT id FROM units WHERE id=$1',[unit])).rows.length,1);
 await assert.rejects(()=>repository.updateProject({...context,projectId:project,name:'Bypass',lifecycleStatus:'active'}),/restore project/);
 await assert.rejects(()=>repository.setArchived({...context,membershipId:randomUUID(),projectId:project,archived:false}),/permission/);
 await assert.rejects(()=>repository.setArchived({...context,tenantId:randomUUID(),projectId:project,archived:false}),/permission/);
 assert.equal((await repository.setArchived({...context,projectId:project,archived:false})).changed,true);
 assert.equal((await repository.setArchived({...context,projectId:project,archived:false})).changed,false);
 assert.deepEqual(await children(),originalChildren);
 assert.equal((await repository.getCatalog({...context,visibility:'completed'})).projects.length,1);
 assert.equal((await db.query("SELECT id FROM audit_log WHERE entity_id=$1 AND action IN ('project.archived','project.restored')",[project])).rows.length,2);
 assert.equal((await db.query("SELECT id FROM outbox_events WHERE aggregate_id=$1 AND event_type IN ('project.archived.v1','project.restored.v1')",[project])).rows.length,2);
 const legacy=randomUUID();await db.query("INSERT INTO projects(id,tenant_id,code,name,slug,lifecycle_status,archived_at) VALUES($1,$2,'LEGACY','Legacy archive','legacy-archive','archived',now())",[legacy,ids.tenantId]);
 await assert.rejects(()=>repository.setArchived({...context,projectId:legacy,archived:false}),/restore lifecycle/);
 await repository.setArchived({...context,projectId:legacy,archived:false,restoreLifecycle:'completed'});
 // Workspace administration does not bypass project scope.
 await db.query("DELETE FROM project_custom_access WHERE tenant_id=$1 AND project_id=$2",[ids.tenantId,legacy]);
 assert.equal((await repository.getCatalog(context)).projects.length,1);
 await assert.rejects(()=>repository.setArchived({...context,projectId:legacy,archived:true}),/permission/);
 // Removing workspace administration blocks mutation even with project access.
 await db.query("DELETE FROM role_permissions WHERE tenant_id=$1 AND permission_id=(SELECT id FROM permissions WHERE code='system.manage')",[ids.tenantId]);
 await assert.rejects(()=>repository.setArchived({...context,projectId:project,archived:true}),/permission/);
 }finally{await db.close();}
});

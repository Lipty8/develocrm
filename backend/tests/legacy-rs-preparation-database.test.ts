import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {Pool,type PoolClient} from 'pg';
import type {Database,SqlClient} from '../src/database.js';
import {bootstrapIds,bootstrapPilotWorkspace,normalizeBootstrapInput} from '../src/iam/pilot-bootstrap.js';
import {importDejvice} from '../src/imports/dejvice.js';
import {LegacyRsPreparationRepository} from '../src/contracts/legacy-rs-preparation-repository.js';
import {LegacyRsPreparationError} from '../src/contracts/legacy-rs-preparation.js';
import {signatureDocument} from './helpers/signature-document.js';

async function fixture(postgresUrl?:string){
 const memory=postgresUrl?null:new PGlite(),admin=postgresUrl?new Pool({connectionString:postgresUrl}):null;
 const name=`legacy_rs_${randomUUID().replaceAll('-','')}`;if(admin)await admin.query(`CREATE DATABASE "${name}"`);
 const url=postgresUrl?new URL(postgresUrl):null;if(url)url.pathname=`/${name}`;
 const pool=url?new Pool({connectionString:url.toString()}):null;
 const client:SqlClient=pool??{query:async(sql:string,values?:unknown[])=>{
   if(!values&&sql.includes(';')){await memory!.exec(sql);return{rows:[],rowCount:null};}
   const result=await memory!.query(sql,values);return{rows:result.rows,rowCount:result.affectedRows??null};
 }} as SqlClient;
 const dir=new URL('../migrations/',import.meta.url),files=(await readdir(dir)).filter(n=>/^\d+.*\.sql$/.test(n)).sort();
 for(const file of files.filter(n=>n<'0057'))await client.query(await readFile(new URL(file,dir),'utf8'));
 const input=normalizeBootstrapInput({entraTenantId:randomUUID(),adminOid:randomUUID(),adminEmail:'legacy-rs@example.test',adminName:'Technical Legacy RS',workspaceName:'Technical Legacy RS',workspaceId:randomUUID()});
 const ids=bootstrapIds(input);await bootstrapPilotWorkspace(client,{...input,...ids});
 await importDejvice(client,await readFile(new URL('../seeds/0004_pilot_rezidence_dejvice.sql',import.meta.url),'utf8'),{tenantId:ids.tenantId,membershipId:ids.membershipId,dryRun:false});
 for(const file of files.filter(n=>n>='0057'))await client.query(await readFile(new URL(file,dir),'utf8'));
 const database={withContext:async<T>(context:{tenantId:string;userId:string},work:(client:SqlClient)=>Promise<T>,options?:{readOnly:true})=>{
  const c=pool?await pool.connect():client;
  try{await c.query(options?.readOnly?'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY':'BEGIN');
   await c.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)",[context.tenantId,context.userId]);
   await c.query('SET LOCAL ROLE develocrm_app');const result=await work(c);await c.query('COMMIT');return result;
  }catch(e){await c.query('ROLLBACK');throw e;}finally{if(pool)(c as PoolClient).release();}
 }} as Database;
 const contract=(await client.query<{id:string;version_id:string;generation_payload:unknown;project_id:string}>(`SELECT c.id,c.project_id,v.id version_id,v.generation_payload
   FROM contracts c JOIN contract_versions v ON v.tenant_id=c.tenant_id AND v.contract_id=c.id
   JOIN sales_cases s ON s.tenant_id=c.tenant_id AND s.id=c.sales_case_id
   WHERE c.tenant_id=$1 AND c.contract_type='rs' AND c.unit_price_snapshot IS NULL AND s.status='active'
   ORDER BY c.reference,v.version_number DESC LIMIT 1`,[ids.tenantId])).rows[0];
 assert.ok(contract,'disposable import must contain an actual legacy RS');
 const context={tenantId:ids.tenantId,userId:ids.userId,membershipId:ids.membershipId,contractId:contract.id};
 return{client,pool,database,contract,context,repository:new LegacyRsPreparationRepository(database),close:async()=>{
  if(memory)await memory.close();if(pool)await pool.end();if(admin){await admin.query(`DROP DATABASE "${name}"`);await admin.end();}
 }};
}
const error=(code:string)=>(e:unknown)=>e instanceof LegacyRsPreparationError&&e.code===code;
for(const native of [false,true])test(`legacy RS preparation persists atomically (${native?'PostgreSQL':'PGlite'})`,{skip:native&&!process.env.WORKFLOW_TEST_DATABASE_URL},async t=>{
 const f=await fixture(native?process.env.WORKFLOW_TEST_DATABASE_URL:undefined);
 try{
  const preview=await f.repository.preview(f.context);
  const body={expectedVersionId:preview.versionId,previewToken:preview.previewToken,agreedUnitPrice:'12345.67',reservationFee:'100.01',idempotencyKey:randomUUID(),reason:'Confirmed technical terms only'};
  await t.test('valid members need both contract edit and price read in the correct project',async()=>{
   const user=randomUUID(),member=randomUUID();
   await f.client.query(`INSERT INTO users(id,entra_issuer,entra_subject,email,display_name) VALUES($1::uuid,'technical-test',($1::uuid)::text,$2,'Technical limited preparation')`,[user,`${user}@example.test`]);
   await f.client.query(`INSERT INTO tenant_memberships(id,tenant_id,user_id,status,accepted_at) VALUES($1,$2,$3,'active',now())`,[member,f.context.tenantId,user]);
   const other=(await f.client.query<{id:string}>(`INSERT INTO projects(tenant_id,code,name,slug) VALUES($1,'OTHERLEGACY','Other legacy test','other-legacy-test') RETURNING id`,[f.context.tenantId])).rows[0].id;
   const grant=async(project:string,area:string,level:string)=>f.client.query(`INSERT INTO project_custom_access(tenant_id,project_id,membership_id,area,access_level,assigned_by_user_id) VALUES($1,$2,$3,$4,$5,$6)`,[f.context.tenantId,project,member,area,level,f.context.userId]);
   const limited={...f.context,userId:user,membershipId:member};
   await grant(other,'contracts','edit');await grant(other,'units','read');
   await assert.rejects(f.repository.preview(limited),error('not_found_or_forbidden'));
   await assert.rejects(f.repository.prepare(limited,body));
   await grant(f.contract.project_id,'contracts','edit');
   await assert.rejects(f.repository.preview(limited),error('not_found_or_forbidden'));
   await grant(f.contract.project_id,'units','read');
   assert.equal((await f.repository.preview(limited)).previewToken,preview.previewToken);
   await f.client.query(`UPDATE tenant_memberships SET status='suspended' WHERE id=$1`,[member]);
   await assert.rejects(f.repository.preview(limited),error('not_found_or_forbidden'));
  });
  await t.test('preview and refusal paths make no contract change',async()=>{
   assert.equal(preview.contractId,f.contract.id);
   await assert.rejects(f.repository.prepare(f.context,{...body,expectedVersionId:randomUUID()}),error('stale_preview'));
   await assert.rejects(f.repository.prepare(f.context,{...body,previewToken:'0'.repeat(64)}),error('stale_preview'));
   await assert.rejects(f.repository.prepare({...f.context,userId:randomUUID()},body),error('not_found_or_forbidden'));
   await assert.rejects(f.repository.prepare({...f.context,membershipId:randomUUID()},body),error('not_found_or_forbidden'));
   await assert.rejects(f.repository.prepare({...f.context,tenantId:randomUUID()},body));
   const unchanged=(await f.client.query<{unit_price_snapshot:string|null}>(`SELECT unit_price_snapshot FROM contracts WHERE id=$1`,[f.contract.id])).rows[0];
   assert.equal(unchanged.unit_price_snapshot,null);
  });
  await t.test('failure after version creation rolls back the version, approval change and audit',async()=>{
   await f.client.query(`CREATE FUNCTION app.test_legacy_preparation_failure() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.unit_price_snapshot IS NOT NULL AND OLD.unit_price_snapshot IS NULL THEN RAISE EXCEPTION 'TECHNICAL_PREPARATION_FAILURE'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER test_legacy_preparation_failure BEFORE UPDATE ON contracts FOR EACH ROW EXECUTE FUNCTION app.test_legacy_preparation_failure();`);
   try{await assert.rejects(f.repository.prepare(f.context,body),/TECHNICAL_PREPARATION_FAILURE/);}
   finally{await f.client.query('DROP TRIGGER test_legacy_preparation_failure ON contracts; DROP FUNCTION app.test_legacy_preparation_failure();');}
   const state=(await f.client.query<{versions:number;audit:number;outbox:number}>(`SELECT
    (SELECT count(*)::int FROM contract_versions WHERE contract_id=$1) versions,
    (SELECT count(*)::int FROM audit_log WHERE entity_id=$1 AND action='contract.legacy_terms_prepared') audit,
    (SELECT count(*)::int FROM outbox_events WHERE aggregate_id=$1 AND event_type='contract.legacy_terms_prepared.v1') outbox`,[f.contract.id])).rows[0];
   assert.deepEqual(state,{versions:1,audit:0,outbox:0});
   assert.equal((await f.repository.preview(f.context)).previewToken,preview.previewToken);
  });
  let saved:{versionId:string;replayed:boolean};
  await t.test('explicit preparation creates one version without obligations or documents',async()=>{
   const results=native?await Promise.all([f.repository.prepare(f.context,body),f.repository.prepare(f.context,body)]):[await f.repository.prepare(f.context,body),await f.repository.prepare(f.context,body)];
   assert.deepEqual(results.map(r=>r.replayed).sort(),[false,true]);assert.equal(results[0].versionId,results[1].versionId);saved=results[0];
   const rows=(await f.client.query<{id:string;generation_payload:unknown}>(`SELECT id,generation_payload FROM contract_versions WHERE contract_id=$1 ORDER BY version_number`,[f.contract.id])).rows;
   assert.equal(rows.length,2);assert.equal(rows[0].id,f.contract.version_id);assert.deepEqual(rows[0].generation_payload,f.contract.generation_payload);
   const counts=(await f.client.query<{audit:number;outbox:number;obligations:number;documents:number}>(`SELECT
    (SELECT count(*)::int FROM audit_log WHERE entity_id=$1 AND action='contract.legacy_terms_prepared') audit,
    (SELECT count(*)::int FROM outbox_events WHERE aggregate_id=$1 AND event_type='contract.legacy_terms_prepared.v1') outbox,
    (SELECT count(*)::int FROM payment_obligations WHERE contract_id=$1) obligations,
    (SELECT count(*)::int FROM contract_documents WHERE contract_id=$1) documents`,[f.contract.id])).rows[0];
   assert.deepEqual(counts,{audit:1,outbox:1,obligations:0,documents:0});
   const contract=(await f.client.query<{unit_price:string;fee:string;current_status:string}>(`SELECT unit_price_snapshot::text unit_price,reservation_fee_amount::text fee,current_status FROM contracts WHERE id=$1`,[f.contract.id])).rows[0];
   assert.equal(contract.unit_price,'12345.67');assert.equal(contract.fee,'100.01');assert.equal(contract.current_status,'draft');
  });
  await t.test('reload/retry is stable; changed confirmation and overwriting terms are rejected',async()=>{
   assert.deepEqual(await f.repository.prepare(f.context,body),{versionId:saved.versionId,replayed:true});
   await assert.rejects(f.repository.prepare(f.context,{...body,reservationFee:'101'}),error('idempotency_mismatch'));
   await assert.rejects(f.repository.prepare(f.context,{...body,idempotencyKey:randomUUID()}),error('existing_terms_require_review'));
  });
 }finally{await f.close();}
});
test('two distinct confirmations cannot both replace the missing RS terms (PostgreSQL)',{skip:!process.env.WORKFLOW_TEST_DATABASE_URL},async()=>{
 const f=await fixture(process.env.WORKFLOW_TEST_DATABASE_URL);
 try{
  const preview=await f.repository.preview(f.context);
  const body={expectedVersionId:preview.versionId,previewToken:preview.previewToken,agreedUnitPrice:'12345.67',reservationFee:'100.01',idempotencyKey:randomUUID(),reason:'Explicit technical confirmation'};
  const results=await Promise.allSettled([f.repository.prepare(f.context,body),f.repository.prepare(f.context,{...body,idempotencyKey:randomUUID(),agreedUnitPrice:'12346.67'})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const failure=results.find(r=>r.status==='rejected');assert.ok(failure&&failure.status==='rejected');assert.ok(error('existing_terms_require_review')(failure.reason));
  const counts=(await f.client.query<{versions:number;audit:number}>(`SELECT (SELECT count(*)::int FROM contract_versions WHERE contract_id=$1) versions,
   (SELECT count(*)::int FROM audit_log WHERE entity_id=$1 AND action='contract.legacy_terms_prepared') audit`,[f.contract.id])).rows[0];
  assert.deepEqual(counts,{versions:2,audit:1});
 }finally{await f.close();}
});

for(const scenario of ['price-before','price-race','accessory-price-before','release-before','release-race'] as const)
 test(`canonical writer vs RS preparation: ${scenario} (PostgreSQL)`,{skip:!process.env.WORKFLOW_TEST_DATABASE_URL},async()=>{
 const f=await fixture(process.env.WORKFLOW_TEST_DATABASE_URL);
 try{
  let unit=(await f.repository.preview(f.context)).unitId;
  const command=async(sql:string,values:unknown[])=>f.database.withContext(f.context,async c=>(await c.query<{id:string}>(sql,values)).rows[0]?.id);
  let write:()=>Promise<unknown>;
  if(scenario.startsWith('price-')){
   const proposal=await command(`SELECT app.propose_unit_price($1,$2,'contract_price',98765.43,'CZK',clock_timestamp(),'Technical preparation race',$3) id`,[f.context.tenantId,unit,f.context.membershipId]);
   write=()=>command(`SELECT app.decide_unit_price_proposal($1,$2,'approved','Technical approval race',$3) id`,[f.context.tenantId,proposal,f.context.membershipId]);
  }else{
   const accessory=await command(`SELECT app.create_project_accessory($1,$2,'cellar','LEGACY-RACE',2,100,NULL,NULL,$3) id`,[f.context.tenantId,f.contract.project_id,f.context.membershipId]);
   const assignment=await command(`SELECT app.assign_accessory_to_unit($1,$2,$3,clock_timestamp(),$4) id`,[f.context.tenantId,unit,accessory,f.context.membershipId]);
   write=scenario==='accessory-price-before'
    ?()=>command(`SELECT app.update_project_accessory($1,$2,'LEGACY-RACE',2,101,NULL,'Technical new price',$3) id`,[f.context.tenantId,accessory,f.context.membershipId])
    :()=>command(`SELECT app.remove_accessory_from_unit($1,$2,clock_timestamp(),$3) id`,[f.context.tenantId,assignment,f.context.membershipId]);
  }
  const preview=await f.repository.preview(f.context);unit=preview.unitId;
  const body={expectedVersionId:preview.versionId,previewToken:preview.previewToken,agreedUnitPrice:'12345.67',reservationFee:'100.01',idempotencyKey:randomUUID(),reason:'Explicit technical writer race'};
  if(scenario.endsWith('before')){
   await write();await assert.rejects(f.repository.prepare(f.context,body),error('stale_preview'));
   assert.notEqual((await f.repository.preview(f.context)).previewToken,preview.previewToken);
  }else{
   // Either the confirmed old basis linearizes first, or the new basis is
   // visible and requires a refreshed confirmation. Neither ordering may
   // deadlock, mix snapshots or silently replace agreed terms.
   const [writer,preparation]=await Promise.allSettled([write(),f.repository.prepare(f.context,body)]);
   assert.equal(writer.status,'fulfilled');
   if(preparation.status==='rejected')assert.ok(error('stale_preview')(preparation.reason));
   else{
    const version=(await f.client.query<{generation_payload:{legacyPreparation:{preview:unknown}}}>(`SELECT generation_payload FROM contract_versions WHERE id=$1`,[preparation.value.versionId])).rows[0];
    assert.deepEqual(version.generation_payload.legacyPreparation.preview,preview);
   }
  }
 }finally{await f.close();}
});

test('a final document added after preview blocks legacy terms preparation (PostgreSQL)',{skip:!process.env.WORKFLOW_TEST_DATABASE_URL},async()=>{
 const f=await fixture(process.env.WORKFLOW_TEST_DATABASE_URL);
 try{
  const preview=await f.repository.preview(f.context);
  await f.database.withContext(f.context,c=>signatureDocument(c,f.context.tenantId,f.context.membershipId,f.context.contractId));
  await assert.rejects(f.repository.prepare(f.context,{expectedVersionId:preview.versionId,previewToken:preview.previewToken,
   agreedUnitPrice:'12345.67',reservationFee:'100.01',idempotencyKey:randomUUID(),reason:'Technical evidence protection'}),error('existing_evidence_requires_review'));
  const row=(await f.client.query<{amount:string|null}>(`SELECT unit_price_snapshot::text amount FROM contracts WHERE id=$1`,[f.contract.id])).rows[0];
  assert.equal(row.amount,null);
 }finally{await f.close();}
});
test('a racing signature attempt without exact evidence cannot sign a newly prepared RS (PostgreSQL)',{skip:!process.env.WORKFLOW_TEST_DATABASE_URL},async()=>{
 const f=await fixture(process.env.WORKFLOW_TEST_DATABASE_URL);
 try{
  const preview=await f.repository.preview(f.context);
  const results=await Promise.allSettled([
   f.repository.prepare(f.context,{expectedVersionId:preview.versionId,previewToken:preview.previewToken,agreedUnitPrice:'12345.67',reservationFee:'100.01',idempotencyKey:randomUUID(),reason:'Technical unsigned preparation'}),
   f.database.withContext(f.context,c=>c.query('SELECT * FROM app.sign_contract_externally($1,$2,$3,now(),$4,$5)',[f.context.tenantId,f.context.contractId,preview.versionId,f.context.membershipId,'Technical rejected signature'])),
  ]);
  assert.equal(results[0].status,'fulfilled');assert.equal(results[1].status,'rejected');
  if(results[1].status==='rejected')assert.doesNotMatch(String(results[1].reason),/deadlock|40P01/);
  const row=(await f.client.query<{current_status:string;signed_versions:number}>(`SELECT c.current_status,
   (SELECT count(*)::int FROM contract_versions v WHERE v.contract_id=c.id AND v.version_status='signed') signed_versions FROM contracts c WHERE c.id=$1`,[f.contract.id])).rows[0];
  assert.deepEqual(row,{current_status:'draft',signed_versions:0});
 }finally{await f.close();}
});

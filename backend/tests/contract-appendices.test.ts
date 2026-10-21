import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {Pool} from 'pg';
import type {SqlClient} from '../src/database.js';
import {bootstrapIds,bootstrapPilotWorkspace,normalizeBootstrapInput} from '../src/iam/pilot-bootstrap.js';
import {importDejvice} from '../src/imports/dejvice.js';
import {signatureDocument} from './helpers/signature-document.js';
import {RsGenerationRepository} from '../src/contracts/rs-generation-repository.js';
import {DocumentTemplateGenerationRepository,type TemplateSource} from '../src/documents/template-generation-repository.js';
import {contractAppendixRequirements} from '../src/shared/contract-appendices.js';
import {ORIGINAL_DOB_FULL_VARIANT} from '../src/documents/template-catalog.js';

async function fixture(postgresUrl?:string){
  const memory=postgresUrl?null:new PGlite();const admin=postgresUrl?new Pool({connectionString:postgresUrl}):null;
  const name=`appendices_${randomUUID().replaceAll('-','')}`;if(admin)await admin.query(`CREATE DATABASE "${name}"`);
  const url=postgresUrl?new URL(postgresUrl):null;if(url)url.pathname=`/${name}`;
  const pool=url?new Pool({connectionString:url.toString()}):null;
  const client:SqlClient=pool??{query:async(sql:string,values?:unknown[])=>{
    if(!values&&sql.includes(';')){await memory!.exec(sql);return{rows:[],rowCount:null};}
    const result=await memory!.query(sql,values);return{rows:result.rows,rowCount:result.affectedRows??null};
  }} as SqlClient;
  const dir=new URL('../migrations/',import.meta.url),files=(await readdir(dir)).filter(n=>/^\d+.*\.sql$/.test(n)).sort();
  for(const file of files.filter(n=>n<'0057'))await client.query(await readFile(new URL(file,dir),'utf8'));
  const input=normalizeBootstrapInput({entraTenantId:randomUUID(),adminOid:randomUUID(),adminEmail:'appendix@example.test',adminName:'Technical Appendix Test',workspaceName:'Technical Appendices',workspaceId:randomUUID()});
  const ids=bootstrapIds(input);await bootstrapPilotWorkspace(client,{...input,...ids});
  await importDejvice(client,await readFile(new URL('../seeds/0004_pilot_rezidence_dejvice.sql',import.meta.url),'utf8'),{tenantId:ids.tenantId,membershipId:ids.membershipId,dryRun:false});
  for(const file of files.filter(n=>n>='0057'))await client.query(await readFile(new URL(file,dir),'utf8'));
  async function context<T>(work:(c:SqlClient)=>Promise<T>,userId=ids.userId,tenantId=ids.tenantId){
    const c=pool?await pool.connect():client;
    try{await c.query('BEGIN');await c.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)",[tenantId,userId]);await c.query('SET LOCAL ROLE develocrm_app');const value=await work(c);await c.query('COMMIT');return value;}
    catch(e){await c.query('ROLLBACK');throw e;}finally{if(pool)(c as import('pg').PoolClient).release();}
  }
  const unit=(await client.query<{id:string;project_id:string}>("SELECT id,project_id FROM units WHERE tenant_id=$1 AND commercial_status='available' ORDER BY code LIMIT 1",[ids.tenantId])).rows[0];
  const contract=await context(async c=>{
    const hold=(await c.query<{sales_case_id:string}>("SELECT * FROM app.create_party_and_unit_hold($1,$2,'pre_reservation',now()+interval '48 hours',$3,$4,'Technical appendix test','individual',NULL,'Technical','Buyer',NULL,NULL,'appendix-buyer@example.test',NULL)",[ids.tenantId,unit.id,ids.membershipId,randomUUID()])).rows[0];
    return(await c.query<{contract_id:string;version_id:string}>("SELECT * FROM app.create_contract_with_payment($1,$2,'rs',$3,'Technical RS',$4,NULL,$5,'fixed',250000,now()+interval '7 days')",[ids.tenantId,hold.sales_case_id,`APP-${randomUUID()}`,ids.membershipId,randomUUID()])).rows[0];
  });
  async function document(projectId=unit.project_id,status='ready'){
    return context(async c=>{
      const operation=(await c.query<{id:string}>("SELECT app.reserve_document_upload($1,$2,$3,$4,'create',NULL,'other','Technical appendix','appendix.pdf','application/pdf',16,$5,'v1',$6,NULL,NULL,NULL,NULL,NULL,$7) id",[ids.tenantId,projectId,randomUUID(),'a'.repeat(64),`sha256:${'b'.repeat(64)}`,status,ids.membershipId])).rows[0].id;
      await c.query("SELECT app.record_document_graph_upload($1,$2,'fixture-drive',$3,'https://sharepoint.example.test/appendix','etag','1.0',16,$4)",[ids.tenantId,operation,randomUUID(),ids.membershipId]);
      return(await c.query<{document_id:string;document_version_id:string}>('SELECT * FROM app.finalize_document_upload($1,$2,$3)',[ids.tenantId,operation,ids.membershipId])).rows[0];
    });
  }
  type Doc=Awaited<ReturnType<typeof document>>;
  const set=(number:number,d:Doc|null,versionId=contract.version_id,member=ids.membershipId,tenant=ids.tenantId,user=ids.userId,expected:string|null=null)=>context(async c=>(await c.query<{id:string|null}>('SELECT app.set_contract_appendix($1,$2,$3,$4,$5,$6,$7,$8) id',[tenant,contract.contract_id,versionId,number,d?.document_id??null,d?.document_version_id??null,member,expected])).rows[0].id,user,tenant);
  const counts=async()=>(await client.query<{links:number;audit:number;outbox:number}>("SELECT (SELECT count(*)::int FROM contract_documents WHERE contract_version_id=$1 AND appendix_number IS NOT NULL) links,(SELECT count(*)::int FROM audit_log WHERE entity_id=$1 AND action='contract.appendix_updated') audit,(SELECT count(*)::int FROM outbox_events WHERE payload->>'contractVersionId'=$1::text AND event_type='contract.appendix_updated.v1') outbox",[contract.version_id])).rows[0];
  const close=async()=>{if(memory)await memory.close();if(pool)await pool.end();if(admin){await admin.query(`DROP DATABASE "${name}"`);await admin.end();}};
  return{ids,client,pool,context,unit,contract,document,set,counts,close};
}

for(const native of [false,true])test(`exact appendix version binding (${native?'PostgreSQL':'PGlite'})`,{skip:native&&!process.env.WORKFLOW_TEST_DATABASE_URL},async t=>{
  const f=await fixture(native?process.env.WORKFLOW_TEST_DATABASE_URL:undefined);
  try{
    const a=await f.document(),b=await f.document();
    await t.test('exact links, retry, replacement and removal preserve audit without document deletion',async()=>{
      const id=await f.set(1,a);assert.ok(id);assert.equal(await f.set(1,a),id);assert.deepEqual(await f.counts(),{links:1,audit:1,outbox:1});
      await assert.rejects(f.set(1,b),/APPENDIX_CHANGED/);
      const next=await f.set(1,b,undefined,undefined,undefined,undefined,a.document_version_id);assert.notEqual(next,id);assert.deepEqual(await f.counts(),{links:1,audit:2,outbox:2});
      await assert.rejects(f.set(2,b),/DOCUMENT_ALREADY_LINKED/);
      assert.equal(await f.set(1,null,undefined,undefined,undefined,undefined,b.document_version_id),null);assert.equal(await f.set(1,null),null);assert.deepEqual(await f.counts(),{links:0,audit:3,outbox:3});
      assert.equal((await f.client.query<{n:number}>('SELECT count(*)::int n FROM document_versions WHERE id IN ($1,$2)',[a.document_version_id,b.document_version_id])).rows[0].n,2);
    });
    await t.test('invalid, missing, draft and cross-project versions are rejected atomically',async()=>{
      const before=await f.counts(),draft=await f.document(undefined,'draft');
      await assert.rejects(f.set(0,a),/INVALID_REQUEST/);await assert.rejects(f.set(1,{...a,document_version_id:b.document_version_id}),/DOCUMENT_NOT_READY/);
      await assert.rejects(f.set(1,draft),/DOCUMENT_NOT_READY/);await assert.rejects(f.set(1,{document_id:randomUUID(),document_version_id:randomUUID()}),/DOCUMENT_NOT_READY/);
      const other=(await f.client.query<{id:string}>("INSERT INTO projects(tenant_id,code,name,slug) VALUES($1,'APPOTHER','Other project','appendix-other') RETURNING id",[f.ids.tenantId])).rows[0].id;
      await f.client.query("INSERT INTO project_custom_access(tenant_id,membership_id,project_id,area,access_level,assigned_by_user_id) VALUES($1,$2,$3,'documents','edit',$4)",[f.ids.tenantId,f.ids.membershipId,other,f.ids.userId]);
      assert.equal((await f.client.query<{yes:boolean}>("SELECT app.has_project_permission($1,$2,$3,'documents.upload') yes",[f.ids.tenantId,f.ids.membershipId,other])).rows[0].yes,true);
      const foreign=await f.document(other);await assert.rejects(f.set(1,foreign),/DOCUMENT_NOT_READY/);assert.deepEqual(await f.counts(),before);
      await assert.rejects(f.set(1,a,randomUUID()),/NEW_VERSION_REQUIRED/);
      await assert.rejects(f.set(1,a,undefined,randomUUID()),/permission/);
      await assert.rejects(f.set(1,a,undefined,undefined,randomUUID()),/permission|tenant/);
      await assert.rejects(f.set(1,a,undefined,undefined,undefined,randomUUID()),/permission/);
    });
    if(native)await t.test('simultaneous same assignment produces one row and one audit/outbox pair',async()=>{
      const before=await f.counts();const results=await Promise.all(Array.from({length:6},()=>f.set(3,a)));
      assert.equal(new Set(results).size,1);const after=await f.counts();assert.equal(after.links,before.links+1);assert.equal(after.audit,before.audit+1);assert.equal(after.outbox,before.outbox+1);
      await f.set(3,null,undefined,undefined,undefined,undefined,a.document_version_id);
    });
    if(native)await t.test('competing selections cannot silently overwrite one another',async()=>{
      const before=await f.counts();
      const results=await Promise.allSettled([f.set(4,a),f.set(4,b)]);
      assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
      const failed=results.find(result=>result.status==='rejected');
      assert.ok(failed?.status==='rejected');assert.match(String(failed.reason),/CONTRACT_APPENDIX_CHANGED/);
      const selected=(await f.client.query<{document_version_id:string}>('SELECT document_version_id FROM contract_documents WHERE contract_version_id=$1 AND appendix_number=4',[f.contract.version_id])).rows[0];
      const after=await f.counts();assert.equal(after.audit,before.audit+1);assert.equal(after.outbox,before.outbox+1);
      await f.set(4,null,undefined,undefined,undefined,undefined,selected.document_version_id);
    });
    await t.test('canonical contract source reads exact selected versions, not latest document versions',async()=>{
      const repository=new RsGenerationRepository({withContext:(_input:unknown,work:(client:SqlClient)=>Promise<unknown>)=>f.context(work)} as never);
      await repository.setAppendix({...f.ids,contractId:f.contract.contract_id,versionId:f.contract.version_id,number:2,
        documentId:b.document_id,documentVersionId:b.document_version_id,expectedDocumentVersionId:null});
      const source=await repository.load({...f.ids,contractId:f.contract.contract_id,permission:'contract.read'});
      assert.ok(source);assert.deepEqual(source.appendixSelections,[{number:2,documentId:b.document_id,
        documentVersionId:b.document_version_id,name:'Technical appendix',version:'v1',available:true}]);
      await f.set(2,null,undefined,undefined,undefined,undefined,b.document_version_id);
    });
    await t.test('final document freezes appendix selection; signature also protects appendix bytes and links',async()=>{
      await f.set(1,a);
      let version:string;
      if(native){
        const race=await Promise.allSettled([
          f.context(c=>signatureDocument(c,f.ids.tenantId,f.ids.membershipId,f.contract.contract_id)),f.set(5,b),
        ]);
        if(race[0].status==='rejected')throw race[0].reason;
        version=race[0].value;
        if(race[1].status==='rejected')assert.match(String(race[1].reason),/NEW_VERSION_REQUIRED/);
        // Whichever transaction won, the bound version cannot be edited now.
        await assert.rejects(f.set(5,null,undefined,undefined,undefined,undefined,b.document_version_id),/NEW_VERSION_REQUIRED/);
      }else version=await f.context(c=>signatureDocument(c,f.ids.tenantId,f.ids.membershipId,f.contract.contract_id));
      assert.equal(version,f.contract.version_id);
      await assert.rejects(f.set(1,b),/NEW_VERSION_REQUIRED/);
      await f.context(async c=>{await c.query("SELECT app.transition_contract_status($1,$2,'sent','Technical test',$3)",[f.ids.tenantId,f.contract.contract_id,f.ids.membershipId]);await c.query("SELECT app.transition_contract_status($1,$2,'approved','Technical test',$3)",[f.ids.tenantId,f.contract.contract_id,f.ids.membershipId]);await c.query('SELECT * FROM app.sign_contract_externally($1,$2,$3,now(),$4,NULL)',[f.ids.tenantId,f.contract.contract_id,version,f.ids.membershipId]);});
      assert.equal((await f.client.query<{yes:boolean}>('SELECT app.document_has_signature_evidence($1,$2) yes',[f.ids.tenantId,a.document_id])).rows[0].yes,true);
      await assert.rejects(f.client.query('DELETE FROM contract_documents WHERE contract_version_id=$1 AND appendix_number=1',[version]),/COMMAND_REQUIRED|IMMUTABLE/);
      await assert.rejects(f.client.query('UPDATE documents SET archived_at=now() WHERE id=$1',[a.document_id]),/SIGNED_DOCUMENT_IMMUTABLE/);
    });
    await t.test('a shared signed file can be replaced or removed only from an unrelated editable draft',async()=>{
      const unit=(await f.client.query<{id:string}>("SELECT id FROM units WHERE tenant_id=$1 AND project_id=$2 AND commercial_status='available' AND id<>$3 ORDER BY code LIMIT 1",[f.ids.tenantId,f.unit.project_id,f.unit.id])).rows[0];
      assert.ok(unit);
      const next=await f.context(async c=>{
        const hold=(await c.query<{sales_case_id:string}>("SELECT * FROM app.create_party_and_unit_hold($1,$2,'pre_reservation',now()+interval '48 hours',$3,$4,'Shared appendix draft test','individual',NULL,'Technical','Draft',NULL,NULL,$5,NULL)",[f.ids.tenantId,unit.id,f.ids.membershipId,randomUUID(),`${randomUUID()}@example.test`])).rows[0];
        return(await c.query<{contract_id:string;version_id:string}>("SELECT * FROM app.create_contract_with_payment($1,$2,'rs',$3,'Shared appendix draft',$4,NULL,$5,'fixed',250000,now()+interval '7 days')",[f.ids.tenantId,hold.sales_case_id,`DRAFT-${randomUUID()}`,f.ids.membershipId,randomUUID()])).rows[0];
      });
      const select=(doc:typeof a|null,expected:string|null)=>f.context(c=>c.query('SELECT app.set_contract_appendix($1,$2,$3,1,$4,$5,$6,$7)',[f.ids.tenantId,next.contract_id,next.version_id,doc?.document_id??null,doc?.document_version_id??null,f.ids.membershipId,expected]));
      await select(a,null);
      await assert.rejects(f.context(c=>c.query('DELETE FROM contract_documents WHERE tenant_id=$1 AND contract_version_id=$2 AND appendix_number=1',[f.ids.tenantId,next.version_id])),{code:'42501'});
      await assert.rejects(f.client.query('DELETE FROM contract_documents WHERE tenant_id=$1 AND contract_version_id=$2 AND appendix_number=1',[f.ids.tenantId,next.version_id]),/COMMAND_REQUIRED/);
      const oldMigration=await readFile(new URL('../migrations/0057_price_and_signed_document_integrity.sql',import.meta.url),'utf8');
      const oldGuard=oldMigration.match(/CREATE OR REPLACE FUNCTION app\.guard_signed_document_link\(\)[\s\S]*?END \$\$;/)?.[0];
      assert.ok(oldGuard);await f.client.query(oldGuard);
      await assert.rejects(select(null,a.document_version_id),/SIGNED_DOCUMENT_IMMUTABLE/,'reproduces the pilot removal failure before 0070');
      await f.client.query(await readFile(new URL('../migrations/0070_shared_appendix_draft_link.sql',import.meta.url),'utf8'));
      await select(b,a.document_version_id);
      await select(a,b.document_version_id);
      if(native)await Promise.all(Array.from({length:4},()=>select(null,a.document_version_id)));
      else await select(null,a.document_version_id);
      await select(null,null);
      assert.equal((await f.client.query<{n:number}>('SELECT count(*)::int n FROM contract_documents WHERE tenant_id=$1 AND contract_version_id=$2 AND appendix_number IS NOT NULL',[f.ids.tenantId,next.version_id])).rows[0].n,0);
      assert.equal((await f.client.query<{n:number}>("SELECT count(*)::int n FROM audit_log WHERE entity_id=$1 AND action='contract.appendix_updated'",[next.version_id])).rows[0].n,4);
      assert.equal((await f.client.query<{n:number}>("SELECT count(*)::int n FROM outbox_events WHERE payload->>'contractVersionId'=$1::text AND event_type='contract.appendix_updated.v1'",[next.version_id])).rows[0].n,4);
      assert.equal((await f.client.query<{n:number}>('SELECT count(*)::int n FROM contract_documents WHERE tenant_id=$1 AND contract_version_id=$2 AND appendix_number=1 AND document_version_id=$3',[f.ids.tenantId,f.contract.version_id,a.document_version_id])).rows[0].n,1);
      await assert.rejects(f.set(1,null,undefined,undefined,undefined,undefined,a.document_version_id),/CONTRACT_APPENDIX_CONTRACT_NOT_EDITABLE/);
      await assert.rejects(f.client.query('UPDATE documents SET archived_at=now() WHERE id=$1',[a.document_id]),/SIGNED_DOCUMENT_IMMUTABLE/);
    });
  }finally{await f.close();}
});

for(const native of [false,true])test(`generation pins the exact appendix bundle (${native?'PostgreSQL':'PGlite'})`,{skip:native&&!process.env.WORKFLOW_TEST_DATABASE_URL},async()=>{
  const f=await fixture(native?process.env.WORKFLOW_TEST_DATABASE_URL:undefined);
  try{
    const documents:Awaited<ReturnType<typeof f.document>>[]=[];
    for(let index=0;index<6;index++)documents.push(await f.document());
    const spare=await f.document();
    for(let index=0;index<documents.length;index++)await f.set(index+1,documents[index]);
    const source=await f.document(),templateId=randomUUID(),templateVersionId=randomUUID();
    const schema={fields:{'project.name':{required:true}},appendices:contractAppendixRequirements('rs',ORIGINAL_DOB_FULL_VARIANT)};
    // Metadata-only synthetic template in a disposable DB, never a legal activation.
    await f.client.query("INSERT INTO document_templates(id,tenant_id,project_id,code,name,output_type_code,contract_type,variant_key,created_by_membership_id) VALUES($1,$2,$3,'technical-appendix-test','Technical appendix test','reservation_contract','rs',$4,$5)",
      [templateId,f.ids.tenantId,f.unit.project_id,ORIGINAL_DOB_FULL_VARIANT,f.ids.membershipId]);
    await f.client.query("INSERT INTO document_template_versions(id,tenant_id,project_id,template_id,source_document_id,source_document_version_id,version_label,content_hash,placeholder_schema,approval_status,approved_at,approved_by_membership_id,created_by_membership_id,validation_result,validated_at,validated_by_membership_id) VALUES($1,$2,$3,$4,$5,$6,'technical-v1',$7,$8,'approved',now(),$9,$9,'{\"valid\":true,\"errors\":[]}',now(),$9)",
      [templateVersionId,f.ids.tenantId,f.unit.project_id,templateId,source.document_id,source.document_version_id,`sha256:${'b'.repeat(64)}`,schema,f.ids.membershipId]);
    const c=(await f.client.query<{sales_case_id:string}>('SELECT sales_case_id FROM contracts WHERE id=$1',[f.contract.contract_id])).rows[0];
    const party=(await f.client.query<{party_id:string}>('SELECT party_id FROM sales_case_parties WHERE sales_case_id=$1 AND left_at IS NULL LIMIT 1',[c.sales_case_id])).rows[0];
    const template:TemplateSource={templateId,templateVersionId,projectId:f.unit.project_id,templateCode:'technical-appendix-test',templateName:'Technical appendix test',outputTypeCode:'reservation_contract',
      versionLabel:'technical-v1',contentHash:`sha256:${'b'.repeat(64)}`,schema,approvalStatus:'approved',effectiveFrom:'2026-01-01',driveId:'fixture-drive',itemId:'fixture-template',externalVersionId:'1.0',variantKey:ORIGINAL_DOB_FULL_VARIANT};
    const database={withContext:(_input:unknown,work:(client:SqlClient)=>Promise<unknown>)=>f.context(work)};
    const generation=new DocumentTemplateGenerationRepository(database as never),contracts=new RsGenerationRepository(database as never);
    const selection={versionId:f.contract.version_id,items:documents.map((document,index)=>({number:index+1,documentId:document.document_id,documentVersionId:document.document_version_id}))};
    const input={...f.ids,projectId:f.unit.project_id,template,idempotencyKey:randomUUID(),requestHash:'c'.repeat(64),unitId:f.unit.id,partyId:party.party_id,salesCaseId:c.sales_case_id,
      contractId:f.contract.contract_id,snapshot:{'project.name':'Technical only'},contractAppendices:selection};
    await assert.rejects(generation.reserve({...input,contractAppendices:{...selection,items:[...selection.items.slice(1)]}}),/CONTRACT_APPENDIX_CHANGED/);
    const reserved=native?await Promise.all(Array.from({length:4},()=>generation.reserve(input))):[await generation.reserve(input)];
    assert.equal(new Set(reserved.map(operation=>operation.id)).size,1);
    const operation=reserved[0],retry=await generation.reserve(input);assert.equal(retry.id,operation.id);
    const recorded=(await f.client.query<{appendix_snapshot:Array<Record<string,unknown>>;contract_preparation_version_id:string}>('SELECT appendix_snapshot,contract_preparation_version_id FROM document_generation_operations WHERE id=$1',[operation.id])).rows[0];
    assert.equal(recorded.contract_preparation_version_id,f.contract.version_id);assert.equal(recorded.appendix_snapshot.length,6);
    assert.deepEqual(recorded.appendix_snapshot.map(item=>({number:item.number,documentId:item.documentId,documentVersionId:item.documentVersionId})),selection.items);
    for(const item of recorded.appendix_snapshot){assert.equal(item.hash,`sha256:${'b'.repeat(64)}`);assert.equal(item.externalVersionId,'1.0');}
    await assert.rejects(f.set(1,spare,undefined,undefined,undefined,undefined,documents[0].document_version_id),/GENERATION_STARTED/);
    await assert.rejects(f.client.query('UPDATE documents SET archived_at=now() WHERE id=$1',[documents[0].document_id]),/DOCUMENT_IN_USE/);
    await assert.rejects(f.context(client=>client.query("UPDATE document_generation_operations SET appendix_snapshot='[]' WHERE id=$1",[operation.id])),/SNAPSHOT_IMMUTABLE/);
    await assert.rejects(f.context(client=>signatureDocument(client,f.ids.tenantId,f.ids.membershipId,f.contract.contract_id)),/DOCUMENT_GENERATION_IN_PROGRESS|CONTRACT_APPENDIX_CHANGED/);
    assert.equal((await generation.reserve(input)).id,operation.id,'failure before binding preserves the retry operation');
    const final=await f.context(async client=>{
      const op=(await client.query<{id:string}>("SELECT app.reserve_document_upload($1,$2,$3,$4,'create',NULL,'reservation_contract','Technical generated evidence','fixture.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document',16,$5,'v1','ready',NULL,$6,NULL,$7,$8,$9) id",
        [f.ids.tenantId,f.unit.project_id,`generation:${operation.id}`,'a'.repeat(64),`sha256:${'b'.repeat(64)}`,f.unit.id,f.contract.contract_id,c.sales_case_id,f.ids.membershipId])).rows[0].id;
      await client.query("SELECT app.record_document_graph_upload($1,$2,'fixture-drive',$3,'https://sharepoint.example.test/generated','etag','1.0',16,$4)",[f.ids.tenantId,op,randomUUID(),f.ids.membershipId]);
      return(await client.query<{document_id:string;document_version_id:string}>('SELECT * FROM app.finalize_document_upload($1,$2,$3)',[f.ids.tenantId,op,f.ids.membershipId])).rows[0];
    });
    await generation.complete({...f.ids,operationId:operation.id,documentId:final.document_id,documentVersionId:final.document_version_id,renderedContentHash:`sha256:${'b'.repeat(64)}`});
    const bind={...f.ids,contractId:f.contract.contract_id,operationId:operation.id,documentId:final.document_id,documentVersionId:final.document_version_id,templateVersionId,snapshot:input.snapshot};
    const bound=await contracts.bind(bind);assert.equal(bound.versionId,f.contract.version_id);assert.deepEqual(await contracts.bind(bind),bound);
    await f.context(client=>client.query('SELECT app.assert_contract_appendices($1,$2,$3)',[f.ids.tenantId,f.contract.contract_id,bound.versionId]));
    await assert.rejects(f.set(1,spare,undefined,undefined,undefined,undefined,documents[0].document_version_id),/NEW_VERSION_REQUIRED|GENERATION_STARTED/);
    assert.deepEqual((await f.client.query<{appendix_snapshot:unknown}>('SELECT appendix_snapshot FROM document_generation_operations WHERE id=$1',[operation.id])).rows[0].appendix_snapshot,recorded.appendix_snapshot);
  }finally{await f.close();}
});

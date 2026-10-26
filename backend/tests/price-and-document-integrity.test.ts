import assert from "node:assert/strict";
import test from "node:test";
import {readFile,readdir} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {PGlite} from "@electric-sql/pglite";
import {Pool} from 'pg';
import {bootstrapIds,bootstrapPilotWorkspace,normalizeBootstrapInput} from "../src/iam/pilot-bootstrap.js";
import {importDejvice} from "../src/imports/dejvice.js";
import {InventoryImportService} from "../src/inventory/import-service.js";
import {Database,type SqlClient} from "../src/database.js";
import {DocumentRepository} from "../src/documents/repository.js";
import {SharePointDocumentUploadService,SharePointUploadError} from "../src/documents/upload-service.js";
import {ContractDocumentEvidenceService,ContractDocumentError} from "../src/contracts/document-evidence-service.js";
import type {MicrosoftGraphAdapter,GraphFileMetadata} from "../src/documents/graph-adapter.js";
import {DocumentTemplateGenerationRepository} from "../src/documents/template-generation-repository.js";
import {DocumentTemplateGenerationService} from "../src/documents/template-generation-service.js";
import {DocumentTemplateManagementService} from "../src/documents/template-management-service.js";
import {DocumentTemplateManagementRepository} from "../src/documents/template-management-repository.js";
import {RsGenerationRepository} from "../src/contracts/rs-generation-repository.js";
import {RsGenerationService} from "../src/contracts/rs-generation-service.js";
import {InventoryRepository} from "../src/inventory/repository.js";
import {CommercialRepository} from "../src/commercial/repository.js";
import {CommercialService} from '../src/commercial/service.js';
import {ConsistencyChecker} from '../src/diagnostics/consistency-checker.js';
import {ORIGINAL_DOB_FULL_VARIANT,templateCatalog} from '../src/documents/template-catalog.js';
import {createHash} from 'node:crypto';
import {isCzechWorkingDay} from '../src/contracts/czech-working-days.js';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';

async function fixture(postgresUrl?:string){
  const memory=postgresUrl?undefined:new PGlite();
  const databaseName=`document_integrity_${randomUUID().replaceAll('-','')}`;
  const admin=postgresUrl?new Pool({connectionString:postgresUrl}):undefined;
  if(admin)await admin.query(`CREATE DATABASE "${databaseName}"`);
  const url=postgresUrl?new URL(postgresUrl):undefined;if(url)url.pathname=`/${databaseName}`;
  const pool=url?new Pool({connectionString:url.toString(),max:1}):undefined;
  const db={
    query:async<T=Record<string,unknown>>(sql:string,values?:unknown[]):Promise<{rows:T[];affectedRows?:number}>=>{
      if(memory)return memory.query<T>(sql,values);
      const result=await pool!.query(sql,values);return{rows:result.rows as T[],affectedRows:result.rowCount??undefined};
    },
    exec:async(sql:string)=>{if(memory)await memory.exec(sql);else await pool!.query(sql);},
    close:async()=>{if(memory)await memory.close();if(pool)await pool.end();if(admin){await admin.query(`DROP DATABASE "${databaseName}"`);await admin.end();}},
  };
  const directory=new URL("../migrations/",import.meta.url);
  for(const name of (await readdir(directory)).filter(n=>/^\d+.*\.sql$/.test(n)&&!n.startsWith('0057')).sort())await db.exec(await readFile(new URL(name,directory),'utf8'));
  const normalized=normalizeBootstrapInput({entraTenantId:randomUUID(),adminOid:randomUUID(),adminEmail:"evidence@example.test",adminName:"Evidence Test",workspaceName:"Evidence Test",workspaceId:randomUUID()});
  const ids=bootstrapIds(normalized);const client={query:async(sql:string,values?:unknown[])=>{if(!values&&sql.includes(';')){await db.exec(sql);return{rows:[],rowCount:null};}const r=await db.query(sql,values);return{rows:r.rows,rowCount:r.affectedRows??null};}} as SqlClient;
  await bootstrapPilotWorkspace(client,{...normalized,...ids});
  await importDejvice(client,await readFile(new URL('../seeds/0004_pilot_rezidence_dejvice.sql',import.meta.url),'utf8'),{tenantId:ids.tenantId,membershipId:ids.membershipId,dryRun:false});
  await db.exec(await readFile(new URL('0057_price_and_signed_document_integrity.sql',directory),'utf8'));
  const context={tenantId:ids.tenantId,userId:ids.userId,membershipId:ids.membershipId};
  const database={withContext:async(_input:unknown,work:(c:SqlClient)=>Promise<unknown>)=>{await db.exec('BEGIN');try{await db.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)",[ids.tenantId,ids.userId]);const r=await work(client);await db.exec('COMMIT');return r;}catch(e){await db.exec('ROLLBACK');throw e;}}} as unknown as Database;
  const projectId=(await db.query<{id:string}>("SELECT id FROM projects WHERE tenant_id=$1 LIMIT 1",[ids.tenantId])).rows[0].id;
  const inventory=new InventoryImportService(database);
  async function start(unitId?:string,signaturePayments=false){const unit=unitId?{id:unitId}:(await db.query<{id:string}>("SELECT id FROM units WHERE tenant_id=$1 AND commercial_status='available' AND project_id=$2 AND NOT EXISTS(SELECT 1 FROM sales_cases s WHERE s.unit_id=units.id AND s.status='active') AND app.current_unit_price(units.tenant_id,units.id,now())>=1000000 ORDER BY units.code,units.id LIMIT 1",[ids.tenantId,projectId])).rows[0];
    const hold=(await db.query<{sales_case_id:string;party_id:string}>("SELECT * FROM app.create_party_and_unit_hold($1,$2,'pre_reservation',now()+interval '48 hours',$3,$4,'Test','individual',NULL,'Evidence',$6,NULL,NULL,$5,NULL)",[ids.tenantId,unit.id,ids.membershipId,randomUUID(),`${randomUUID()}@example.test`,`Buyer ${randomUUID()}`])).rows[0];
    const sql=signaturePayments?"SELECT * FROM app.create_contract_with_signature_payments($1,$2,'rs',$3,'Technical RS',$4,$5,'fixed',250000)":"SELECT * FROM app.create_contract_with_payment($1,$2,'rs',$3,'Technical RS',$4,NULL,$5,'fixed',250000,now()+interval '7 days')";
    const c=(await db.query<{contract_id:string;version_id:string}>(sql,[ids.tenantId,hold.sales_case_id,`EVID-${randomUUID()}`,ids.membershipId,randomUUID()])).rows[0];return{...c,unitId:unit.id,partyId:hold.party_id,salesCaseId:hold.sales_case_id};}
  async function approve(c:{contract_id:string}){for(const status of ['sent','approved'])await db.query("SELECT app.transition_contract_status($1,$2,$3,'Test',$4)",[ids.tenantId,c.contract_id,status,ids.membershipId]);}
  const sign=(c:{contract_id:string;version_id:string})=>db.query("SELECT * FROM app.sign_contract_externally($1,$2,$3,now(),$4,NULL)",[ids.tenantId,c.contract_id,c.version_id,ids.membershipId]);
  const fileBytes=new TextEncoder().encode('%PDF-1.4\nTechnical evidence fixture\n%%EOF');const files=new Map<string,{meta:GraphFileMetadata;bytes:Uint8Array}>();const nativeVersions=new Map<string,Uint8Array[]>();
  const graph:MicrosoftGraphAdapter={getSite:async()=>null,listSiteDrives:async()=>[],delta:async()=>({items:[],deletedItemIds:[],nextCursor:null}),
    listFiles:async(_c,parent='root')=>[...files.values()].map(f=>f.meta).filter(m=>m.parentItemId===parent),
    createFolder:async(_c,parent,name)=>{const meta={driveId:'drive',itemId:randomUUID(),name,mimeType:null,size:0,etag:null,webUrl:null,parentItemId:parent,isFolder:true};files.set(meta.itemId,{meta,bytes:new Uint8Array()});return meta;},
    uploadFile:async(_c,parent,name,bytes,mimeType)=>{const previous=[...files.values()].find(f=>f.meta.parentItemId===parent&&f.meta.name===name&&!f.meta.isFolder);const meta={driveId:'drive',itemId:previous?.meta.itemId??randomUUID(),name,mimeType,size:bytes.length,etag:randomUUID(),webUrl:'https://sharepoint.example.test/evidence',parentItemId:parent,isFolder:false};files.set(meta.itemId,{meta,bytes});nativeVersions.set(meta.itemId,[...(nativeVersions.get(meta.itemId)??[]),bytes]);return meta;},
    getVersions:async(_c,id)=>(nativeVersions.get(id)??[]).map((bytes,index)=>({id:`${index+1}.0`,label:`${index+1}.0`,size:bytes.length,etag:null,createdAt:null})).reverse(),getFileMetadata:async(_c,id)=>files.get(id)?.meta??null,
    downloadFile:async(_c,id,version)=>{const versions=nativeVersions.get(id)??[];const index=version?Number(version.split('.')[0])-1:versions.length-1;return index<versions.length-1?versions[index]:files.get(id)!.bytes;},moveOrRenameFile:async()=>{throw new Error('unused');}};
  const mi=randomUUID();await db.query("INSERT INTO sharepoint_connections(tenant_id,name,entra_tenant_id,site_id,drive_id,credential_reference,connection_status,created_by_membership_id) VALUES($1,'Test',$2,'site','drive',$3,'connected',$4)",[ids.tenantId,randomUUID(),`managed-identity://${mi}`,ids.membershipId]);
  const uploads=new SharePointDocumentUploadService(new DocumentRepository(database),graph,mi);const evidence=new ContractDocumentEvidenceService(database,graph,uploads,mi);
  async function external(c:{contract_id:string}){return evidence.uploadExternal({...context,contractId:c.contract_id,idempotencyKey:randomUUID(),fileName:'final.pdf',mimeType:'application/pdf',bytes:fileBytes});}
  const templates=new DocumentTemplateGenerationService(new DocumentTemplateGenerationRepository(database),new DocumentRepository(database),uploads,graph);
  const management=new DocumentTemplateManagementService(new DocumentTemplateManagementRepository(database),new DocumentTemplateGenerationRepository(database),new DocumentRepository(database),uploads,graph);
  const rs=new RsGenerationService(new RsGenerationRepository(database),templates);
  return{db,database,connectionUrl:url?.toString(),context,projectId,inventory,start,approve,sign,evidence,external,uploads,files,fileBytes,templates,management,rs,graph};
}

for(const usePostgres of [false,true])test(`price creation and signed document integrity (${usePostgres?'PostgreSQL':'PGlite'})`,{skip:usePostgres&&!process.env.WORKFLOW_TEST_DATABASE_URL},async t=>{
  const f=await fixture(usePostgres?process.env.WORKFLOW_TEST_DATABASE_URL:undefined);try{
    await t.test('SQL calendar matches the canonical Czech calendar for every supported date',async()=>{
      const days=(await f.db.query<{day:string;working:boolean}>("SELECT to_char(d,'YYYY-MM-DD') AS day,app.contract_working_day_2026_v1(d::date) working FROM generate_series(DATE '2016-01-01',DATE '2099-12-31',interval '1 day') d")).rows;
      assert.equal(days.length,30681);
      for(const day of days)assert.equal(day.working,isCzechWorkingDay(day.day),day.day);
      await assert.rejects(f.db.query("SELECT app.contract_working_day_2026_v1(DATE '2100-01-01')"),/unsupported_contract_calendar_year/);
    });
    await t.test('signature-bound RS: no premature obligation, actual signature plus three working days, immutable plan and retry',async()=>{
      const c=await f.database.withContext(f.context,()=>f.start(undefined,true));
      const count=async()=>(await f.db.query<{n:number}>("SELECT count(*)::int n FROM payment_obligations WHERE contract_id=$1",[c.contract_id])).rows[0].n;
      assert.equal(await count(),0);
      const plan=(await f.db.query<{payment_terms_snapshot:Record<string,unknown>}>('SELECT payment_terms_snapshot FROM contract_versions WHERE id=$1',[c.version_id])).rows[0].payment_terms_snapshot;
      assert.equal(plan.calendarPolicy,'cz-2026-v1');
      const loaded=await new RsGenerationRepository(f.database).load({...f.context,contractId:c.contract_id,permission:'contract.read'});
      assert.deepEqual(loaded?.paymentTerms,plan);assert.equal(loaded?.variableSymbol,plan.variableSymbol);
      assert.equal(loaded?.hasPaymentObligations,false);
      await f.database.withContext(f.context,client=>client.query('SELECT app.prepare_signature_payment_terms($1,$2,$3)',[f.context.tenantId,c.contract_id,f.context.membershipId]));
      const original=(await f.db.query<{idempotency_key:string;reference:string}>('SELECT idempotency_key,reference FROM contracts WHERE id=$1',[c.contract_id])).rows[0];
      const retry=(fee:number)=>f.database.withContext(f.context,client=>client.query("SELECT * FROM app.create_contract_with_signature_payments($1,$2,'rs',$3,'Technical RS',$4,$5,'fixed',$6)",[f.context.tenantId,c.salesCaseId,original.reference,f.context.membershipId,original.idempotency_key,fee]));
      assert.equal((await retry(250000)).rows[0].contract_id,c.contract_id);
      await assert.rejects(retry(260000),/IDEMPOTENCY_MISMATCH/);
      const next=(await f.database.withContext(f.context,client=>client.query<{id:string}>("SELECT app.create_contract_version($1,$2,'New draft','manual',$3,$4,'{}'::jsonb) id",[f.context.tenantId,c.contract_id,f.context.membershipId,c.version_id]))).rows[0].id;
      assert.deepEqual((await f.db.query<{payment_terms_snapshot:unknown}>('SELECT payment_terms_snapshot FROM contract_versions WHERE id=$1',[next])).rows[0].payment_terms_snapshot,plan);
      c.version_id=next;
      const uploaded=await f.external(c);c.version_id=uploaded.versionId;
      await assert.rejects(f.db.query('UPDATE contract_versions SET payment_terms_snapshot=NULL WHERE id=$1',[c.version_id]),/PAYMENT_TERMS_VERSION_IMMUTABLE|immutable/);
      await f.approve(c);
      // Thursday before Easter: Friday and Monday are public holidays.
      const sign=()=>f.database.withContext(f.context,async client=>{
        await client.query('SET LOCAL ROLE develocrm_app');
        return client.query("SELECT * FROM app.sign_contract_externally($1,$2,$3,'2026-04-02T21:30:00Z',$4,NULL)",[f.context.tenantId,c.contract_id,c.version_id,f.context.membershipId]);
      });
      await sign();await sign();assert.equal(await count(),1);
      const obligation=(await f.db.query<{schedule_key:string;contract_version_id:string;amount:string;due_day:string}>("SELECT schedule_key,contract_version_id,amount::text,to_char(due_at AT TIME ZONE 'Europe/Prague','YYYY-MM-DD HH24:MI:SS') due_day FROM payment_obligations WHERE contract_id=$1",[c.contract_id])).rows[0];
      assert.equal(obligation.schedule_key,'rs_fee');assert.equal(obligation.contract_version_id,c.version_id);
      assert.equal(Number(obligation.amount),250000);assert.equal(obligation.due_day,'2026-04-09 23:59:59');
      const events=(await f.db.query<{n:number}>("SELECT count(*)::int n FROM payment_events WHERE obligation_id IN(SELECT id FROM payment_obligations WHERE contract_id=$1) AND event_type='obligation.created'",[c.contract_id])).rows[0].n;
      assert.equal(events,1);
      await assert.rejects(f.database.withContext(f.context,client=>client.query("SELECT app.materialize_signature_payment($1,$2,$3,'rs_fee',DATE '2026-04-01',$4)",[f.context.tenantId,c.contract_id,c.version_id,f.context.membershipId])),/ANCHOR_EVIDENCE_REQUIRED/);
      const materialize=(tenant:string,actor:string)=>f.database.withContext(f.context,client=>client.query("SELECT app.materialize_signature_payment($1,$2,$3,'rs_fee',DATE '2026-04-02',$4)",[tenant,c.contract_id,c.version_id,actor]));
      await assert.rejects(materialize(randomUUID(),f.context.membershipId),/tenant context/);
      await assert.rejects(materialize(f.context.tenantId,randomUUID()),/permission required/);
      await assert.rejects(f.database.withContext(f.context,async client=>{
        await client.query('DELETE FROM project_role_assignments WHERE tenant_id=$1 AND project_id=$2 AND membership_id=$3',[f.context.tenantId,f.projectId,f.context.membershipId]);
        await client.query('DELETE FROM project_custom_access WHERE tenant_id=$1 AND project_id=$2 AND membership_id=$3',[f.context.tenantId,f.projectId,f.context.membershipId]);
        await client.query('SET LOCAL ROLE develocrm_app');
        return client.query("SELECT app.materialize_signature_payment($1,$2,$3,'rs_fee',DATE '2026-04-02',$4)",[f.context.tenantId,c.contract_id,c.version_id,f.context.membershipId]);
      }),/permission required/);
      // Authorized due-date extensions are not silently undone by a retry.
      await f.database.withContext(f.context,client=>client.query("SELECT app.change_payment_obligation_due_date($1,(SELECT id FROM payment_obligations WHERE contract_id=$2),'2027-01-15T22:59:59Z','Technical extension',$3,$4)",[f.context.tenantId,c.contract_id,randomUUID(),f.context.membershipId]));
      await materialize(f.context.tenantId,f.context.membershipId);
      assert.equal((await f.db.query<{due_day:string}>("SELECT to_char(due_at AT TIME ZONE 'Europe/Prague','YYYY-MM-DD') due_day FROM payment_obligations WHERE contract_id=$1",[c.contract_id])).rows[0].due_day,'2027-01-15');
    });
    await t.test('recording a signed RS materializes its agreed fee without granting financial management',async()=>{
      const c=await f.database.withContext(f.context,()=>f.start(undefined,true));const document=await f.external(c);c.version_id=document.versionId;await f.approve(c);
      const rollback=new Error('intentional-test-rollback');
      await assert.rejects(f.database.withContext(f.context,async client=>{
        await client.query('DELETE FROM project_role_assignments WHERE tenant_id=$1 AND project_id=$2 AND membership_id=$3',[f.context.tenantId,f.projectId,f.context.membershipId]);
        await client.query('DELETE FROM project_custom_access WHERE tenant_id=$1 AND project_id=$2 AND membership_id=$3',[f.context.tenantId,f.projectId,f.context.membershipId]);
        await client.query(`INSERT INTO project_custom_access(tenant_id,project_id,membership_id,area,access_level,permission_overrides,assigned_by_user_id)
          VALUES($1,$2,$3,'contracts','edit',ARRAY['contracts.record_signature'],$4),($1,$2,$3,'units','edit',ARRAY[]::text[],$4),($1,$2,$3,'documents','read',ARRAY[]::text[],$4)`,[f.context.tenantId,f.projectId,f.context.membershipId,f.context.userId]);
        await client.query('SET LOCAL ROLE develocrm_app');
        const permission=(await client.query<{finance:boolean;sign:boolean}>("SELECT app.has_project_permission($1,$2,$3,'payments.manage') finance,app.has_project_permission($1,$2,$3,'contract.sign') sign",[f.context.tenantId,f.context.membershipId,f.projectId])).rows[0];
        assert.deepEqual(permission,{finance:false,sign:true});
        await client.query("SELECT * FROM app.sign_contract_externally($1,$2,$3,'2026-04-02T10:00:00Z',$4,NULL)",[f.context.tenantId,c.contract_id,c.version_id,f.context.membershipId]);
        await client.query('RESET ROLE');
        assert.equal((await client.query<{n:number}>("SELECT count(*)::int n FROM payment_obligations WHERE contract_id=$1 AND schedule_key='rs_fee'",[c.contract_id])).rows[0].n,1);
        throw rollback;
      }),error=>error===rollback);
    });
    await t.test('different signature days use the approved last-required-signature anchor',async()=>{
      const c=await f.database.withContext(f.context,()=>f.start(undefined,true));
      const other=await f.start();
      await f.db.query("INSERT INTO contract_parties(tenant_id,project_id,contract_id,party_id,participant_role,signing_required) VALUES($1,$2,$3,$4,'seller',true)",[f.context.tenantId,f.projectId,c.contract_id,other.partyId]);
      const doc=await f.external(c);c.version_id=doc.versionId;await f.approve(c);
      // The later signature was recorded first: entry order must not determine
      // the legal day. The other party's earlier signature is recorded now.
      await f.db.query("UPDATE contract_parties SET signature_status='signed',signed_at='2026-04-02T10:00:00Z',signed_version_id=$1 WHERE contract_id=$2 AND party_id=$3",[c.version_id,c.contract_id,c.partyId]);
      await f.database.withContext(f.context,client=>client.query("SELECT * FROM app.sign_contract_externally($1,$2,$3,'2026-04-01T10:00:00Z',$4,NULL)",[f.context.tenantId,c.contract_id,c.version_id,f.context.membershipId]));
      assert.equal((await f.db.query<{current_status:string}>('SELECT current_status FROM contracts WHERE id=$1',[c.contract_id])).rows[0].current_status,'signed');
      const obligation=(await f.db.query<{due_day:string}>("SELECT to_char(due_at AT TIME ZONE 'Europe/Prague','YYYY-MM-DD') due_day FROM payment_obligations WHERE contract_id=$1",[c.contract_id])).rows;
      assert.deepEqual(obligation,[{due_day:'2026-04-09'}]);
    });
    await t.test('SBK signature and evidenced notice create distinct, idempotent installments without premature final due date',async()=>{
      const rs=await f.database.withContext(f.context,()=>f.start(undefined,true));
      const rsDoc=await f.external(rs);rs.version_id=rsDoc.versionId;await f.approve(rs);
      const run=(sql:string,parameters:unknown[])=>f.database.withContext(f.context,client=>client.query(sql,parameters));
      await run("SELECT * FROM app.sign_contract_externally($1,$2,$3,'2026-04-02T10:00:00Z',$4,NULL)",[f.context.tenantId,rs.contract_id,rs.version_id,f.context.membershipId]);
      const rsObligation=(await f.db.query<{id:string}>('SELECT id FROM payment_obligations WHERE contract_id=$1',[rs.contract_id])).rows[0].id;
      await run("SELECT app.record_payment($1,$2,250000,'2026-04-07T10:00:00Z',NULL,NULL,NULL,NULL,$3,$4)",[f.context.tenantId,rsObligation,randomUUID(),f.context.membershipId]);
      const key=randomUUID();
      const create=()=>run("SELECT * FROM app.create_contract_with_signature_payments($1,$2,'sbk','TECH66-SBK','Technical SBK',$3,$4,NULL,NULL)",[f.context.tenantId,rs.salesCaseId,f.context.membershipId,key]);
      const created=(await create()).rows[0] as {contract_id:string;version_id:string};
      assert.deepEqual((await create()).rows[0],created);
      const rows=async()=>(await f.db.query<{id:string;schedule_key:string;amount:string;due_day:string}>("SELECT id,schedule_key,amount::text,to_char(due_at AT TIME ZONE 'Europe/Prague','YYYY-MM-DD') due_day FROM payment_obligations WHERE contract_id=$1 ORDER BY schedule_key",[created.contract_id])).rows;
      assert.equal((await rows()).length,0);
      const doc=await f.external(created);created.version_id=doc.versionId;await f.approve(created);
      const sign=()=>run("SELECT * FROM app.sign_contract_externally($1,$2,$3,'2026-04-10T10:00:00Z',$4,NULL)",[f.context.tenantId,created.contract_id,created.version_id,f.context.membershipId]);
      if(f.connectionUrl){
        const parallel=new Database(f.connectionUrl);
        try{await Promise.all([1,2].map(()=>parallel.withContext(f.context,client=>client.query("SELECT * FROM app.sign_contract_externally($1,$2,$3,'2026-04-10T10:00:00Z',$4,NULL)",[f.context.tenantId,created.contract_id,created.version_id,f.context.membershipId]))));}
        finally{await parallel.close();}
      }else await sign();
      await sign();
      const first=await rows();assert.equal(first.length,1);assert.equal(first[0].schedule_key,'sbk_first');assert.equal(first[0].due_day,'2026-04-17');
      await assert.rejects(run("SELECT app.materialize_signature_payment($1,$2,$3,'sbk_final',DATE '2026-04-13',$4)",[f.context.tenantId,created.contract_id,created.version_id,f.context.membershipId]),/ANCHOR_EVIDENCE_REQUIRED/);
      const proof=await f.uploads.upload({...f.context,projectId:f.projectId,contractId:created.contract_id,salesCaseId:rs.salesCaseId,unitId:rs.unitId,
        idempotencyKey:randomUUID(),typeCode:'amendment',documentName:'Technical delivery evidence',fileName:'delivery.pdf',mimeType:'application/pdf',bytes:f.fileBytes,versionLabel:'delivery 1',status:'ready'});
      const noticeKey=randomUUID();
      const notice=(evidence=proof.documentVersionId,day='2026-04-13')=>run('SELECT app.record_sbk_final_notice($1,$2,$3,$4::date,$5,$6,$7)',[f.context.tenantId,created.contract_id,created.version_id,day,evidence,f.context.membershipId,noticeKey]);
      await assert.rejects(notice(randomUUID()),/DELIVERY_EVIDENCE_REQUIRED/);
      await assert.rejects(notice(proof.documentVersionId,'2026-04-01'),/INVALID_DELIVERY_DATE/);
      const input={...f.context,contractId:created.contract_id,versionId:created.version_id,deliveredOn:'2026-04-13',idempotencyKey:noticeKey,fileName:'delivery.pdf',mimeType:'application/pdf',bytes:f.fileBytes};
      const before=f.files.size;
      await assert.rejects(f.evidence.recordFinalNotice({...input,deliveredOn:'2026-04-01'}),/INVALID_DELIVERY_DATE/);
      await assert.rejects(f.evidence.recordFinalNotice({...input,versionId:randomUUID()}),/CURRENT_VERSION_REQUIRED/);
      assert.equal(f.files.size,before,'invalid requests do not upload a file');
      const failure=new Error('technical test DB outage after persisted Graph upload');
      const failingDatabase={withContext:async(context:typeof f.context,work:(client:SqlClient)=>Promise<unknown>)=>f.database.withContext(context,client=>work({query:async(sql,parameters)=>{
        if(sql.includes('SELECT app.record_sbk_final_notice'))throw failure;
        return client.query(sql,parameters);
      }}))} as unknown as Database;
      const failing=new ContractDocumentEvidenceService(failingDatabase,{} as never,f.uploads,'unused');
      await assert.rejects(failing.recordFinalNotice(input),error=>error===failure);
      assert.equal((await rows()).length,1,'no final obligation after failed DB transaction');
      const persistedFiles=f.files.size;assert.ok(persistedFiles>before);
      const recorded=await f.evidence.recordFinalNotice(input);assert.equal(recorded.replayed,true);
      assert.deepEqual(await f.evidence.recordFinalNotice(input),recorded);assert.equal(f.files.size,persistedFiles,'retry does not create another physical file');
      assert.equal(recorded.context?.notice?.deliveredOn,'2026-04-13');assert.equal(recorded.context?.notice?.dueOn,'2026-05-13');assert.equal(recorded.context?.canRecord,false);
      await assert.rejects(run('SELECT app.sbk_final_notice_context($1,$2,$3)',[randomUUID(),created.contract_id,f.context.membershipId]),/tenant context/);
      await assert.rejects(run('SELECT app.sbk_final_notice_context($1,$2,$3)',[f.context.tenantId,created.contract_id,randomUUID()]),/permission required/);
      await assert.rejects(f.database.withContext(f.context,async client=>{
        await client.query('DELETE FROM project_role_assignments WHERE tenant_id=$1 AND project_id=$2 AND membership_id=$3',[f.context.tenantId,f.projectId,f.context.membershipId]);
        await client.query('DELETE FROM project_custom_access WHERE tenant_id=$1 AND project_id=$2 AND membership_id=$3',[f.context.tenantId,f.projectId,f.context.membershipId]);
        await client.query('SET LOCAL ROLE develocrm_app');
        return client.query('SELECT app.sbk_final_notice_context($1,$2,$3)',[f.context.tenantId,created.contract_id,f.context.membershipId]);
      }),/permission required/);
      const rollback=new Error('restore project grants after successful notice-context test');
      await assert.rejects(f.database.withContext(f.context,async client=>{
        await client.query('DELETE FROM project_role_assignments WHERE tenant_id=$1 AND project_id=$2 AND membership_id=$3',[f.context.tenantId,f.projectId,f.context.membershipId]);
        await client.query('DELETE FROM project_custom_access WHERE tenant_id=$1 AND project_id=$2 AND membership_id=$3',[f.context.tenantId,f.projectId,f.context.membershipId]);
        await client.query("INSERT INTO project_custom_access(tenant_id,project_id,membership_id,area,access_level,assigned_by_user_id) VALUES($1,$2,$3,'contracts','read',$4)",[f.context.tenantId,f.projectId,f.context.membershipId,f.context.userId]);
        await client.query('SET LOCAL ROLE develocrm_app');
        const result=(await client.query<{context:import('../src/shared/sbk-final-notice.js').SbkFinalNoticeContext;finance:boolean}>("SELECT app.sbk_final_notice_context($1,$2,$3) context,app.has_project_permission($1,$3,$4,'payments.read') finance",[f.context.tenantId,created.contract_id,f.context.membershipId,f.projectId])).rows[0];
        assert.equal(result.finance,false);assert.equal(result.context.notice?.dueOn,'2026-05-13');assert.equal(result.context.notice?.webUrl,null);assert.equal(result.context.canRecord,false);
        throw rollback;
      }),error=>error===rollback);
      const all=await rows();assert.equal(all.length,2);assert.equal(all.find(r=>r.schedule_key==='sbk_final')?.due_day,'2026-05-13');
      const total=Number((await f.db.query<{total:string}>('SELECT total_price_snapshot::text total FROM contracts WHERE id=$1',[created.contract_id])).rows[0].total);
      assert.equal(all.reduce((sum,r)=>sum+Number(r.amount),250000),total);
      await assert.rejects(notice(proof.documentVersionId,'2026-04-14'),/DELIVERY_ALREADY_RECORDED/);
      assert.equal((await f.db.query<{n:number}>("SELECT count(*)::int n FROM payment_events WHERE event_type='contract.final_notice_delivered' AND payload->>'contractVersionId'=$1",[created.version_id])).rows[0].n,1);
    });
    await t.test('canonical accessory legal facts: atomic update, isolation, category validation and retry',async()=>{
      const repository=new InventoryRepository(f.database);
      const created=await repository.createAccessory({...f.context,projectId:f.projectId,category:'parking',code:'LEGAL-TECH',amount:500000});
      const id=created.id,details={legalForm:'garage_coownership' as const,shareNumerator:1,shareDenominator:25};
      const update={...f.context,accessoryId:id,code:'LEGAL-TECH',amount:500000,legalDetails:details};
      const read=async()=>(await f.db.query<{legal_form:string|null;coownership_numerator:number|null;coownership_denominator:number|null}>('SELECT legal_form,coownership_numerator,coownership_denominator FROM accessories WHERE id=$1',[id])).rows[0];
      assert.equal((await read()).legal_form,null);
      await repository.updateAccessory(update);await repository.updateAccessory(update);
      assert.deepEqual(await read(),{legal_form:'garage_coownership',coownership_numerator:1,coownership_denominator:25});
      const count=async(table:string,key:string)=>(await f.db.query<{count:number}>(`SELECT count(*)::int count FROM ${table} WHERE ${key}=$1 AND ${table==='audit_log'?"action='accessory.legal_details_updated'":"event_type='accessory.legal_details_updated.v1'"}`,[id])).rows[0].count;
      assert.equal(await count('audit_log','entity_id'),1);assert.equal(await count('outbox_events','aggregate_id'),1);
      await repository.updateAccessory({...update,legalDetails:undefined});assert.equal((await read()).coownership_denominator,25);
      const snapshot=await repository.getCatalog(f.context);assert.deepEqual(snapshot.accessories.find(item=>item.id===id)?.legalDetails,details);
      await assert.rejects(repository.updateAccessory({...update,legalDetails:{legalForm:'cellar_unit',shareNumerator:null,shareDenominator:null}}),/CATEGORY_MISMATCH/);
      await assert.rejects(repository.updateAccessory({...update,tenantId:randomUUID()}),/tenant context/);
      await assert.rejects(repository.updateAccessory({...update,membershipId:randomUUID()}),/permission/);
      await assert.rejects(repository.updateAccessory({...update,accessoryId:randomUUID()}),/permission/);
      const restrictedUser=randomUUID(),restrictedMember=randomUUID();
      await f.db.query("INSERT INTO users(id,entra_issuer,entra_subject,email,display_name) VALUES($1,'technical-issuer',$2,'legal-scope@example.test','Technical scope')",[restrictedUser,randomUUID()]);
      await f.db.query("INSERT INTO tenant_memberships(id,tenant_id,user_id,status,accepted_at) VALUES($1,$2,$3,'active',now())",[restrictedMember,f.context.tenantId,restrictedUser]);
      const otherProject=await repository.createProject({...f.context,name:'Technical legal scope',code:'LEGAL-SCOPE',slug:'legal-scope',constructionStatus:'preparation',defaultCurrency:'CZK'});
      await f.db.query("INSERT INTO project_custom_access(tenant_id,project_id,membership_id,area,access_level,assigned_by_user_id) VALUES($1,$2,$3,'units','edit',$4)",[f.context.tenantId,otherProject.id,restrictedMember,f.context.userId]);
      await assert.rejects(f.database.withContext(f.context,async client=>{await client.query("SELECT set_config('app.user_id',$1,true)",[restrictedUser]);return client.query('SELECT app.set_accessory_legal_details($1,$2,$3::jsonb,$4)',[f.context.tenantId,id,JSON.stringify({...details,shareDenominator:26}),restrictedMember]);}),/permission/);
      await assert.rejects(repository.updateAccessory({...update,legalDetails:{...details,shareNumerator:2,shareDenominator:1},amount:700000}),/smluvní vymezení/);
      const other=await repository.createAccessory({...f.context,projectId:f.projectId,category:'parking',code:'LEGAL-OTHER',amount:1});assert.ok(other.id);
      await assert.rejects(repository.updateAccessory({...update,code:'LEGAL-OTHER',legalDetails:{...details,shareDenominator:26},amount:700000}),/duplicate key/);
      assert.equal((await read()).coownership_denominator,25);assert.equal(await count('audit_log','entity_id'),1);
      assert.equal((await f.db.query<{count:number}>('SELECT count(*)::int count FROM accessory_price_history WHERE accessory_id=$1',[id])).rows[0].count,1);
      await assert.rejects(f.database.withContext(f.context,client=>client.query("UPDATE accessories SET coownership_denominator=24 WHERE id=$1",[id])),/COMMAND_REQUIRED/);
      await assert.rejects(f.database.withContext(f.context,client=>client.query('SELECT app.set_accessory_legal_details($1,$2,$3::jsonb,$4)',[f.context.tenantId,id,JSON.stringify({...details,shareDenominator:9999999999}),f.context.membershipId])),/ACCESSORY_LEGAL_INVALID/);
    });
    await t.test('accessory location uses canonical inventory, preserves omitted values and rolls back invalid edits',async()=>{
      const repository=new InventoryRepository(f.database);
      const created=await repository.createAccessory({...f.context,projectId:f.projectId,category:'cellar',code:'LOCATION-TECH',areaM2:5,amount:1000});
      const input={...f.context,accessoryId:created.id,code:'LOCATION-TECH',areaM2:5,amount:1000,floorLabel:'  1. PP  '};
      const read=async()=>(await f.db.query<{floor_label:string|null}>('SELECT floor_label FROM accessories WHERE id=$1',[created.id])).rows[0].floor_label;
      const count=async()=>(await f.db.query<{audit:number;outbox:number;prices:number}>("SELECT (SELECT count(*)::int FROM audit_log WHERE entity_id=$1 AND action='accessory.location_updated') audit,(SELECT count(*)::int FROM outbox_events WHERE aggregate_id=$1 AND event_type='accessory.location_updated.v1') outbox,(SELECT count(*)::int FROM accessory_price_history WHERE accessory_id=$1) prices",[created.id])).rows[0];
      await repository.updateAccessory(input);await repository.updateAccessory(input);
      assert.equal(await read(),'1. PP');assert.deepEqual(await count(),{audit:1,outbox:1,prices:1});
      assert.equal((await repository.getCatalog(f.context)).accessories.find(a=>a.id===created.id)?.location,'1. PP');
      await repository.updateAccessory({...input,floorLabel:undefined});assert.equal(await read(),'1. PP');
      await assert.rejects(repository.updateAccessory({...input,tenantId:randomUUID()}),/tenant context/);
      await assert.rejects(repository.updateAccessory({...input,membershipId:randomUUID()}),/permission/);
      await assert.rejects(repository.updateAccessory({...input,accessoryId:randomUUID()}),/permission/);
      await assert.rejects(repository.updateAccessory({...input,floorLabel:'x'.repeat(121)}),/Umístění/);
      await assert.rejects(repository.updateAccessory({...input,floorLabel:'2. PP',amount:-1,legalDetails:{legalForm:'cellar_unit',shareNumerator:null,shareDenominator:null}}),/invalid accessory data/);
      assert.equal(await read(),'1. PP');assert.deepEqual(await count(),{audit:1,outbox:1,prices:1});
      assert.equal((await f.db.query<{legal_form:string|null}>('SELECT legal_form FROM accessories WHERE id=$1',[created.id])).rows[0].legal_form,null,'earlier legal change rolled back too');
      const sql='SELECT app.update_project_accessory($1,$2,$3,5,1000,NULL,$4,$5,$6::text)';
      for(const invalid of ['x'.repeat(121),'1. PP\n2. PP'])await assert.rejects(f.database.withContext(f.context,c=>c.query(sql,[f.context.tenantId,created.id,input.code,'Technical',f.context.membershipId,invalid])),/ACCESSORY_LOCATION_INVALID/);
      const restrictedUser=randomUUID(),restrictedMember=randomUUID();
      await f.db.query("INSERT INTO users(id,entra_issuer,entra_subject,email,display_name) VALUES($1,'technical-issuer',$2,'location@example.test','Location scope')",[restrictedUser,randomUUID()]);
      await f.db.query("INSERT INTO tenant_memberships(id,tenant_id,user_id,status,accepted_at) VALUES($1,$2,$3,'active',now())",[restrictedMember,f.context.tenantId,restrictedUser]);
      const other=await repository.createProject({...f.context,name:'Location scope',code:'LOC-SCOPE',slug:'loc-scope',constructionStatus:'preparation',defaultCurrency:'CZK'});
      await f.db.query("INSERT INTO project_custom_access(tenant_id,project_id,membership_id,area,access_level,assigned_by_user_id) VALUES($1,$2,$3,'units','edit',$4)",[f.context.tenantId,other.id,restrictedMember,f.context.userId]);
      for(const actor of [restrictedMember,f.context.membershipId])await assert.rejects(f.database.withContext(f.context,async c=>{
        await c.query("SELECT set_config('app.user_id',$1,true)",[restrictedUser]);await c.query('SET LOCAL ROLE develocrm_app');
        return c.query(sql,[f.context.tenantId,created.id,input.code,'Technical',actor,'2. PP']);
      }),/permission/,'project scope and actor identity are both enforced');
      await repository.updateAccessory({...input,floorLabel:null});assert.equal(await read(),null);
      assert.deepEqual(await count(),{audit:2,outbox:2,prices:1});
    });
    if(f.connectionUrl)await t.test('parallel PostgreSQL location edits serialize without duplicate location events or price rows',async()=>{
      if(!f.connectionUrl)throw new Error('PostgreSQL concurrency fixture missing');
      const runtime=new Database(f.connectionUrl);
      try{
        const repository=new InventoryRepository(runtime);
        const created=await repository.createAccessory({...f.context,projectId:f.projectId,category:'parking',code:'LOCATION-CONCURRENT',amount:1000});
        await Promise.all(Array.from({length:8},()=>repository.updateAccessory({...f.context,accessoryId:created.id,code:'LOCATION-CONCURRENT',amount:1000,floorLabel:'1. PP'})));
        const result=(await f.db.query<{floor_label:string;audit:number;outbox:number;prices:number}>("SELECT floor_label,(SELECT count(*)::int FROM audit_log WHERE entity_id=a.id AND action='accessory.location_updated') audit,(SELECT count(*)::int FROM outbox_events WHERE aggregate_id=a.id AND event_type='accessory.location_updated.v1') outbox,(SELECT count(*)::int FROM accessory_price_history WHERE accessory_id=a.id) prices FROM accessories a WHERE id=$1",[created.id])).rows[0];
        assert.deepEqual(result,{floor_label:'1. PP',audit:1,outbox:1,prices:1});
      }finally{await runtime.close();}
    });
    if(f.connectionUrl)await t.test('parallel PostgreSQL updates serialize on the same accessory without duplicate legal events',async()=>{
      if(!f.connectionUrl)throw new Error('PostgreSQL concurrency fixture missing');
      const runtime=new Database(f.connectionUrl);
      try{
        const repository=new InventoryRepository(runtime);
        const created=await repository.createAccessory({...f.context,projectId:f.projectId,category:'parking',code:'LEGAL-CONCURRENT',amount:500000});
        const input={...f.context,accessoryId:created.id,code:'LEGAL-CONCURRENT',amount:500000,legalDetails:{legalForm:'garage_coownership' as const,shareNumerator:1,shareDenominator:25}};
        await Promise.all(Array.from({length:8},()=>repository.updateAccessory(input)));
        const result=(await f.db.query<{audit:number;outbox:number;denominator:number}>("SELECT (SELECT count(*)::int FROM audit_log WHERE entity_id=a.id AND action='accessory.legal_details_updated') audit,(SELECT count(*)::int FROM outbox_events WHERE aggregate_id=a.id AND event_type='accessory.legal_details_updated.v1') outbox,a.coownership_denominator denominator FROM accessories a WHERE id=$1",[created.id])).rows[0];
        assert.deepEqual(result,{audit:1,outbox:1,denominator:25});
      }finally{await runtime.close();}
    });
    await t.test('initial zero and nonzero prices, retry, and price changes',async()=>{
      for(const price of [0,1234567]){const code=`PRICE-${price}`;const key=randomUUID();const input={...f.context,projectId:f.projectId,row:{rowNumber:1,code,areaM2:30,price},idempotencyKey:key};
        await f.inventory.createUnit(input);await f.inventory.createUnit(input);
        const p=(await f.db.query<{count:number;amount:string}>("SELECT count(*)::int count,max(amount)::text amount FROM unit_price_history p JOIN units u ON u.id=p.unit_id WHERE u.code=$1",[code])).rows[0];assert.equal(p.count,1);assert.equal(Number(p.amount),price);
        await assert.rejects(f.inventory.createUnit({...input,row:{...input.row,price:price+1}}),/jiné údaje/);
        await f.inventory.confirm({...f.context,projectId:f.projectId,entityType:'unit',rows:[{...input.row,price:price+500}],strategy:'update',idempotencyKey:randomUUID()});
        const current=(await f.db.query<{amount:string;count:number}>("SELECT app.current_unit_price(u.tenant_id,u.id,clock_timestamp())::text amount,(SELECT count(*)::int FROM unit_price_history WHERE unit_id=u.id) count FROM units u WHERE code=$1",[code])).rows[0];assert.equal(Number(current.amount),price+500);assert.equal(current.count,2);
      }
    });
    await t.test('signature without document rejected by DB',async()=>{const c=await f.start();await f.approve(c);await assert.rejects(f.sign(c),/SIGNED_DOCUMENT_REQUIRED/);});
    await t.test('equal unit codes in different projects never share price projections',async()=>{
      const project=await new InventoryRepository(f.database).createProject({...f.context,name:'Technical price isolation',code:'PRICE57',slug:'price-isolation-57',constructionStatus:'preparation',defaultCurrency:'CZK'});
      for(const [projectId,price] of [[f.projectId,100000],[project.id,200000]] as const)await f.inventory.createUnit({...f.context,projectId,row:{rowNumber:1,code:'SAME57',areaM2:30,price},idempotencyKey:randomUUID()});
      const units=(await f.db.query<{id:string;project_id:string}>("SELECT id,project_id FROM units WHERE tenant_id=$1 AND code='SAME57'",[f.context.tenantId])).rows;
      const snapshot=await new CommercialRepository(f.database).getSnapshot(f.context);
      assert.equal(snapshot.currentPrices.SAME57,undefined);assert.equal(snapshot.priceHistories.SAME57,undefined);
      for(const unit of units){const expected=unit.project_id===f.projectId?100000:200000;assert.equal(snapshot.currentPrices[unit.id],expected);assert.equal(snapshot.priceHistories[unit.id][0].amount,expected);}
    });
    await t.test('generated RS, first generation retry, regeneration, and exact signed version',async()=>{
      await f.db.query("UPDATE projects SET planned_handover_from='2027-12-01',planned_handover_to='2027-12-01' WHERE tenant_id=$1 AND id=$2",[f.context.tenantId,f.projectId]);
      await f.inventory.createUnit({...f.context,projectId:f.projectId,row:{rowNumber:1,code:'GENERATED57',areaM2:30,layout:'1+kk',floorLabel:'1. NP',price:5000000},idempotencyKey:randomUUID()});
      const unit=(await f.db.query<{id:string}>("SELECT id FROM units WHERE tenant_id=$1 AND code='GENERATED57'",[f.context.tenantId])).rows[0].id;const c=await f.start(unit);
      await f.db.query("UPDATE party_individual_details SET salutation='pan',date_of_birth='2000-01-01' WHERE tenant_id=$1 AND party_id=$2",[f.context.tenantId,c.partyId]);
      await f.db.query("INSERT INTO party_addresses(tenant_id,party_id,address_type,line1,city,postal_code,is_primary) VALUES($1,$2,'residence','Technická 1','Test','00000',true)",[f.context.tenantId,c.partyId]);
      await f.db.query("INSERT INTO party_contacts(tenant_id,party_id,contact_type,value,normalized_value,is_primary) VALUES($1,$2,'phone','+420000000157','+420000000157',true)",[f.context.tenantId,c.partyId]);
      await f.db.query("INSERT INTO project_contract_settings(tenant_id,project_id,seller_name,seller_registration_number,seller_address,seller_registry_entry,seller_representative,seller_email,seller_data_box,seller_bank_account,seller_bank_name,created_by_membership_id) VALUES($1,$2,'TECH SELLER','00000000','TECH ADDRESS','TECH REGISTRY','TECH REPRESENTATIVE','technical@example.test','TECH BOX','000 / 0000','TECH BANK',$3)",[f.context.tenantId,f.projectId,f.context.membershipId]);
      const bytes=await readFile(new URL('../templates/rs/rezidence-dejvice-rs-v1.docx',import.meta.url));
      const template=await f.management.upload({...f.context,projectId:f.projectId,code:'rs-integrity',name:'Technical RS',outputTypeCode:'reservation_contract',versionLabel:'v1',fileName:'template.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',bytes,effectiveFrom:'2026-01-01'});
      const templateContext={...f.context,templateId:template.templateId,versionId:template.templateVersionId};await f.management.validate(templateContext);await f.management.approve(templateContext);
      const readiness=await f.rs.readiness({...f.context,contractId:c.contract_id});assert.equal(readiness.ready,true,JSON.stringify(readiness.issues));
      const repository=new RsGenerationRepository(f.database);
      await repository.setSigningPlan({...f.context,contractId:c.contract_id,versionId:c.version_id,sellerPlannedOn:'2026-10-20',buyerPlannedOn:'2026-10-21'});
      const key=randomUUID();const first=await f.rs.generate({...f.context,contractId:c.contract_id,idempotencyKey:key});const retry=await f.rs.generate({...f.context,contractId:c.contract_id,idempotencyKey:key});assert.equal(first.documentVersionId,retry.documentVersionId);assert.equal(retry.replayed,true);
      const completed=await repository.completedGeneration({...f.context,contractId:c.contract_id,idempotencyKey:key});assert(completed);
      await assert.rejects(repository.bind({...f.context,contractId:c.contract_id,...completed,snapshot:{...completed.snapshot,'buyer.name':'Tampered'}}),/CONTRACT_GENERATION_BINDING_MISMATCH/);
      const firstSnapshot=(await f.db.query<{generation_payload:Record<string,string>}>("SELECT generation_payload FROM contract_versions WHERE id=$1",[first.contractVersionId])).rows[0].generation_payload;
      await f.db.query("UPDATE party_individual_details SET first_name='Corrected' WHERE tenant_id=$1 AND party_id=$2",[f.context.tenantId,c.partyId]);
      const second=await f.rs.generate({...f.context,contractId:c.contract_id,idempotencyKey:randomUUID()});assert.notEqual(second.documentVersionId,first.documentVersionId);assert.equal(second.contractVersion,2);
      const plans=(await f.db.query<{seller:string;buyer:string;generation_payload:Record<string,string>}>("SELECT seller_planned_signing_on::text seller,buyer_planned_signing_on::text buyer,generation_payload FROM contract_versions WHERE contract_id=$1 ORDER BY version_number",[c.contract_id])).rows;
      assert.equal(plans.length,2);for(const plan of plans){assert.equal(plan.seller,'2026-10-20');assert.equal(plan.buyer,'2026-10-21');}assert.deepEqual(plans[0].generation_payload,firstSnapshot);
      assert.equal((await f.db.query<{count:number}>("SELECT count(*)::int count FROM document_generation_operations WHERE contract_id=$1 AND state='completed'",[c.contract_id])).rows[0].count,2);
      c.version_id=second.contractVersionId;await f.approve(c);await f.evidence.exactFile({...f.context,contractId:c.contract_id,versionId:c.version_id});await f.sign(c);
      await assert.rejects(f.db.query("UPDATE document_generation_operations SET generation_snapshot='{}' WHERE output_document_version_id=$1",[second.documentVersionId]),/immutable/);
      assert.equal((await f.db.query<{count:number}>("SELECT count(*)::int count FROM document_versions WHERE document_id=$1",[first.documentId])).rows[0].count,2);
    });
    await t.test('SBK completed-generation binding: type, snapshot, exact document, plan race and retry',async()=>{
      const base=await f.start();const contractId=(await f.db.query<{id:string}>("SELECT app.create_contract($1,$2,'sbk',$3,'Technical binding fixture',$4) id",[f.context.tenantId,base.salesCaseId,`SBK-BIND-${randomUUID()}`,f.context.membershipId])).rows[0].id;
      const versionId=(await f.db.query<{id:string}>("SELECT id FROM contract_versions WHERE contract_id=$1 ORDER BY version_number DESC LIMIT 1",[contractId])).rows[0].id;
      const repository=new RsGenerationRepository(f.database);
      const plan={...f.context,contractId,versionId,sellerPlannedOn:'2026-10-17',buyerPlannedOn:'2026-10-17'};
      await repository.setSigningPlan(plan);
      const bytes=await readFile(new URL('../templates/review/sbk-dejvice-original-review.docx',import.meta.url));
      const template=await f.management.upload({...f.context,projectId:f.projectId,code:'sbk-binding-fixture',name:'Technical SBK binding fixture',outputTypeCode:'future_purchase_contract',variantKey:ORIGINAL_DOB_FULL_VARIANT,versionLabel:'v1',fileName:'template.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',bytes,effectiveFrom:'2026-01-01'});
      const templateContext={...f.context,templateId:template.templateId,versionId:template.templateVersionId};await f.management.validate(templateContext);
      // Isolated DB fixture models a completed approved generation. The actual
      // public service MUST still reject approval/generation of review profiles.
      await assert.rejects(f.management.approve(templateContext),e=>(e as {code:string}).code==='template_generation_not_ready');
      await f.database.withContext(f.context,client=>client.query('SELECT app.approve_document_template_version($1,$2,$3,$4)',[f.context.tenantId,f.context.membershipId,template.templateId,template.templateVersionId]));
      const generations=new DocumentTemplateGenerationRepository(f.database);
      const source=await generations.getTemplate({...f.context,projectId:f.projectId,templateVersionId:template.templateVersionId});assert(source);
      const catalog=templateCatalog('future_purchase_contract',ORIGINAL_DOB_FULL_VARIANT)!;
      const snapshot=Object.fromEntries(Object.entries(catalog.fields).map(([key,value])=>[key,value.sample]));
      await assert.rejects(f.templates.generate({...f.context,projectId:f.projectId,templateVersionId:template.templateVersionId,idempotencyKey:randomUUID(),contractId,snapshot}),e=>(e as {code:string}).code==='template_generation_not_ready');
      const rendered=await f.management.preview(templateContext);
      const appendixItems:Array<{number:number;documentId:string;documentVersionId:string}>=[];
      assert.equal(source.schema.appendices?.length,5);
      for(const required of source.schema.appendices!){
        const appendix=await f.uploads.upload({...f.context,projectId:f.projectId,typeCode:'other',idempotencyKey:randomUUID(),
          documentName:`Technical SBK appendix ${required.number}`,fileName:`technical-appendix-${required.number}.pdf`,mimeType:'application/pdf',
          bytes:f.fileBytes,versionLabel:'technical-v1',status:'ready'});
        await repository.setAppendix({...f.context,contractId,versionId,number:required.number,documentId:appendix.documentId,
          documentVersionId:appendix.documentVersionId,expectedDocumentVersionId:null});
        appendixItems.push({number:required.number,documentId:appendix.documentId,documentVersionId:appendix.documentVersionId});
      }
      const key=randomUUID();const operation=await generations.reserve({...f.context,projectId:f.projectId,template:source,idempotencyKey:key,requestHash:'a'.repeat(64),unitId:base.unitId,partyId:base.partyId,salesCaseId:base.salesCaseId,contractId,snapshot,
        contractAppendices:{versionId,items:appendixItems}});
      const upload=()=>f.uploads.upload({...f.context,projectId:f.projectId,unitId:base.unitId,partyId:base.partyId,salesCaseId:base.salesCaseId,contractId,typeCode:'future_purchase_contract',idempotencyKey:`generation:${operation.id}`,documentName:'Technical SBK binding fixture',fileName:'fixture.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',bytes:rendered,versionLabel:'v1',status:'ready'});
      const originalUpload=f.graph.uploadFile;f.graph.uploadFile=async()=>{throw new Error('Technical Graph timeout');};
      try{await assert.rejects(upload(),e=>e instanceof SharePointUploadError&&e.code==='graph_unavailable');}finally{f.graph.uploadFile=originalUpload;}
      const reserved=(await f.db.query<{state:string;appendix_snapshot:unknown}>('SELECT state,appendix_snapshot FROM document_generation_operations WHERE id=$1',[operation.id])).rows[0];
      assert.equal(reserved.state,'reserved');
      const retried=await generations.reserve({...f.context,projectId:f.projectId,template:source,idempotencyKey:key,requestHash:'a'.repeat(64),unitId:base.unitId,partyId:base.partyId,salesCaseId:base.salesCaseId,contractId,snapshot,
        contractAppendices:{versionId,items:appendixItems}});assert.equal(retried.id,operation.id);
      const output=await upload();
      await generations.complete({...f.context,operationId:operation.id,documentId:output.documentId,documentVersionId:output.documentVersionId,renderedContentHash:`sha256:${createHash('sha256').update(rendered).digest('hex')}`});
      const input={...f.context,contractId,operationId:operation.id,documentId:output.documentId,documentVersionId:output.documentVersionId,templateVersionId:template.templateVersionId,snapshot};
      await assert.rejects(repository.bind({...input,contractId:base.contract_id}),/CONTRACT_GENERATION_BINDING_MISMATCH/);
      await assert.rejects(repository.bind({...input,tenantId:randomUUID()}));
      await assert.rejects(repository.bind({...input,snapshot:{...snapshot,'buyer.name':'Wrong'}}),/CONTRACT_GENERATION_BINDING_MISMATCH/);
      await repository.setSigningPlan({...plan,buyerPlannedOn:'2026-10-18'});
      await assert.rejects(repository.bind(input),/CONTRACT_SIGNING_PLAN_CHANGED/);
      assert.equal((await f.db.query<{source_type:string}>('SELECT source_type FROM contract_versions WHERE id=$1',[versionId])).rows[0].source_type,'manual');
      await repository.setSigningPlan(plan);
      await assert.rejects(f.db.query("UPDATE document_versions SET status_code='draft' WHERE id=$1",[output.documentVersionId]),/append-only/);
      const bound=await repository.bind(input);const retry=await repository.bind(input);assert.deepEqual(retry,bound);assert.equal(bound.versionId,versionId);
      const signable=await f.evidence.signableFile({...f.context,contractId,versionId});assert.equal(signable.evidence.documentVersionId,output.documentVersionId);
      const item=(await f.db.query<{external_item_id:string}>('SELECT external_item_id FROM documents WHERE id=$1',[appendixItems[0].documentId])).rows[0];
      const appendixFile=f.files.get(item.external_item_id);assert(appendixFile);const originalBytes=appendixFile.bytes;
      appendixFile.bytes=new TextEncoder().encode('%PDF-tampered technical fixture');
      try{await assert.rejects(f.evidence.signableFile({...f.context,contractId,versionId}),e=>e instanceof ContractDocumentError&&e.code==='DOCUMENT_HASH_MISMATCH');}
      finally{appendixFile.bytes=originalBytes;}
      assert.deepEqual((await f.db.query<{appendix_snapshot:unknown}>('SELECT appendix_snapshot FROM document_generation_operations WHERE id=$1',[operation.id])).rows[0].appendix_snapshot,reserved.appendix_snapshot);
      await assert.rejects(repository.bind({...input,membershipId:randomUUID()}),/contract.manage permission required/);
      const events=(await f.db.query<{audits:number;outbox:number}>("SELECT (SELECT count(*)::int FROM audit_log WHERE entity_id=$1 AND action='contract.sbk_generated') audits,(SELECT count(*)::int FROM outbox_events WHERE aggregate_id=$2 AND event_type='contract.sbk_generated.v1') outbox",[bound.versionId,contractId])).rows[0];assert.deepEqual(events,{audits:1,outbox:1});
      assert.deepEqual((await f.db.query<{generation_payload:Record<string,string>}>('SELECT generation_payload FROM contract_versions WHERE id=$1',[bound.versionId])).rows[0].generation_payload,snapshot);
    });
    await t.test('commercial creation derives SBK timing from the same project-template selection and retries safely',async()=>{
      const rs=await f.start();const document=await f.external(rs);rs.version_id=document.versionId;await f.approve(rs);await f.sign(rs);
      const obligation=(await f.db.query<{id:string}>('SELECT id FROM payment_obligations WHERE contract_id=$1',[rs.contract_id])).rows[0].id;
      await f.database.withContext(f.context,client=>client.query("SELECT app.record_payment($1,$2,250000,now(),NULL,NULL,NULL,NULL,$3,$4)",[f.context.tenantId,obligation,randomUUID(),f.context.membershipId]));
      const commercial=new CommercialService(f.database);const action=await commercial.nextContractAction({...f.context,unitId:rs.unitId});
      assert.equal(action.kind,'create_contract');assert.equal(action.paymentTimings?.rs,'fixed_date');assert.equal(action.paymentTimings?.sbk,'signature');
      const input={...f.context,unitId:rs.unitId,type:'sbk' as const,idempotencyKey:randomUUID(),paymentTiming:'signature' as const};
      await assert.rejects(commercial.createNextContract({...input,paymentTiming:'fixed_date',paymentCalculationType:'fixed',paymentInputValue:100000,paymentDueAt:'2027-01-01T12:00:00Z'}),/TEMPLATE_CHANGED/);
      let created:Awaited<ReturnType<CommercialService['createNextContract']>>;
      if(f.connectionUrl){const parallel=new Database(f.connectionUrl);
        try{const service=new CommercialService(parallel);const results=await Promise.all([service.createNextContract(input),service.createNextContract(input)]);assert.deepEqual(results[0],results[1]);created=results[0];}
        finally{await parallel.close();}
      }else created=await commercial.createNextContract(input);
      assert.equal(created.paymentObligationId,null);
      assert.deepEqual(await commercial.createNextContract(input),created);
      const source=await new RsGenerationRepository(f.database).load({...f.context,contractId:created.id,permission:'contract.read'});
      assert.equal(source?.templateVariant,ORIGINAL_DOB_FULL_VARIANT);assert.equal(source?.hasPaymentObligations,false);assert.ok(source?.paymentTerms);
      assert.equal((await f.rs.readiness({...f.context,contractId:created.id})).ready,false,'draft legal template remains unavailable for generation');
    });
    await t.test('external upload, exact hash, signature retry, and immutable document',async()=>{
      const c=await f.start();const uploaded=await f.external(c);const exact=await f.evidence.signableFile({...f.context,contractId:c.contract_id,versionId:uploaded.versionId});assert.deepEqual(exact.bytes,f.fileBytes);assert.equal(exact.evidence.mimeType,'application/pdf');
      c.version_id=uploaded.versionId;await f.approve(c);await f.sign(c);await f.sign(c);
      assert.equal((await f.db.query<{count:number}>("SELECT count(*)::int count FROM audit_log WHERE entity_id=$1 AND action='contract.signed'",[c.contract_id])).rows[0].count,1);
      await assert.rejects(f.db.query("UPDATE contract_versions SET document_version_id=gen_random_uuid() WHERE id=$1",[c.version_id]),/immutable/);
      await assert.rejects(f.uploads.upload({...f.context,projectId:f.projectId,idempotencyKey:randomUUID(),documentId:uploaded.documentId,documentName:'replacement',fileName:'replacement.pdf',mimeType:'application/pdf',bytes:f.fileBytes,versionLabel:'v3',status:'ready'}),/SIGNED_DOCUMENT_IMMUTABLE/);
      assert.equal((await f.db.query<{commercial_status:string}>("SELECT commercial_status FROM units WHERE id=$1",[c.unitId])).rows[0].commercial_status,'reserved');
      const stored=f.files.get(uploaded.itemId)!;stored.bytes=new TextEncoder().encode('tampered');await assert.rejects(f.evidence.exactFile({...f.context,contractId:c.contract_id,versionId:c.version_id}),e=>(e as {code:string}).code==='DOCUMENT_HASH_MISMATCH');
    });
    await t.test('different contract and tenant documents rejected',async()=>{const a=await f.start();const b=await f.start();const uploaded=await f.external(a);
      await assert.rejects(f.database.withContext(f.context,client=>client.query("SELECT app.bind_external_contract_document($1,$2,$3,$4,$5)",[f.context.tenantId,b.contract_id,uploaded.documentId,uploaded.documentVersionId,f.context.membershipId])),/SIGNED_DOCUMENT_REQUIRED/);
      await assert.rejects(f.evidence.evidence({...f.context,tenantId:randomUUID(),contractId:a.contract_id,versionId:uploaded.versionId}));
      const otherUnit=(await f.db.query<{id:string}>("SELECT id FROM units WHERE tenant_id=$1 AND code='SAME57' AND project_id<>$2",[f.context.tenantId,f.projectId])).rows[0].id;
      const other=await f.start(otherUnit);
      await assert.rejects(f.database.withContext(f.context,client=>client.query("SELECT app.bind_external_contract_document($1,$2,$3,$4,$5)",[f.context.tenantId,other.contract_id,uploaded.documentId,uploaded.documentVersionId,f.context.membershipId])),/SIGNED_DOCUMENT_REQUIRED/);
    });
    await t.test('draft and failed documents cannot become signature evidence',async()=>{
      for(const status of ['draft'] as const){const c=await f.start();
        const uploaded=await f.uploads.upload({...f.context,projectId:f.projectId,unitId:c.unitId,salesCaseId:c.salesCaseId,contractId:c.contract_id,typeCode:'reservation_contract',idempotencyKey:randomUUID(),documentName:'Technical unready',fileName:'unready.pdf',mimeType:'application/pdf',bytes:f.fileBytes,versionLabel:'v1',status});
        await assert.rejects(f.database.withContext(f.context,client=>client.query("SELECT app.bind_external_contract_document($1,$2,$3,$4,$5)",[f.context.tenantId,c.contract_id,uploaded.documentId,uploaded.documentVersionId,f.context.membershipId])),/SIGNED_DOCUMENT_REQUIRED/);
      }
      const c=await f.start();
      // @ts-expect-error Intentional invalid status: verify the database rejects untrusted input.
      await assert.rejects(f.uploads.upload({...f.context,projectId:f.projectId,unitId:c.unitId,salesCaseId:c.salesCaseId,contractId:c.contract_id,typeCode:'reservation_contract',idempotencyKey:randomUUID(),documentName:'Technical failed',fileName:'failed.pdf',mimeType:'application/pdf',bytes:f.fileBytes,versionLabel:'v1',status:'failed'}),/document_status_check/);
    });
    await t.test('real SQL checker after RS generation, signature, and reservation remains read-only',async()=>{
      const counts=async()=>(await f.db.query("SELECT (SELECT count(*) FROM audit_log)::int audits,(SELECT count(*) FROM outbox_events)::int outbox,(SELECT count(*) FROM document_versions)::int versions")).rows;
      const before=await counts();
      const report=await new ConsistencyChecker(f.database).run(f.context);
      assert(report.complete);assert(report.projectsChecked>0);
      const generated=(await f.db.query<{id:string;version_id:string}>("SELECT c.id,cv.id version_id FROM contracts c JOIN contract_versions cv ON cv.contract_id=c.id JOIN units u ON u.id=c.unit_id WHERE u.code='GENERATED57' AND cv.version_status='signed'")).rows[0];
      assert(generated);assert(!report.findings.some(v=>v.entityId===generated.id||v.entityId===generated.version_id));
      assert(report.findings.some(v=>v.code==='SIGNED_EVIDENCE_MISSING'&&v.severity==='critical')); // different tenant seed cannot inherit pilot exceptions
      assert.deepEqual(await counts(),before);
    });
    await t.test('template diagnostics pin exact native source, not the earlier Office upload hash',async()=>{
      const download=f.graph.downloadFile;let sourceReads=0;
      f.graph.downloadFile=async(connection,item,version)=>{
        const stored=f.files.get(item);
        if(stored?.meta.name.startsWith('normalized-template')&&++sourceReads===2){
          const parts=unzipSync(stored.bytes);
          parts['docProps/core.xml']=strToU8(strFromU8(parts['docProps/core.xml'])+'<!--Office normalization fixture-->');
          stored.bytes=zipSync(parts);
        }
        return download(connection,item,version);
      };
      try{
        const bytes=await readFile(new URL('../templates/rs/rezidence-dejvice-rs-v1.docx',import.meta.url));
        const uploaded=await f.management.upload({...f.context,projectId:f.projectId,code:'rs-integrity',name:'Technical normalization proof',
          outputTypeCode:'reservation_contract',versionLabel:'normalization-v2',fileName:'normalized-template.docx',
          mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',bytes,effectiveFrom:'2026-01-01'});
        const target={...f.context,templateId:uploaded.templateId,versionId:uploaded.templateVersionId};
        await f.management.validate(target);await f.management.approve(target);
        const source=(await f.db.query<{content_hash:string;document_hash:string;external_item_id:string}>(`SELECT tv.content_hash,v.content_hash document_hash,d.external_item_id
          FROM document_template_versions tv JOIN document_versions v ON v.id=tv.source_document_version_id
          JOIN documents d ON d.id=v.document_id WHERE tv.id=$1`,[uploaded.templateVersionId])).rows[0];
        assert.notEqual(source.content_hash,source.document_hash,'reproduces delayed Office normalization after upload finalization');
        const checker=new ConsistencyChecker(f.database,f.graph);
        const metadata=await checker.run(f.context);
        assert(metadata.findings.some(item=>item.entityId===uploaded.templateVersionId&&item.code==='TEMPLATE_UPLOAD_HASH_DIFFERENT'&&item.severity==='warning'),'metadata discrepancy remains visible without claiming corruption');
        assert(!metadata.findings.some(item=>item.entityId===uploaded.templateVersionId&&item.severity==='critical'));
        assert.equal(metadata.physicalEvidence,'not_checked','metadata alone must not claim physical verification');
        const identity=(await f.db.query<{credential_reference:string}>('SELECT credential_reference FROM sharepoint_connections WHERE tenant_id=$1',[f.context.tenantId])).rows[0].credential_reference.replace('managed-identity://','');
        const physical=await new ConsistencyChecker(f.database,f.graph,identity).run({...f.context,physical:true});
        assert(!physical.findings.some(item=>item.entityId===uploaded.templateVersionId&&item.severity==='critical'),'exact approved native source is verified');
        f.files.get(source.external_item_id)!.bytes=Buffer.from('tampered exact native template');
        const tampered=await new ConsistencyChecker(f.database,f.graph,identity).run({...f.context,physical:true});
        assert(tampered.findings.some(item=>item.entityId===uploaded.templateVersionId&&item.code==='PHYSICAL_DOCUMENT_HASH_MISMATCH'&&item.severity==='critical'));
      }finally{f.graph.downloadFile=download;}
    });
  }finally{await f.db.close();}
});

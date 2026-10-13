import assert from "node:assert/strict";
import test from "node:test";
import {readFile,readdir} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {PGlite} from "@electric-sql/pglite";
import {bootstrapIds,bootstrapPilotWorkspace,normalizeBootstrapInput} from "../src/iam/pilot-bootstrap.js";
import {importDejvice} from "../src/imports/dejvice.js";
import {InventoryImportService} from "../src/inventory/import-service.js";
import type {Database,SqlClient} from "../src/database.js";
import {DocumentRepository} from "../src/documents/repository.js";
import {SharePointDocumentUploadService} from "../src/documents/upload-service.js";
import {ContractDocumentEvidenceService} from "../src/contracts/document-evidence-service.js";
import type {MicrosoftGraphAdapter,GraphFileMetadata} from "../src/documents/graph-adapter.js";
import {DocumentTemplateGenerationRepository} from "../src/documents/template-generation-repository.js";
import {DocumentTemplateGenerationService} from "../src/documents/template-generation-service.js";
import {DocumentTemplateManagementService} from "../src/documents/template-management-service.js";
import {DocumentTemplateManagementRepository} from "../src/documents/template-management-repository.js";
import {RsGenerationRepository} from "../src/contracts/rs-generation-repository.js";
import {RsGenerationService} from "../src/contracts/rs-generation-service.js";
import {InventoryRepository} from "../src/inventory/repository.js";
import {CommercialRepository} from "../src/commercial/repository.js";
import {ConsistencyChecker} from '../src/diagnostics/consistency-checker.js';

async function fixture(){
  const db=new PGlite();const directory=new URL("../migrations/",import.meta.url);
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
  async function start(unitId?:string){const unit=unitId?{id:unitId}:(await db.query<{id:string}>("SELECT id FROM units WHERE tenant_id=$1 AND commercial_status='available' AND project_id=$2 AND NOT EXISTS(SELECT 1 FROM sales_cases s WHERE s.unit_id=units.id AND s.status='active') LIMIT 1",[ids.tenantId,projectId])).rows[0];
    const hold=(await db.query<{sales_case_id:string;party_id:string}>("SELECT * FROM app.create_party_and_unit_hold($1,$2,'pre_reservation',now()+interval '48 hours',$3,$4,'Test','individual',NULL,'Evidence',$6,NULL,NULL,$5,NULL)",[ids.tenantId,unit.id,ids.membershipId,randomUUID(),`${randomUUID()}@example.test`,`Buyer ${randomUUID()}`])).rows[0];
    const c=(await db.query<{contract_id:string;version_id:string}>("SELECT * FROM app.create_contract_with_payment($1,$2,'rs',$3,'Technical RS',$4,NULL,$5,'fixed',250000,now()+interval '7 days')",[ids.tenantId,hold.sales_case_id,`EVID-${randomUUID()}`,ids.membershipId,randomUUID()])).rows[0];return{...c,unitId:unit.id,partyId:hold.party_id,salesCaseId:hold.sales_case_id};}
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
  return{db,database,context,projectId,inventory,start,approve,sign,evidence,external,uploads,files,fileBytes,templates,management,rs};
}

test('price creation and signed document integrity against all migrations',async t=>{
  const f=await fixture();try{
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
      const key=randomUUID();const first=await f.rs.generate({...f.context,contractId:c.contract_id,idempotencyKey:key});const retry=await f.rs.generate({...f.context,contractId:c.contract_id,idempotencyKey:key});assert.equal(first.documentVersionId,retry.documentVersionId);assert.equal(retry.replayed,true);
      await f.db.query("UPDATE party_individual_details SET first_name='Corrected' WHERE tenant_id=$1 AND party_id=$2",[f.context.tenantId,c.partyId]);
      const second=await f.rs.generate({...f.context,contractId:c.contract_id,idempotencyKey:randomUUID()});assert.notEqual(second.documentVersionId,first.documentVersionId);assert.equal(second.contractVersion,2);
      assert.equal((await f.db.query<{count:number}>("SELECT count(*)::int count FROM document_generation_operations WHERE contract_id=$1 AND state='completed'",[c.contract_id])).rows[0].count,2);
      c.version_id=second.contractVersionId;await f.approve(c);await f.evidence.exactFile({...f.context,contractId:c.contract_id,versionId:c.version_id});await f.sign(c);
      await assert.rejects(f.db.query("UPDATE document_generation_operations SET generation_snapshot='{}' WHERE output_document_version_id=$1",[second.documentVersionId]),/immutable/);
      assert.equal((await f.db.query<{count:number}>("SELECT count(*)::int count FROM document_versions WHERE document_id=$1",[first.documentId])).rows[0].count,2);
    });
    await t.test('external upload, exact hash, signature retry, and immutable document',async()=>{
      const c=await f.start();const uploaded=await f.external(c);const exact=await f.evidence.exactFile({...f.context,contractId:c.contract_id,versionId:uploaded.versionId});assert.deepEqual(exact.bytes,f.fileBytes);
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
  }finally{await f.db.close();}
});

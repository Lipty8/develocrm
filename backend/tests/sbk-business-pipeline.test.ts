import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {strFromU8,unzipSync} from 'fflate';
import {RsGenerationService,RsGenerationError,buildSnapshot} from '../src/contracts/rs-generation-service.js';
import type {RsSource} from '../src/contracts/rs-generation-repository.js';
import {originalPaymentPlan} from '../src/contracts/original-payment-plan.js';
import {DocumentTemplateGenerationService} from '../src/documents/template-generation-service.js';
import type {GenerationOperation,TemplateSource} from '../src/documents/template-generation-repository.js';
import type {DocumentUploadReservation} from '../src/documents/repository.js';
import {SharePointDocumentUploadService} from '../src/documents/upload-service.js';
import type {GraphFileMetadata,MicrosoftGraphAdapter} from '../src/documents/graph-adapter.js';
import {inspectDocxTemplate} from '../src/documents/docx-template.js';
import {SBK_DOB_DELIVERY_VARIANT,templateCatalog} from '../src/documents/template-catalog.js';
import {contractAppendixRequirements} from '../src/shared/contract-appendices.js';

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const context={tenantId:id(1),userId:id(2),membershipId:id(3)};
const mime='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const sha=(bytes:Uint8Array)=>`sha256:${createHash('sha256').update(bytes).digest('hex')}`;

function source():RsSource{
  const terms=originalPaymentPlan({type:'sbk',totalPrice:'5000000.03',reservationFeeAmount:'250000',paidReservationFeeAmount:'250000'});
  return {contractId:id(4),projectId:id(5),projectName:'TECHNICKÝ PROJEKT',projectCode:'TEST',completionYear:'2028',
    unitId:id(6),unitCode:'T-SBK',contractType:'sbk',templateVariant:SBK_DOB_DELIVERY_VARIANT,
    floorNumber:3,floorLabel:'3.NP',layout:'2+kk',areaM2:55.5,balconyM2:5,terraceM2:null,gardenM2:12,
    unitPrice:4500000,totalPrice:5000000.03,reservationFee:250000,reservationFeeDueDays:3,reservationPeriodDays:30,
    settings:{name:'TECHNICKÝ PRODÁVAJÍCÍ s.r.o.',address:'Testovací sídlo 1, Praha',registrationNumber:'00000000',
      registryEntry:'Technický zápis',representative:'Testovacím zástupcem',email:'seller@example.test',dataBox:'TEST',
      bankAccount:'TEST-1',bankName:'TECHNICKÁ BANKA',signatureName:'Testovací zástupce',clientChangesBankAccount:'TEST-2',deliveryAddress:'Testovací doručování 2'},
    salesCaseId:id(7),reference:'TECH-SBK-NEPODEPISOVAT',status:'draft',caseStatus:'active',variableSymbol:'701001',
    signedRsCount:1,signedRsContractId:id(8),paidReservationFee:250000,
    signingPlan:{versionId:id(9),sellerPlannedOn:'2026-11-02',buyerPlannedOn:'2026-11-03',editable:true},
    buyers:[{id:id(10),partyType:'individual',displayName:'Testovací Kupující',salutation:'paní',firstName:'Testovací',lastName:'Kupující',
      birthDate:'1990-01-01',registrationNumber:null,address:'Testovací bydliště 1, Praha, CZ',deliveryAddress:'Testovací doručování 3, Brno, CZ',
      email:'buyer@example.test',phone:'+420 777 000 701',dataBox:null}],
    accessories:[{code:'S-1',type:'cellar',legalForm:'cellar_unit',amount:100000,floorLabel:'1.PP',description:null},
      {code:'P-1',type:'parking',legalForm:'outdoor_parking_use_right',amount:200000,floorLabel:null,description:null},
      {code:'G-1',type:'garage',legalForm:'garage_coownership',shareNumerator:1,shareDenominator:25,amount:200000,floorLabel:'1.PP',description:null}],
    templateVersionId:id(11),templateHash:null,templateApprovalStatus:'approved',approvedTemplateCount:1,
    documentId:null,documentVersionId:null,webUrl:null,contractVersion:null,
    appendixSelections:contractAppendixRequirements('sbk',SBK_DOB_DELIVERY_VARIANT).map(({number})=>({number,documentId:id(100+number),
      documentVersionId:id(200+number),name:`Technická příloha ${number}`,version:'v1',available:true})),
    paymentTerms:{version:1,profile:'dejvice-original-dob-full-v1',calendarPolicy:'cz-2026-v1',signatureAnchor:'last_required_signature',
      contractType:'sbk',totalPrice:'5000000.03',reservationFee:'250000',paidReservationFee:'250000',precedingRsContractId:id(8),buyerPartyId:id(10),
      variableSymbol:'701001',rows:terms.map(row=>({key:row.key,amount:row.amount,anchor:row.anchor,days:row.days,calendar:row.calendar}))},
  };
}

/** Real business mapper, renderer and upload service. Only persistence and
 * Microsoft Graph are in-memory ports; this is not a live SharePoint test. */
async function harness(failFinalizationOnce=false){
  const current=source();const templateBytes=await readFile(new URL('../templates/review/sbk-dejvice-original-delivery-review.docx',import.meta.url));
  const catalog=templateCatalog('future_purchase_contract',SBK_DOB_DELIVERY_VARIANT)!;
  const template:TemplateSource={templateId:id(12),templateVersionId:id(11),projectId:current.projectId,templateCode:'technical-sbk',
    templateName:'TECH SBK',outputTypeCode:'future_purchase_contract',versionLabel:'technical-v2',contentHash:sha(templateBytes),
    schema:{fields:Object.fromEntries(Object.entries(catalog.fields).map(([key,value])=>[key,{required:value.required}])),
      appendices:contractAppendixRequirements('sbk',SBK_DOB_DELIVERY_VARIANT)},approvalStatus:'approved',effectiveFrom:'2026-01-01',
    driveId:'drive',itemId:'source',externalVersionId:'1.0',variantKey:SBK_DOB_DELIVERY_VARIANT};
  current.templateHash=template.contentHash;
  let operation:GenerationOperation|undefined,upload:DocumentUploadReservation|undefined;
  let uploadCalls=0,bindCalls=0,finalizeCalls=0;let persisted:Uint8Array|undefined;let bound=false;let reservedRequestHash:string|undefined;
  const items=new Map<string,GraphFileMetadata>();
  const connection={id:id(13),name:'Technical',entraTenantId:id(14),siteId:'site',driveId:'drive',authenticationMode:'managed_identity',credentialReference:'managed-identity://technical-client'};
  const metadata=(itemId:string,name:string,parentItemId:string,isFolder=false):GraphFileMetadata=>({driveId:'drive',itemId,name,parentItemId,isFolder,
    mimeType:isFolder?null:mime,size:isFolder?0:persisted?.length??0,etag:isFolder?null:'etag-1',webUrl:`https://sharepoint.test/${itemId}`});
  const graph:MicrosoftGraphAdapter={getSite:async()=>null,listSiteDrives:async()=>[],delta:async()=>({items:[],deletedItemIds:[],nextCursor:null}),
    listFiles:async(_c,parent='root')=>[...items.values()].filter(item=>item.parentItemId===parent),
    createFolder:async(_c,parent,name)=>{const item=metadata(`folder-${items.size}`,name,parent,true);items.set(item.itemId,item);return item;},
    uploadFile:async(_c,parent,name,bytes)=>{uploadCalls++;persisted=Uint8Array.from(bytes);const item=metadata('output',name,parent);items.set(item.itemId,item);return item;},
    getFileMetadata:async(_c,itemId)=>items.get(itemId)??null,moveOrRenameFile:async()=>{throw new Error('not used');},
    downloadFile:async(_c,itemId,version)=>{assert.equal(version,'1.0');return itemId==='source'?templateBytes:persisted!;},
    getVersions:async()=>[{id:'1.0',label:'1.0',size:persisted?.length??0,etag:'etag-1',createdAt:null}]};
  const documents={getConnectionForUpload:async()=>connection,
    reserveUpload:async(input:Record<string,unknown>)=>{
      if(upload){assert.equal(upload.requestHash,input.requestHash);return upload;}
      upload={id:id(16),projectId:current.projectId,idempotencyKey:String(input.idempotencyKey),requestHash:String(input.requestHash),operationType:'create',
        documentId:id(17),documentVersionId:id(18),originalFileName:String(input.fileName),sharePointFileName:null,targetPath:null,mimeType:mime,
        fileSize:Number(input.fileSize),contentHash:String(input.contentHash),versionLabel:String(input.versionLabel),documentStatus:'ready',metadata:{},
        baselineEtag:null,state:'reserved',graphDriveId:null,graphItemId:null,graphWebUrl:null,graphEtag:null,graphVersionId:null,graphFileSize:null,
        projectCode:current.projectCode,unitCode:current.unitCode,partyName:current.buyers[0].displayName,currentItemId:null,currentItemName:null};return upload;
    },
    getUploadReservation:async()=>upload!,prepareUploadTarget:async(input:{targetPath:string[];sharePointFileName:string})=>{
      Object.assign(upload!,{targetPath:input.targetPath,sharePointFileName:input.sharePointFileName});return{id:upload!.id};},
    recordGraphUpload:async(input:Record<string,unknown>)=>{
      assert.equal(input.storedContentHash,sha(persisted!));Object.assign(upload!,{state:'uploaded',graphDriveId:input.driveId,graphItemId:input.itemId,
        graphWebUrl:input.webUrl,graphEtag:input.etag,graphVersionId:input.externalVersionId,graphFileSize:input.fileSize});return{id:upload!.id};},
    finalizeUpload:async()=>{finalizeCalls++;if(failFinalizationOnce&&finalizeCalls===1)throw new Error('synthetic DB failure');
      upload!.state='completed';return{documentId:upload!.documentId,documentVersionId:upload!.documentVersionId,replayed:finalizeCalls>1};},
  };
  const uploads=new SharePointDocumentUploadService(documents as never,graph,'technical-client');
  const generationRepository={getTemplate:async()=>template,
    reserve:async(input:{snapshot:Record<string,string>;requestHash:string;contractAppendices:unknown})=>{
      assert.equal((input.contractAppendices as {versionId:string}).versionId,current.signingPlan!.versionId);
      if(operation){if(input.requestHash!==reservedRequestHash)throw new Error('idempotency key payload mismatch');return operation;}
      reservedRequestHash=input.requestHash;
      operation={id:id(15),state:'reserved',projectId:current.projectId,template,snapshot:structuredClone(input.snapshot),outputDocumentId:null,
        outputDocumentVersionId:null,unitId:current.unitId,partyId:current.buyers[0].id,salesCaseId:current.salesCaseId,contractId:current.contractId,createdAt:'2026-10-23T10:00:00.000Z'};return operation;
    },complete:async(input:{renderedContentHash:string;documentId:string;documentVersionId:string})=>{
      assert.equal(input.renderedContentHash,sha(persisted!));assert.equal(upload?.state,'completed');
      Object.assign(operation!,{state:'completed',outputDocumentId:input.documentId,outputDocumentVersionId:input.documentVersionId});
    }};
  const generator=new DocumentTemplateGenerationService(generationRepository as never,documents as never,uploads,graph);
  const repository={load:async()=>current,completedGeneration:async()=>bound?{contractType:'sbk',operationId:operation!.id,documentId:id(17),documentVersionId:id(18),templateVersionId:id(11),snapshot:operation!.snapshot}:null,
    bind:async(input:Record<string,unknown>)=>{bindCalls++;assert.equal(operation?.state,'completed');assert.equal(input.documentVersionId,id(18));
      assert.deepEqual(input.snapshot,operation?.snapshot);bound=true;return{versionId:id(9),versionNumber:1};}};
  return{service:new RsGenerationService(repository as never,generator),current,template,generationRepository,
    get uploads(){return uploadCalls;},get binds(){return bindCalls;},get bytes(){return persisted;},get operation(){return operation;},get upload(){return upload;}};
}

test('SBK v2: schválená verze, autorizovaná data, strict DOCX, existující upload a přesná contract vazba',async()=>{
  const h=await harness();const input={...context,contractId:h.current.contractId,idempotencyKey:'technical-sbk-pipeline'};
  const before=JSON.stringify(h.current);const readiness=await h.service.readiness(input);assert.deepEqual(readiness.issues,[]);assert.equal(readiness.ready,true);
  const first=await h.service.generate(input);assert.equal(first.documentVersionId,id(18));assert.equal(first.contractVersionId,id(9));assert.equal(h.uploads,1);
  assert.deepEqual(inspectDocxTemplate(h.bytes!).tokens,[]);const xml=strFromU8(unzipSync(h.bytes!)['word/document.xml']);
  assert.match(xml,/Testovací Kupující/);assert.match(xml,/Testovací doručování 2/);assert.match(xml,/55,5/);assert.match(xml,/G-1/);
  assert.equal(h.operation?.template.templateVersionId,id(11));assert.equal(h.operation?.template.contentHash,h.current.templateHash);
  assert.deepEqual(h.operation?.snapshot,buildSnapshot(h.current));assert.equal(h.upload?.graphVersionId,'1.0');assert.equal(h.upload?.state,'completed');
  const retry=await h.service.generate(input);assert.equal(retry.replayed,true);assert.equal(h.uploads,1);assert.equal(retry.contractVersionId,first.contractVersionId);
  assert.equal(JSON.stringify(h.current),before);
});

test('SBK v2: DB failure po fyzickém uploadu retryne stejný dokument bez druhé kopie',async()=>{
  const h=await harness(true);const input={...context,contractId:h.current.contractId,idempotencyKey:'technical-sbk-db-retry'};
  await assert.rejects(h.service.generate(input),/synthetic DB failure/);assert.equal(h.uploads,1);assert.equal(h.binds,0);assert.equal(h.operation?.state,'reserved');
  const result=await h.service.generate(input);assert.equal(result.documentVersionId,id(18));assert.equal(h.uploads,1);assert.equal(h.operation?.state,'completed');
});

test('SBK v2: chybějící schválení, neúplná příloha, neúčinná RS a uzavřený obchod nesmí zahájit upload',async()=>{
  for(const change of [
    (s:RsSource)=>{s.templateApprovalStatus='validated';s.approvedTemplateCount=0;},
    (s:RsSource)=>{s.signedRsCount=0;},(s:RsSource)=>{s.caseStatus='cancelled';},
    (s:RsSource)=>{s.appendixSelections![0].available=false;},(s:RsSource)=>{s.paidReservationFee=0;},
    (s:RsSource)=>{s.buyers[0].deliveryAddress=null;},
  ]){const h=await harness();change(h.current);await assert.rejects(h.service.generate({...context,contractId:h.current.contractId,idempotencyKey:'technical-sbk-rejected'}),
    e=>e instanceof RsGenerationError&&e.code==='not_ready');assert.equal(h.uploads,0);assert.equal(h.operation,undefined);}
});

test('SBK v2: změna dat po neúplném uploadu nemůže přepsat původní generation snapshot',async()=>{
  const h=await harness(true);const input={...context,contractId:h.current.contractId,idempotencyKey:'technical-sbk-changed-retry'};
  await assert.rejects(h.service.generate(input),/synthetic DB failure/);const frozen=structuredClone(h.operation!.snapshot);
  h.current.buyers[0].address='Jiná technická adresa';
  await assert.rejects(h.service.generate(input),/idempotency key payload mismatch/);
  assert.deepEqual(h.operation!.snapshot,frozen);assert.equal(h.binds,0);assert.equal(h.uploads,1);
});

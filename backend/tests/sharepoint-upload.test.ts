import assert from "node:assert/strict";
import test from "node:test";
import type { GraphFileMetadata, MicrosoftGraphAdapter } from "../src/documents/graph-adapter.js";
import { MicrosoftGraphRequestError } from "../src/documents/graph-adapter.js";
import type { DocumentUploadReservation } from "../src/documents/repository.js";
import { SharePointDocumentUploadService, SharePointUploadError, validateFileName } from "../src/documents/upload-service.js";

const context={tenantId:"30000000-0000-4000-8000-000000000001",userId:"20000000-0000-4000-8000-000000000001",membershipId:"40000000-0000-4000-8000-000000000001"};
const projectId="50000000-0000-4000-8000-000000000001";
const clientId="134a9cd1-c2d7-4386-b47c-c59260ad460c";

function reservation(overrides:Partial<DocumentUploadReservation>={}):DocumentUploadReservation{return{
  id:"60000000-0000-4000-8000-000000000001",projectId,idempotencyKey:"upload-test-0001",requestHash:"a".repeat(64),operationType:"create",
  documentId:"70000000-0000-4000-8000-000000000001",documentVersionId:"80000000-0000-4000-8000-000000000001",
  originalFileName:"test.txt",sharePointFileName:null,targetPath:null,mimeType:"text/plain",fileSize:4,contentHash:"sha256:"+"b".repeat(64),
  versionLabel:"v1",documentStatus:"draft",metadata:{typeCode:"other",documentName:"Test"},baselineEtag:null,state:"reserved",
  graphDriveId:null,graphItemId:null,graphWebUrl:null,graphEtag:null,graphVersionId:null,graphFileSize:null,projectCode:"TEST",unitCode:null,
  partyName:null,currentItemId:null,currentItemName:null,...overrides,
};}

function harness(options:{finalizeFailureOnce?:boolean;uploadFailure?:unknown;version?:boolean}={}){
  let current=reservation(options.version?{operationType:"version",documentId:"71000000-0000-4000-8000-000000000001",documentVersionId:"81000000-0000-4000-8000-000000000001",
    baselineEtag:"old",currentItemId:"item-existing",currentItemName:"contract.txt",metadata:{existingDocumentId:"71000000-0000-4000-8000-000000000001"}}:{});
  let uploadCalls=0,finalizeCalls=0;const items=new Map<string,GraphFileMetadata>();
  if(options.version)items.set("item-existing",file("item-existing","contract.txt","parent","old"));
  const graph:MicrosoftGraphAdapter={
    getSite:async()=>null,listSiteDrives:async()=>[],delta:async()=>({items:[],deletedItemIds:[],nextCursor:null}),
    listFiles:async(_connection,parent="root")=>[...items.values()].filter(item=>item.parentItemId===parent),
    createFolder:async(_connection,parent,name)=>{const item=file(`folder-${name}`,name,parent,null,true);items.set(item.itemId,item);return item;},
    uploadFile:async(_connection,parent,name)=>{uploadCalls++;if(options.uploadFailure&&uploadCalls===1)throw options.uploadFailure;
      const existing=[...items.values()].find(item=>item.parentItemId===parent&&item.name===name);const item=file(existing?.itemId??`item-${items.size}`,name,parent,`etag-${uploadCalls}`);items.set(item.itemId,item);return item;},
    getFileMetadata:async(_connection,itemId)=>items.get(itemId)??null,moveOrRenameFile:async()=>{throw new Error("not used");},
    downloadFile:async()=>new Uint8Array(),
    getVersions:async()=>[{id:"2.0",label:"2.0",size:4,etag:"etag",createdAt:null}],
  };
  const repository={
    reserveUpload:async()=>current,getConnectionForUpload:async()=>({id:"connection",name:"Pilot",entraTenantId:"entra",siteId:"site",driveId:"drive",
      authenticationMode:"managed_identity",credentialReference:`managed-identity://${clientId}`}),
    getUploadReservation:async()=>current,
    prepareUploadTarget:async(input:{targetPath:string[];sharePointFileName:string})=>{current={...current,targetPath:input.targetPath,sharePointFileName:input.sharePointFileName};return{id:current.id};},
    recordGraphUpload:async(input:{driveId:string;itemId:string;webUrl?:string|null;etag?:string|null;externalVersionId?:string|null;fileSize?:number|null})=>{
      current={...current,state:"uploaded",graphDriveId:input.driveId,graphItemId:input.itemId,graphWebUrl:input.webUrl??null,graphEtag:input.etag??null,graphVersionId:input.externalVersionId??null,graphFileSize:input.fileSize??null};return{id:current.id};},
    finalizeUpload:async()=>{finalizeCalls++;if(options.finalizeFailureOnce&&finalizeCalls===1)throw new Error("simulated db failure");current={...current,state:"completed"};return{documentId:current.documentId,documentVersionId:current.documentVersionId,replayed:finalizeCalls>1};},
  };
  return{service:new SharePointDocumentUploadService(repository as never,graph,clientId),get uploadCalls(){return uploadCalls;},get current(){return current;}};
}

function input(extra:Record<string,unknown>={}){return{...context,projectId,idempotencyKey:"upload-test-0001",typeCode:"other",documentName:"Technický test",fileName:"test.txt",mimeType:"text/plain",bytes:new TextEncoder().encode("test"),versionLabel:"v1",...extra} as never;}
function file(itemId:string,name:string,parentItemId:string,etag:string|null,isFolder=false):GraphFileMetadata{return{driveId:"drive",itemId,name,mimeType:isFolder?null:"text/plain",size:isFolder?0:4,etag,webUrl:`https://sharepoint.test/${itemId}`,parentItemId,isFolder};}

test("upload vytvoří deterministickou složku a opakovaný request nevytvoří fyzickou kopii",async()=>{
  const h=harness();const first=await h.service.upload(input());const second=await h.service.upload(input());
  assert.equal(h.uploadCalls,1);assert.equal(first.itemId,second.itemId);assert.equal(second.replayed,true);assert.match(first.itemId,/item-/);
});

test("nejistý Graph timeout se bezpečně retryne bez duplicitního souboru",async()=>{
  const h=harness({uploadFailure:new TypeError("timeout")});await h.service.upload(input());assert.equal(h.uploadCalls,2);
});

test("DB failure po Graph uploadu se při retry pouze finalizuje",async()=>{
  const h=harness({finalizeFailureOnce:true});await assert.rejects(h.service.upload(input()),/simulated db failure/);await h.service.upload(input());assert.equal(h.uploadCalls,1);
});

test("nová business verze přepisuje stejný SharePoint item a vytvoří CRM verzi",async()=>{
  const h=harness({version:true});const result=await h.service.upload(input({documentId:"71000000-0000-4000-8000-000000000001",typeCode:undefined,versionLabel:"v2"}));
  assert.equal(result.itemId,"item-existing");assert.equal(h.uploadCalls,1);
});

test("Graph 403 a 404 se mapují na bezpečné upload chyby",async()=>{
  for(const status of[403,404]){const h=harness({uploadFailure:new MicrosoftGraphRequestError(status,"request-id")});await assert.rejects(h.service.upload(input()),error=>error instanceof SharePointUploadError&&error.graphStatus===status);}
});

test("filename validation odmítá traversal a oddělovače cest",()=>{
  for(const name of["../secret.txt","folder/file.txt","folder\\file.txt",".."]){assert.throws(()=>validateFileName(name),SharePointUploadError);}
  assert.doesNotThrow(()=>validateFileName("Technický test 01.txt"));
});

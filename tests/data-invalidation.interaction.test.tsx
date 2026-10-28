import assert from "node:assert/strict";
import {before,mock} from "node:test";
import test from "node:test";
import {JSDOM} from "jsdom";
import {createApiFetch} from "../app/lib/api-client";
import {DATA_MUTATED_EVENT,type DataMutationDetail} from "../app/lib/data-invalidation";
import {templateRepository} from "../app/repositories/template-repository";
import {entraAuth} from "../app/lib/entra-auth";
import {documentRepository} from '../app/repositories/document-repository';
import {commercialRepository} from '../app/repositories/commercial-repository';

before(()=>{
  const dom=new JSDOM("<!doctype html><html><body></body></html>",{url:"https://develocrm.test"});
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,CustomEvent:dom.window.CustomEvent});
});
test('workflow document link keeps the modal open by leaving refresh to its scoped panel',async()=>{
 const originalFetch=globalThis.fetch;const token=mock.method(entraAuth,'getAccessToken',async()=> 'technical-token');
 let invalidations=0;const listener=()=>{invalidations++;};const sent:Array<{url:string;body:unknown}>=[];
 window.addEventListener(DATA_MUTATED_EVENT,listener);
 globalThis.fetch=async(input,init)=>{sent.push({url:String(input),body:JSON.parse(String(init?.body))});return new Response('{}',{status:200});};
 try{
  for(const type of ['client_change','complaint','handover'] as const)await documentRepository.link('technical-document',{type,targetId:'exact-target'});
  assert.equal(invalidations,0);
  assert.equal(sent.length,3);for(const request of sent)assert.equal(request.url,'/api/documents?documentId=technical-document&action=link&targetId=exact-target');
  assert.deepEqual(sent.map(request=>request.body),[{linkType:'client_change'},{linkType:'complaint'},{linkType:'handover'}]);
 }finally{globalThis.fetch=originalFetch;token.mock.restore();window.removeEventListener(DATA_MUTATED_EVENT,listener);}
});

test('contract preparation writes leave refresh to their existing scoped owner, not the whole workspace',async()=>{
 const originalFetch=globalThis.fetch;const token=mock.method(entraAuth,'getAccessToken',async()=> 'technical-token');
 let invalidations=0;const listener=()=>{invalidations++;};const sent:Array<{url:string;body:unknown}>=[];
 window.addEventListener(DATA_MUTATED_EVENT,listener);
 globalThis.fetch=async(input,init)=>{sent.push({url:String(input),body:JSON.parse(String(init?.body))});return Response.json({ok:true});};
 try{
  await commercialRepository.setSigningPlan('exact-contract',{versionId:'exact-version',sellerPlannedOn:'2026-11-02',buyerPlannedOn:'2026-11-03'});
  await commercialRepository.preparePaymentTerms('exact-contract','exact-version');
  await commercialRepository.setContractAppendix('exact-contract',{versionId:'exact-version',number:1,documentId:'doc',documentVersionId:'dv',expectedDocumentVersionId:'previous-dv'});
  assert.equal(invalidations,0);
  assert.deepEqual(sent,[
   {url:'/api/commercial/contracts/exact-contract/signing-plan',body:{versionId:'exact-version',sellerPlannedOn:'2026-11-02',buyerPlannedOn:'2026-11-03'}},
   {url:'/api/commercial/contracts/exact-contract/payment-terms',body:{versionId:'exact-version'}},
   {url:'/api/commercial/contracts/exact-contract/appendices',body:{versionId:'exact-version',number:1,documentId:'doc',documentVersionId:'dv',expectedDocumentVersionId:'previous-dv'}},
  ]);
 }finally{globalThis.fetch=originalFetch;token.mock.restore();window.removeEventListener(DATA_MUTATED_EVENT,listener);}
});

test('actual generation retains the existing broader invalidation for newly created document evidence',async()=>{
 const originalFetch=globalThis.fetch;const token=mock.method(entraAuth,'getAccessToken',async()=> 'technical-token');
 let invalidations=0;const listener=()=>{invalidations++;};window.addEventListener(DATA_MUTATED_EVENT,listener);
 globalThis.fetch=async()=>Response.json({generation:{operationId:'operation',documentId:'document',documentVersionId:'exact-document-version',contractVersionId:'exact-contract-version',contractVersion:1,replayed:false}});
 try{const result=await commercialRepository.generateContract('exact-contract','original-key');assert.equal(result.documentVersionId,'exact-document-version');assert.equal(invalidations,1);}
 finally{globalThis.fetch=originalFetch;token.mock.restore();window.removeEventListener(DATA_MUTATED_EVENT,listener);}
});

test("správa šablon obnovuje svůj seznam bez resetu projektového kontextu",async()=>{
  const originalFetch=globalThis.fetch;
  const token=mock.method(entraAuth,"getAccessToken",async()=>"test-token");
  let invalidations=0;
  const requests:string[]=[];
  const listener=()=>{invalidations+=1;};
  window.addEventListener(DATA_MUTATED_EVENT,listener);
  globalThis.fetch=async(input,init)=>{
    requests.push(String(input));
    assert.equal(init?.method,"POST");
    return new Response(JSON.stringify({version:{templateId:"template",templateVersionId:"version"}}),{status:200,headers:{"content-type":"application/json"}});
  };
  try{
    const file=new File(["technical test"],"test.docx",{type:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"});
    await templateRepository.upload({projectId:"project",code:"code",name:"test",outputTypeCode:"other",variantKey:"default",versionLabel:"1",effectiveFrom:"2026-10-17",file});
    for(const action of ["validate","approve","retire"] as const)await templateRepository.action("template","version",action);
    assert.equal(requests.length,4);
    assert.equal(invalidations,0);
  }finally{
    globalThis.fetch=originalFetch;
    token.mock.restore();
    window.removeEventListener(DATA_MUTATED_EVENT,listener);
  }
});

test("úspěšná mutace oznámí změnu dat bez reloadu stránky",async()=>{
  const originalFetch=globalThis.fetch;
  const details:DataMutationDetail[]=[];
  const listener=(event:Event)=>details.push((event as CustomEvent<DataMutationDetail>).detail);
  window.addEventListener(DATA_MUTATED_EVENT,listener);
  globalThis.fetch=async()=>new Response(JSON.stringify({ok:true}),{status:200,headers:{"content-type":"application/json"}});
  try{
    const apiFetch=createApiFetch({getAccessToken:async()=>"test-token"},globalThis.fetch,()=>false);
    const response=await apiFetch("/api/accessories/assignment-1",{method:"DELETE"});
    assert.equal(response.status,200);
    assert.deepEqual(details,[{method:"DELETE",target:"/api/accessories/assignment-1"}]);
  }finally{
    globalThis.fetch=originalFetch;
    window.removeEventListener(DATA_MUTATED_EVENT,listener);
  }
});

test("neúspěšná mutace invalidaci dat nevyvolá",async()=>{
  const originalFetch=globalThis.fetch;
  let calls=0;
  const listener=()=>{calls+=1;};
  window.addEventListener(DATA_MUTATED_EVENT,listener);
  globalThis.fetch=async()=>new Response(JSON.stringify({error:"failed"}),{status:409,headers:{"content-type":"application/json"}});
  try{
    const apiFetch=createApiFetch({getAccessToken:async()=>"test-token"},globalThis.fetch,()=>false);
    const response=await apiFetch("/api/contracts/contract-1",{method:"PATCH",body:"{}"});
    assert.equal(response.status,409);
    assert.equal(calls,0);
  }finally{
    globalThis.fetch=originalFetch;
    window.removeEventListener(DATA_MUTATED_EVENT,listener);
  }
});

test("cíleně obsloužený upload média nevyvolá globální obnovu dat",async()=>{
  const originalFetch=globalThis.fetch;
  let calls=0;
  const listener=()=>{calls+=1;};
  window.addEventListener(DATA_MUTATED_EVENT,listener);
  globalThis.fetch=async(_input,init)=>{
    assert.equal(new Headers(init?.headers).has("dataInvalidation"),false);
    return new Response(JSON.stringify({media:{id:"media-1"}}),{status:201,headers:{"content-type":"application/json"}});
  };
  try{
    const apiFetch=createApiFetch({getAccessToken:async()=>"test-token"},globalThis.fetch,()=>false);
    const response=await apiFetch("/api/media",{method:"POST",body:new FormData(),dataInvalidation:"none"});
    assert.equal(response.status,201);
    assert.equal(calls,0);
  }finally{
    globalThis.fetch=originalFetch;
    window.removeEventListener(DATA_MUTATED_EVENT,listener);
  }
});

test("úspěšné tiché obnovení tokenu nerestartuje pracovní prostor",async()=>{
  const originalFetch=globalThis.fetch;
  let requests=0;let restored=0;
  const listener=()=>{restored+=1;};
  window.addEventListener("develocrm:session-restored",listener);
  globalThis.fetch=async()=>++requests===1
    ? new Response(null,{status:401})
    : new Response(JSON.stringify({ok:true}),{status:200,headers:{"content-type":"application/json"}});
  try{
    const apiFetch=createApiFetch({getAccessToken:async()=>"old-token",refreshAccessToken:async()=>"new-token"},globalThis.fetch,()=>false);
    const response=await apiFetch("/api/media",{method:"POST",body:new FormData(),dataInvalidation:"none"});
    assert.equal(response.status,200);
    assert.equal(requests,2);
    assert.equal(restored,0);
  }finally{
    globalThis.fetch=originalFetch;
    window.removeEventListener("develocrm:session-restored",listener);
  }
});

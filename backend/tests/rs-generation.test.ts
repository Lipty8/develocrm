import test from "node:test";import assert from "node:assert/strict";import {readFile} from "node:fs/promises";
import {RsGenerationError,RsGenerationService} from "../src/contracts/rs-generation-service.js";
import {inspectDocxTemplate,renderDocxTemplate} from "../src/documents/docx-template.js";
import {RS_PLACEHOLDERS} from "../src/documents/template-generation-service.js";

const context={tenantId:"10000000-0000-0000-0000-000000000001",userId:"10000000-0000-0000-0000-000000000002",membershipId:"10000000-0000-0000-0000-000000000003"};
function source(overrides:Record<string,unknown>={}){return{contractId:"20000000-0000-0000-0000-000000000001",projectId:"20000000-0000-0000-0000-000000000002",projectName:"Rezidence Dejvice",projectCode:"DEJ",completionYear:"2027",unitId:"20000000-0000-0000-0000-000000000003",unitCode:"417",layout:"4+kk",floorLabel:"4. NP",areaM2:112.4,balconyM2:10,gardenM2:null,unitPrice:20_000_000,totalPrice:22_000_000,reservationFee:250_000,reservationFeeDueDays:3,reservationPeriodDays:30,settings:{name:"Rezidence Dejvice 2 s.r.o.",registrationNumber:"24106119",address:"Rohanské nábřeží 693/10, 186 00 Praha 8",registryEntry:"Městský soud v Praze, oddíl C, vložka 179591",representative:"Jaroslav Žahourek",email:"info@example.cz",dataBox:"abc123",bankAccount:"123/0100",bankName:"UniCredit Bank Czech Republic and Slovakia a.s."},salesCaseId:"20000000-0000-0000-0000-000000000004",reference:"RS-417",status:"draft",buyers:[{id:"20000000-0000-0000-0000-000000000005",partyType:"individual",displayName:"Jan Novák",salutation:"pan",firstName:"Jan",lastName:"Novák",birthDate:"1980-05-12",registrationNumber:null,address:"Květnová 1, 160 00 Praha 6",email:"jan@example.cz",phone:"+420 777 000 111",dataBox:null}],accessories:[{code:"P9",type:"parking",amount:800_000,floorLabel:"1. NP",description:"Venkovní stání"},{code:"S7",type:"cellar",amount:300_000,floorLabel:"1. PP",description:null}],templateVersionId:"20000000-0000-0000-0000-000000000006",templateHash:"sha256:test",documentId:null,documentVersionId:null,webUrl:null,contractVersion:null,...overrides};}

test("RS připravenost rozlišuje kompletní a chybějící business údaje",async()=>{
  let current=source();const repository={load:async()=>current,bind:async()=>({versionId:"v1",versionNumber:1})};const generator={generate:async()=>({operationId:"op",documentId:"doc",documentVersionId:"docv",replayed:false})};
  const service=new RsGenerationService(repository as never,generator as never);assert.equal((await service.readiness({...context,contractId:current.contractId})).ready,true);
  current=source({buyers:[{...source().buyers[0],address:null}],reservationFee:null});const result=await service.readiness({...context,contractId:current.contractId});assert.equal(result.ready,false);assert.deepEqual(result.issues.map(item=>item.code).sort(),["buyer_address","reservation_fee"]);
});

test("skutečná v1 šablona bezpečně blokuje firmu a více kupujících",async()=>{
  for(const buyers of [[{...source().buyers[0],partyType:"organization"}],[source().buyers[0],{...source().buyers[0],id:"other"}]]){
    const current=source({buyers});const service=new RsGenerationService({load:async()=>current} as never,{} as never);const result=await service.readiness({...context,contractId:current.contractId});assert.equal(result.ready,false);assert.ok(result.issues.some(item=>item.code=== (buyers.length>1?"buyer_count":"buyer_type")));
  }
});

test("šablona blokuje příslušenství, které neumí právně popsat",async()=>{const current=source({accessories:[...source().accessories,{code:"WB1",type:"wallbox",amount:50_000,floorLabel:"1. PP",description:null}]});const service=new RsGenerationService({load:async()=>current} as never,{} as never);const result=await service.readiness({...context,contractId:current.contractId});assert.equal(result.ready,false);assert.ok(result.issues.some(item=>item.code==="unsupported_wallbox"));});

test("generování předá pouze serverový snapshot a retry je idempotentně svázaný",async()=>{
  const current=source();let captured:Record<string,unknown>|undefined;let binds=0;const repository={load:async()=>current,bind:async()=>{binds++;return{versionId:"v1",versionNumber:1};}};
  const generator={generate:async(input:Record<string,unknown>)=>{captured=input;return{operationId:"op",documentId:"doc",documentVersionId:"docv",replayed:binds>0};}};
  const service=new RsGenerationService(repository as never,generator as never);const result=await service.generate({...context,contractId:current.contractId,idempotencyKey:"rs-test-12345678"});assert.equal(result.contractVersion,1);assert.equal(binds,1);assert.deepEqual(Object.keys(captured?.snapshot as object).sort(),[...RS_PLACEHOLDERS].sort());assert.equal((captured?.snapshot as Record<string,string>)["buyer.name"],"Jan Novák");
});

test("parametrizovaná právní šablona má přesné schema a render nezanechá placeholdery",async()=>{
  const bytes=await readFile(new URL("../templates/rs/rezidence-dejvice-rs-v1.docx",import.meta.url));const inspection=inspectDocxTemplate(bytes);assert.deepEqual(inspection.tokens,[...RS_PLACEHOLDERS].sort());
  const snapshot=Object.fromEntries(RS_PLACEHOLDERS.map(token=>[token,`TEST ${token}`]));const rendered=renderDocxTemplate(bytes,snapshot,{allowedTokens:[...RS_PLACEHOLDERS],requiredTokens:[...RS_PLACEHOLDERS]});assert.equal(inspectDocxTemplate(rendered.bytes).tokens.length,0);assert.ok(rendered.bytes.byteLength>10_000);
});

test("nepřipravená RS se nevygeneruje",async()=>{const current=source({templateVersionId:null});const service=new RsGenerationService({load:async()=>current} as never,{generate:async()=>assert.fail("renderer neměl být volán")} as never);await assert.rejects(service.generate({...context,contractId:current.contractId,idempotencyKey:"rs-test-87654321"}),error=>error instanceof RsGenerationError&&error.code==="not_ready");});

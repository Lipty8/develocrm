import test from "node:test";import assert from "node:assert/strict";import {readFile} from "node:fs/promises";
import {RsGenerationError,RsGenerationService,buildSnapshot} from "../src/contracts/rs-generation-service.js";
import {RsGenerationRepository} from "../src/contracts/rs-generation-repository.js";
import {inspectDocxTemplate,renderDocxTemplate} from "../src/documents/docx-template.js";
import {RS_PLACEHOLDERS} from "../src/documents/template-generation-service.js";
import {ORIGINAL_DOB_FULL_VARIANT} from '../src/documents/template-catalog.js';

const context={tenantId:"10000000-0000-0000-0000-000000000001",userId:"10000000-0000-0000-0000-000000000002",membershipId:"10000000-0000-0000-0000-000000000003"};
test('original readiness requires every numbered exact appendix and never treats a filename as evidence',async()=>{
  let current=source({templateVariant:ORIGINAL_DOB_FULL_VARIANT,
    signingPlan:{versionId:'working-version',sellerPlannedOn:null,buyerPlannedOn:null,editable:true}});
  const service=new RsGenerationService({load:async()=>current} as never,{} as never);
  let result=await service.readiness({...context,contractId:current.contractId});
  assert.equal(result.issues.filter(item=>item.code==='contract_appendix').length,6);
  assert.equal(result.summary?.appendices?.items.length,6);assert.equal(result.summary?.appendices?.contractVersionId,'working-version');
  const selections=Array.from({length:6},(_,index)=>({number:index+1,documentId:`doc-${index}`,documentVersionId:`exact-${index}`,name:'Explicitly selected document',version:'v1',available:true}));
  current=source({...current,appendixSelections:selections});
  result=await service.readiness({...context,contractId:current.contractId});
  assert.equal(result.issues.filter(item=>item.code==='contract_appendix').length,0);
  assert.equal(result.ready,false);assert.ok(result.issues.some(item=>item.code==='approved_template'));
  current=source({...current,appendixSelections:[...selections.slice(0,5),{...selections[5],available:false}]});
  result=await service.readiness({...context,contractId:current.contractId});
  assert.deepEqual(result.issues.filter(item=>item.code==='contract_appendix').map(item=>item.field),['contract.appendices.6']);
});
test('appendix updates preserve authorized context, exact version and optimistic token',async()=>{
  const current=source({templateVariant:ORIGINAL_DOB_FULL_VARIANT});let forwarded:unknown;
  const body={versionId:context.tenantId,number:1,documentId:context.userId,documentVersionId:context.membershipId,expectedDocumentVersionId:null};
  const service=new RsGenerationService({load:async()=>current,setAppendix:async(input:unknown)=>{forwarded=input;return{linkId:'link'};}} as never,{} as never);
  await service.setAppendix({...context,contractId:current.contractId},body);
  assert.deepEqual(forwarded,{...context,contractId:current.contractId,...body});
  await assert.rejects(service.setAppendix({...context,contractId:current.contractId},{...body,number:7}),error=>error instanceof RsGenerationError&&error.code==='appendix_not_supported');
});
test('original preparation requires a current payment plan but never activates the legal template',async()=>{
  const base=source();const paymentTerms={version:1,profile:ORIGINAL_DOB_FULL_VARIANT,calendarPolicy:'cz-2026-v1',signatureAnchor:'last_required_signature',contractType:'rs',
    totalPrice:'22000000.00',reservationFee:'250000',paidReservationFee:'0',precedingRsContractId:null,buyerPartyId:base.buyers[0].id,variableSymbol:'417',
    rows:[{key:'rs_fee',amount:'250000',anchor:'effective_signature',days:3,calendar:'czech_working_days'}]};
  let current=source({templateVariant:ORIGINAL_DOB_FULL_VARIANT,paymentTerms,signingPlan:{versionId:'current',sellerPlannedOn:'2026-10-01',buyerPlannedOn:'2026-10-01',editable:true}});
  const service=new RsGenerationService({load:async()=>current} as never,{} as never);
  let result=await service.readiness({...context,contractId:current.contractId});
  assert.equal(result.issues.some(i=>i.code==='contract_payment_terms'),false);assert.equal(result.ready,false);
  assert.ok(result.issues.some(i=>i.code==='approved_template'));assert.equal(result.summary?.paymentPlan?.variableSymbol,'417');
  for(const update of [{paymentTerms:null},{totalPrice:23000000},{reservationFee:260000},{buyers:[{...base.buyers[0],id:context.userId}]}]){
    current=source({templateVariant:ORIGINAL_DOB_FULL_VARIANT,paymentTerms,...update});
    result=await service.readiness({...context,contractId:current.contractId});assert.ok(result.issues.some(i=>i.code==='contract_payment_terms'));
    assert.equal(result.summary?.paymentPlan,undefined);
  }
});
test('preparing contractual terms uses authorized CRM context and the exact selected version only',async()=>{
  const current=source({templateVariant:ORIGINAL_DOB_FULL_VARIANT});let forwarded:unknown;
  const service=new RsGenerationService({load:async()=>current,preparePaymentTerms:async(input:unknown)=>{forwarded=input;return{version:1};}} as never,{} as never);
  const input={...context,contractId:current.contractId,versionId:'exact-version'};await service.preparePaymentTerms(input);assert.deepEqual(forwarded,input);
  const legacy=new RsGenerationService({load:async()=>source()} as never,{} as never);
  await assert.rejects(legacy.preparePaymentTerms(input),/TEMPLATE_PROFILE_REQUIRED/);
  const missing=new RsGenerationService({load:async()=>null} as never,{} as never);
  await assert.rejects(missing.preparePaymentTerms(input),error=>error instanceof RsGenerationError&&error.code==='contract_not_found');
});
function source(overrides:Record<string,unknown>={}){return{contractId:"20000000-0000-0000-0000-000000000001",projectId:"20000000-0000-0000-0000-000000000002",projectName:"Rezidence Dejvice",projectCode:"DEJ",completionYear:"2027",unitId:"20000000-0000-0000-0000-000000000003",unitCode:"417",layout:"4+kk",floorLabel:"4. NP",areaM2:112.4,balconyM2:10,gardenM2:null,unitPrice:20_000_000,totalPrice:22_000_000,reservationFee:250_000,reservationFeeDueDays:3,reservationPeriodDays:30,settings:{name:"Rezidence Dejvice 2 s.r.o.",registrationNumber:"24106119",address:"Rohanské nábřeží 693/10, 186 00 Praha 8",registryEntry:"Městský soud v Praze, oddíl C, vložka 179591",representative:"Jaroslav Žahourek",email:"info@example.cz",dataBox:"abc123",bankAccount:"123/0100",bankName:"UniCredit Bank Czech Republic and Slovakia a.s."},salesCaseId:"20000000-0000-0000-0000-000000000004",reference:"RS-417",status:"draft",buyers:[{id:"20000000-0000-0000-0000-000000000005",partyType:"individual",displayName:"Jan Novák",salutation:"pan",firstName:"Jan",lastName:"Novák",birthDate:"1980-05-12",registrationNumber:null,address:"Květnová 1, 160 00 Praha 6",email:"jan@example.cz",phone:"+420 777 000 111",dataBox:null}],accessories:[{code:"P9",type:"parking",amount:800_000,floorLabel:"1. NP",description:"Venkovní stání"},{code:"S7",type:"cellar",amount:300_000,floorLabel:"1. PP",description:null}],templateVersionId:"20000000-0000-0000-0000-000000000006",templateHash:"sha256:test",documentId:null,documentVersionId:null,webUrl:null,contractVersion:null,...overrides};}

test('starší RS mapování rovněž neztrácí haléře v číselné ani slovní ceně',()=>{
  const current=source({totalPrice:22000000.03,reservationFee:250000.01});
  const snapshot=buildSnapshot({...current,buyers:current.buyers.map(buyer=>({...buyer,partyType:'individual' as const}))});
  assert.match(snapshot['contract.totalPriceClause'].replace(/\u00a0/g,' '),/22 000 000,03 Kč/);
  assert.match(snapshot['contract.totalPriceClause'],/celých tři setiny/);
  assert.match(snapshot['payment.reservationFeeClause'].replace(/\u00a0/g,' '),/250 000,01 Kč/);
});
test("RS připravenost rozlišuje kompletní a chybějící business údaje",async()=>{
  let current=source();const repository={load:async()=>current,bind:async()=>({versionId:"v1",versionNumber:1})};const generator={generate:async()=>({operationId:"op",documentId:"doc",documentVersionId:"docv",replayed:false})};
  const service=new RsGenerationService(repository as never,generator as never);assert.equal((await service.readiness({...context,contractId:current.contractId})).ready,true);
  current=source({buyers:[{...source().buyers[0],address:null}],reservationFee:null});const result=await service.readiness({...context,contractId:current.contractId});assert.equal(result.ready,false);assert.deepEqual(result.issues.map(item=>item.code).sort(),["buyer_address","reservation_fee"]);
});

test('kontrolní přehled používá skutečný smluvní kontext a odkazuje na opravu kupujícího',async()=>{
  let current=source({templateName:'Projektová RS',templateVersionLabel:'v3',templateEffectiveFrom:'2026-10-01'});
  const service=new RsGenerationService({load:async()=>current} as never,{} as never);
  const first=await service.readiness({...context,contractId:current.contractId});
  assert.equal(first.summary?.totalPrice,22_000_000);assert.equal(first.summary?.reservationFee,250_000);
  assert.equal(first.summary?.template?.version,'v3');assert.equal(first.summary?.buyers[0].label,'Jan Novák');
  current=source({buyers:[{...source().buyers[0],displayName:'Petr Nový',firstName:'Petr',lastName:'Nový',address:null}]});
  const next=await service.readiness({...context,contractId:current.contractId});
  assert.equal(next.summary?.buyers[0].label,'Petr Nový');
  assert.ok(next.issues.find(i=>i.code==='buyer_address')?.action?.href.startsWith(`/clients/${current.buyers[0].id}?returnTo=`));
});

test('uzavřený obchod, neplatná plocha a nepodporovaná terasa zastaví přípravu bez právních domněnek',async()=>{
  const current=source({caseStatus:'cancelled',areaM2:0,terraceM2:12});const service=new RsGenerationService({load:async()=>current} as never,{} as never);
  const result=await service.readiness({...context,contractId:current.contractId});
  assert.equal(result.ready,false);assert.deepEqual(result.issues.map(i=>i.code).sort(),['closed_case','unit_area','unsupported_terrace']);
});

test('výběr RS šablony respektuje tenant, projekt, výchozí variantu, schválení a účinnost',async()=>{
  let sql='';let values:unknown[]=[];
  const repo=new RsGenerationRepository({withContext:async(_ctx:unknown,work:(client:unknown)=>unknown)=>work({query:async(q:string,v:unknown[])=>{sql=q;values=v;return{rows:[]};}})} as never);
  assert.equal(await repo.load({...context,contractId:source().contractId,permission:'contract.read'}),null);
  assert.ok(sql.includes('version.tenant_id=contract.tenant_id'));assert.ok(sql.includes('version.project_id=contract.project_id'));
  assert.ok(sql.includes("template.variant_key IN ('default','dejvice-original-dob-full-v1','dejvice-original-dob-delivery-v2')"));assert.ok(sql.includes("version.approval_status='approved'"));assert.ok(sql.includes('version.effective_from<=CURRENT_DATE'));
  assert.ok(sql.includes('template.contract_type=contract.contract_type'));
  assert.ok(sql.includes('approved_count'));
  assert.equal(values[0],context.tenantId);assert.equal(values[1],context.membershipId);
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

for(const contractType of ['rs','sbk'] as const)test(`${contractType}: recovery forwards only frozen business inputs and authenticated identity`,async()=>{
  const current=source({contractType});const snapshot={'buyer.name':'Original buyer','unit.price':'Original price'};
  const original={projectId:current.projectId,templateVersionId:'original-template',unitId:current.unitId,partyId:'original-party',
    salesCaseId:current.salesCaseId,contractId:current.contractId,documentId:'original-document',documentName:'Original name',snapshot};
  let captured:unknown;
  const repository={load:async()=>assert.fail('recovery must not recompute current CRM values'),
    pendingGeneration:async()=>({contractType,idempotencyKey:'frozen-key',request:original}),
    bind:async(input:{snapshot:unknown})=>{assert.deepEqual(input.snapshot,snapshot);return{versionId:'exact-contract-version',versionNumber:1};}};
  const generator={generate:async(input:unknown)=>{captured=input;return{operationId:'op',documentId:'doc',documentVersionId:'dv',replayed:true};}};
  const result=await new RsGenerationService(repository as never,generator as never).generate({...context,contractId:current.contractId,idempotencyKey:'frozen-key'});
  assert.equal(result.replayed,true);assert.deepEqual(captured,{...original,...context,idempotencyKey:'frozen-key',contractAppendices:undefined});
});
test('legacy pending generation without a stored request remains blocked',async()=>{
  const repository={pendingGeneration:async()=>({contractType:'rs',idempotencyKey:'legacy-key',request:null})};
  await assert.rejects(new RsGenerationService(repository as never,{generate:async()=>assert.fail('cannot guess legacy inputs')} as never)
    .generate({...context,contractId:source().contractId,idempotencyKey:'legacy-key'}),error=>error instanceof RsGenerationError&&error.code==='generation_recovery_unavailable');
});

test("parametrizovaná právní šablona má přesné schema a render nezanechá placeholdery",async()=>{
  const bytes=await readFile(new URL("../templates/rs/rezidence-dejvice-rs-v1.docx",import.meta.url));const inspection=inspectDocxTemplate(bytes);assert.deepEqual(inspection.tokens,[...RS_PLACEHOLDERS].sort());
  const snapshot=Object.fromEntries(RS_PLACEHOLDERS.map(token=>[token,`TEST ${token}`]));const rendered=renderDocxTemplate(bytes,snapshot,{allowedTokens:[...RS_PLACEHOLDERS],requiredTokens:[...RS_PLACEHOLDERS]});assert.equal(inspectDocxTemplate(rendered.bytes).tokens.length,0);assert.ok(rendered.bytes.byteLength>10_000);
});

test("nepřipravená RS se nevygeneruje",async()=>{const current=source({templateVersionId:null});const service=new RsGenerationService({load:async()=>current} as never,{generate:async()=>assert.fail("renderer neměl být volán")} as never);await assert.rejects(service.generate({...context,contractId:current.contractId,idempotencyKey:"rs-test-87654321"}),error=>error instanceof RsGenerationError&&error.code==="not_ready");});

test('SBK používá vlastní typ, skutečné CRM vazby a bezpečně popsané mezery originálu',async()=>{
  const current=source({contractType:'sbk',templateVariant:ORIGINAL_DOB_FULL_VARIANT,templateApprovalStatus:'validated',approvedTemplateCount:0,
    templateName:'SBK ke kontrole',floorNumber:null,signedRsCount:0,paidReservationFee:0});
  const service=new RsGenerationService({load:async()=>current} as never,{generate:async()=>assert.fail('neschválená SBK nesmí volat renderer')} as never);
  const result=await service.readiness({...context,contractId:current.contractId});
  assert.equal(result.contractType,'sbk');assert.equal(result.ready,false);assert.equal(result.summary?.template?.approvalStatus,'validated');
  assert.equal(result.summary?.unit.id,current.unitId);assert.equal(result.summary?.buyers[0].id,current.buyers[0].id);
  for(const code of ['approved_template','original_profile_review','unit_floor_number','buyer_delivery_address','signed_rs','reservation_fee_paid','planned_signing_dates','accessory_classification','accessory_legal_basis'])assert.ok(result.issues.some(i=>i.code===code),code);
  assert.ok(result.issues.find(i=>i.code==='buyer_delivery_address')?.action?.href.startsWith(`/clients/${current.buyers[0].id}?returnTo=`));
  await assert.rejects(service.generate({...context,contractId:current.contractId,idempotencyKey:'sbk-blocked-1234'}),e=>e instanceof RsGenerationError&&e.code==='not_ready');
});

test('původní kompletní varianta rozliší terasu a číselné podlaží bez parsování textu',async()=>{
  const current=source({templateVariant:ORIGINAL_DOB_FULL_VARIANT,templateApprovalStatus:'approved',approvedTemplateCount:1,
    floorNumber:3,balconyM2:0,terraceM2:15,gardenM2:12,variableSymbol:'417',settings:{...source().settings,signatureName:'Testovací zástupce'},
    accessories:[{code:'S1',type:'cellar',legalForm:'cellar_unit',amount:100,floorLabel:'1.PP',description:null},{code:'P1',type:'parking',legalForm:'outdoor_parking_use_right',amount:100,floorLabel:null,description:null},{code:'G1',type:'garage',legalForm:'garage_coownership',shareNumerator:1,shareDenominator:25,amount:100,floorLabel:'1.PP',description:null}]});
  const result=await new RsGenerationService({load:async()=>current} as never,{} as never).readiness({...context,contractId:current.contractId});
  assert.equal(result.ready,false);assert.ok(result.issues.some(i=>i.code==='contract_payment_terms'));
  for(const code of ['unsupported_terrace','unit_floor_number','outdoor_space_variant','accessory_variant','accessory_classification'])assert.ok(!result.issues.some(i=>i.code===code),code);
});

test('plánovaná data jsou vstupem konkrétní verze, nikoli důkazem podpisu nebo schválení šablony',async()=>{
  let current=source({contractType:'sbk',templateVariant:ORIGINAL_DOB_FULL_VARIANT,templateApprovalStatus:'draft',approvedTemplateCount:0});
  const service=new RsGenerationService({load:async()=>current} as never,{} as never);
  assert.ok((await service.readiness({...context,contractId:current.contractId})).issues.some(item=>item.code==='planned_signing_dates'));
  const signingPlan={versionId:'plan-version',sellerPlannedOn:'2026-11-02',buyerPlannedOn:'2026-11-03',editable:true};
  current=source({...current,signingPlan});const result=await service.readiness({...context,contractId:current.contractId});
  assert.deepEqual(result.summary?.signingPlan,signingPlan);assert.equal(result.ready,false);
  assert.ok(!result.issues.some(item=>item.code==='planned_signing_dates'));
  for(const code of ['approved_template','original_profile_review','signed_rs'])assert.ok(result.issues.some(item=>item.code===code));
});
test('dokument předchozí verze se po založení nové pracovní verze nevydává za aktuální',async()=>{
  const current=source({documentId:'old-document',documentVersionId:'old-document-version',contractVersionId:'old-contract-version',contractVersion:1,webUrl:'https://sharepoint.example.test/old',signingPlan:{versionId:'new-contract-version',sellerPlannedOn:null,buyerPlannedOn:null,editable:true}});
  const service=new RsGenerationService({load:async()=>current} as never,{} as never);
  assert.equal((await service.readiness({...context,contractId:current.contractId})).currentDocument,null);
  // The old document remains an internal upload/version target, not a current UI document.
  assert.equal(current.documentId,'old-document');
});
test('návrh a nejednoznačný výběr šablon nesmějí ukázat připravenost ani spustit generování',async()=>{
  for(const extra of [{templateApprovalStatus:'draft',approvedTemplateCount:0},{templateApprovalStatus:'approved',approvedTemplateCount:2}]){
    const current=source(extra);const service=new RsGenerationService({load:async()=>current} as never,{generate:async()=>assert.fail('nejednoznačná šablona')} as never);
    const result=await service.readiness({...context,contractId:current.contractId});assert.equal(result.ready,false);
    assert.ok(result.issues.some(i=>i.code===(extra.approvedTemplateCount===2?'ambiguous_template':'approved_template')));
    await assert.rejects(service.generate({...context,contractId:current.contractId,idempotencyKey:'template-guard-123'}),e=>e instanceof RsGenerationError&&e.code==='not_ready');
  }
});

for(const type of ['rs','sbk'] as const)test(`${type.toUpperCase()} bind ověřuje přesnou operaci a prepared statements bez mezer v parametrech`,async()=>{
  const calls:Array<{sql:string;values:unknown[]}>=[];
  const client={query:async(sql:string,values:unknown[]=[])=>{calls.push({sql,values});
    if(sql.includes('SELECT project_id,reference,current_status,contract_type'))return{rows:[{project_id:"20000000-0000-0000-0000-000000000002",reference:"TEST-417",contract_type:type}]};
    if(sql.includes('SELECT g.id,g.contract_preparation_version_id FROM document_generation_operations'))return{rows:[{id:'operation'}]};
    if(sql.includes('SELECT id,version_number,source_type,document_id'))return{rows:[{id:"30000000-0000-0000-0000-000000000001",version_number:3,source_type:"manual",document_id:null}]};
    if(sql.includes('UPDATE contract_versions SET source_type='))return{rows:[{id:"30000000-0000-0000-0000-000000000001",version_number:3}]};
    return{rows:[]};}};
  const database={withContext:async(_context:unknown,work:(input:typeof client)=>Promise<unknown>)=>work(client)};
  const repository=new RsGenerationRepository(database as never);
  await repository.bind({...context,contractId:source().contractId,operationId:"40000000-0000-0000-0000-000000000001",documentId:"40000000-0000-0000-0000-000000000002",documentVersionId:"40000000-0000-0000-0000-000000000003",templateVersionId:"40000000-0000-0000-0000-000000000004",snapshot:{"project.name":"Rezidence Dejvice"}});
  for(const call of calls){const indexes=[...call.sql.matchAll(/\$(\d+)/g)].map(match=>Number(match[1]));const max=Math.max(0,...indexes);assert.equal(max,call.values.length);for(let index=1;index<=max;index++)assert.ok(indexes.includes(index),`SQL chybí parametr $${index}`);}
  assert.ok(calls.some(call=>call.sql.includes('app.assert_contract_document')));
  assert.ok(calls.some(call=>call.values.includes(`contract.${type}_generated`)));
  assert.ok(calls.some(call=>call.values.includes('TEST-417_v03')));
});
test('staré RS URL nesmí generovat ani dokončit retry SBK',async()=>{
 const contractId=source().contractId;
 for(const completed of [false,true]){
  const service=new RsGenerationService({load:async()=>source({contractType:'sbk'}),completedGeneration:async()=>completed?{contractType:'sbk'}:null,bind:async()=>assert.fail('nesmí připojit SBK přes RS alias')} as never,{generate:async()=>assert.fail('nesmí generovat')} as never);
  await assert.rejects(service.generate({...context,contractId,idempotencyKey:'technical-legacy-alias',expectedContractType:'rs'}),error=>error instanceof RsGenerationError&&error.code==='contract_type_mismatch');
 }
});

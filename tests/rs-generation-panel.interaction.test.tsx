import assert from 'node:assert/strict';
import {before,afterEach,test,mock} from 'node:test';
import React from 'react';
import {JSDOM} from 'jsdom';
import {RsGenerationPanel,RsPreparationReturn} from '../app/components/rs-generation-panel';
import {commercialRepository,ContractGenerationNotReadyError,type RsReadiness} from '../app/repositories/commercial-repository';
import {entraAuth} from '../app/lib/entra-auth';
import {formatMoney} from '../app/crm-data';
import {ContractAppendicesPanel} from '../app/components/contract-appendices-panel';
import {parseCrmRoute} from '../app/crm-routing.mjs';
import {documentRepository,type DocumentRecord} from '../app/repositories/document-repository';
let render:typeof import('@testing-library/react').render,screen:typeof import('@testing-library/react').screen,cleanup:typeof import('@testing-library/react').cleanup,fireEvent:typeof import('@testing-library/react').fireEvent,waitFor:typeof import('@testing-library/react').waitFor;
before(async()=>{const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://develocrm.test',pretendToBeVisual:true});Object.assign(globalThis,{self:dom.window,window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,Node:dom.window.Node});Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});({render,screen,cleanup,fireEvent,waitFor}=await import('@testing-library/react'));});
afterEach(()=>{cleanup();mock.restoreAll();});
const contractId='10000000-0000-4000-8000-000000000001';
test('přílohy otevírají přímo dokumentovou záložku správného projektu i po reloadu',()=>{
  const projectId='648b5e62-9784-4de9-929d-c89b7ffc3c50';
  render(<ContractAppendicesPanel contractId={contractId} projectId={projectId} summary={{contractVersionId:null,editable:false,items:[]}} disabled={false} onSaved={async()=>{}}/>);
  const href=screen.getByRole('link',{name:'Otevřít dokumenty projektu'}).getAttribute('href');
  assert.equal(href,`/projects/${projectId}/documents`);
  const route=parseCrmRoute(href!);assert.equal(route.projectId,projectId);assert.equal(route.projectTab,'documents');
});
function ready():RsReadiness{return{ready:true,contractId,issues:[],summary:{project:{id:'p',label:'Testovací projekt'},unit:{id:'u',label:'TEST-101'},buyers:[{id:'b',label:'Jan Testovací'}],seller:'Testovací společnost',unitPrice:7_000_000,totalPrice:7_500_000,reservationFee:150_000,reservationFeeDueDays:5,reservationPeriodDays:30,accessories:['P1','S1'],template:{name:'Projektová RS',version:'v2',effectiveFrom:'2026-10-01'}}};}
test('přehled a konkrétní odkazy, chybějící údaj blokuje generování',async()=>{
  mock.method(commercialRepository,'getRsReadiness',async()=>({...ready(),ready:false,issues:[{code:'buyer_address',field:'buyer.address',message:'Kupující nemá adresu.',action:{href:'/clients/b',label:'Doplnit kupujícího'}}]}));
  render(<RsGenerationPanel contractId={contractId} canGenerate onChanged={()=>{}}/>);
  await screen.findByText('Kupující nemá adresu.');assert.ok(screen.getByText('Projektová RS · v2'));
  assert.equal(screen.getByRole('link',{name:'Doplnit kupujícího'}).getAttribute('href'),'/clients/b');
  assert.equal(screen.queryByRole('button',{name:'Vygenerovat RS'}),null);assert.ok(screen.getByText(/7\s500\s000/));
});
test('retry po síťové chybě zachová stejný klíč a nevytváří nový požadavek',async()=>{
  mock.method(commercialRepository,'getRsReadiness',async()=>ready());const keys:string[]=[];let changes=0;
  mock.method(commercialRepository,'generateContract',async(_id:string,key:string)=>{keys.push(key);if(keys.length===1)throw new Error('Dočasná chyba');return{operationId:'o',documentId:'d',documentVersionId:'dv',contractVersionId:'cv',contractVersion:1,replayed:true};});
  render(<RsGenerationPanel contractId={contractId} canGenerate onChanged={()=>{changes++;}}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Vygenerovat RS'}));await screen.findByText('Dočasná chyba');
  fireEvent.click(screen.getByRole('button',{name:'Ověřit předchozí generování'}));await waitFor(()=>assert.equal(changes,1));
  assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);
});

for(const contractType of ['rs','sbk'] as const)test(`${contractType}: ztracená odpověď po dokončeném renderu nenabízí falešnou novou verzi`,async()=>{
  let changes=0;const keys:string[]=[],operations=new Map<string,number>();const type=contractType.toUpperCase();
  mock.method(commercialRepository,'getRsReadiness',async()=>({...ready(),contractType,currentDocument:operations.size?{documentId:'document',documentVersionId:`exact-${operations.size}`,version:operations.size,webUrl:null}:null}));
  mock.method(commercialRepository,'generateContract',async(_id:string,key:string)=>{keys.push(key);const replayed=operations.has(key),version=operations.get(key)??operations.size+1;operations.set(key,version);if(keys.length===1)throw new Error('Odpověď se ztratila.');return{operationId:`op-${version}`,documentId:'document',documentVersionId:`exact-${version}`,contractVersionId:`cv-${version}`,contractVersion:version,replayed};});
  render(<RsGenerationPanel contractId={contractId} contractType={contractType} canGenerate onChanged={()=>{changes++;}}/>);
  fireEvent.click(await screen.findByRole('button',{name:`Vygenerovat ${type}`}));await screen.findByText('Odpověď se ztratila.');
  assert.equal(Boolean(screen.queryByRole('button',{name:`Vytvořit novou verzi ${type}`})),false);
  fireEvent.click(screen.getByRole('button',{name:'Ověřit předchozí generování'}));await waitFor(()=>assert.equal(changes,1));
  assert.equal(keys[0],keys[1]);assert.equal(operations.size,1);await screen.findByRole('button',{name:`Vytvořit novou verzi ${type}`});
  fireEvent.click(screen.getByRole('button',{name:`Vytvořit novou verzi ${type}`}));await screen.findByText('Dokument připraven · verze 2');
  assert.equal(changes,2);assert.equal(keys.length,3);assert.notEqual(keys[2],keys[1]);assert.equal(operations.size,2);
});

test('výslovně odmítnutá preflight validace dovolí po doplnění nový pokus',async()=>{
  let fixed=false;const keys:string[]=[];
  mock.method(commercialRepository,'getRsReadiness',async()=>fixed||!keys.length?ready():({...ready(),ready:false,issues:[{code:'buyer_address',field:'buyer.address',message:'Doplňte adresu.'}]}));
  mock.method(commercialRepository,'generateContract',async(_id:string,key:string)=>{keys.push(key);if(keys.length===1)throw new ContractGenerationNotReadyError('Doplňte adresu.');return{operationId:'o',documentId:'d',documentVersionId:'dv',contractVersionId:'cv',contractVersion:1,replayed:false};});
  render(<RsGenerationPanel contractId={contractId} canGenerate onChanged={()=>{}}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Vygenerovat RS'}));await screen.findByRole('alert');
  assert.equal(Boolean(screen.queryByRole('button',{name:'Ověřit předchozí generování'})),false);
  fixed=true;fireEvent.click(screen.getByRole('button',{name:'Znovu zkontrolovat'}));
  fireEvent.click(await screen.findByRole('button',{name:'Vygenerovat RS'}));await waitFor(()=>assert.equal(keys.length,2));assert.notEqual(keys[0],keys[1]);
});

test('recovery zůstává dostupné i když následné načtení připravenosti selže',async()=>{
  let failedRead=false;let generated=0;const keys:string[]=[];
  mock.method(commercialRepository,'getRsReadiness',async()=>{if(failedRead)throw new Error('Načtení se nezdařilo.');return ready();});
  mock.method(commercialRepository,'generateContract',async(_id:string,key:string)=>{keys.push(key);if(++generated===1){failedRead=true;throw new Error('Odpověď se ztratila.');}failedRead=false;return{operationId:'o',documentId:'d',documentVersionId:'dv',contractVersionId:'cv',contractVersion:1,replayed:true};});
  render(<RsGenerationPanel contractId={contractId} canGenerate onChanged={()=>{}}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Vygenerovat RS'}));await screen.findByText('Odpověď se ztratila.');
  fireEvent.click(screen.getByRole('button',{name:'Ověřit předchozí generování'}));await waitFor(()=>assert.equal(generated,2));assert.equal(keys[0],keys[1]);
});

for(const status of [409,422,503])test(`transport ${status} klasifikuje pouze prokazatelnou preflight validaci`,async()=>{
  mock.method(entraAuth,'getAccessToken',async()=> 'technical-token');
  const sent:string[]=[];mock.method(globalThis,'fetch',async(_input:RequestInfo|URL,init?:RequestInit)=>{sent.push(String(init?.body));return Response.json({error:'Smlouvu nelze vytvořit.',issues:[{code:'buyer_address',field:'buyer.address',message:'Doplňte adresu.'}]},{status});});
  await assert.rejects(commercialRepository.generateContract(contractId,'fixed-generation-key'),error=>status===422?error instanceof ContractGenerationNotReadyError:error instanceof Error&&!(error instanceof ContractGenerationNotReadyError));
  assert.deepEqual(JSON.parse(sent[0]),{idempotencyKey:'fixed-generation-key'});
});

test('server refusal refreshes readiness and removes stale generation CTA',async()=>{
  let checks=0,generations=0;
  mock.method(commercialRepository,'getRsReadiness',async()=>++checks===1?ready():({...ready(),ready:false,
    issues:[{code:'buyer_address',field:'buyer.address',message:'Kupující nemá adresu.',action:{href:'/clients/b',label:'Otevřít kupujícího'}}]}));
  mock.method(commercialRepository,'generateContract',async()=>{generations++;throw new Error('Doplňte povinné údaje.');});
  render(<RsGenerationPanel contractId={contractId} canGenerate onChanged={()=>assert.fail('no successful generation')}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Vygenerovat RS'}));
  await screen.findByText('Kupující nemá adresu.');
  assert.equal(screen.queryByRole('button',{name:'Vygenerovat RS'}),null);
  assert.equal(screen.getByRole('link',{name:'Otevřít kupujícího'}).getAttribute('href'),'/clients/b');
  assert.equal(generations,1);assert.equal(checks,2);assert.ok(screen.getByRole('alert').textContent?.includes('Doplňte povinné údaje.'));
});
test('návrat do tabu obnoví CRM data, konfigurace bez manage nenabízí generování',async()=>{
  let count=0;mock.method(commercialRepository,'getRsReadiness',async()=>{const result=ready();result.summary!.buyers[0].label=++count===1?'Původní kupující':'Opravený kupující';return result;});
  render(<RsGenerationPanel contractId={contractId} canGenerate={false} onChanged={()=>{}}/>);await screen.findByText('Původní kupující');
  fireEvent.focus(window);await screen.findByText('Opravený kupující');assert.equal(screen.queryByRole('button',{name:'Vygenerovat RS'}),null);
});
test('připravená SBK používá stejnou generovací operaci a správný vlastní název akce',async()=>{
 mock.method(commercialRepository,'getRsReadiness',async()=>({...ready(),contractType:'sbk' as const}));let sent:string|undefined;
 mock.method(commercialRepository,'generateContract',async(id:string)=>{sent=id;return{operationId:'o',documentId:'d',documentVersionId:'dv',contractVersionId:'cv',contractVersion:1,replayed:false};});
 render(<RsGenerationPanel contractId={contractId} contractType='sbk' canGenerate onChanged={()=>{}}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Vygenerovat SBK'}));await waitFor(()=>assert.equal(sent,contractId));
 assert.equal(screen.queryByRole('button',{name:'Vygenerovat RS'}),null);
});
test('SBK má společný přehled a konkrétní mezery bez nepravdivé splatnosti nebo nabídky RS',async()=>{
  mock.method(commercialRepository,'getRsReadiness',async()=>({...ready(),contractType:'sbk' as const,ready:false,
    summary:{...ready().summary!,template:{name:'SBK originál',version:'review-1',effectiveFrom:'2026-10-01',approvalStatus:'validated'}},
    issues:[{code:'buyer_delivery_address',field:'buyer.deliveryAddress',message:'Kupující nemá doručovací adresu.',action:{href:'/clients/b',label:'Otevřít kupujícího'}}]}));
  render(<RsGenerationPanel contractId={contractId} contractType='sbk' canGenerate onChanged={()=>{}}/>);
  await screen.findByText('Kupující nemá doručovací adresu.');
  assert.ok(screen.getByRole('heading',{name:'Příprava smlouvy o budoucí kupní smlouvě'}));
  assert.ok(screen.getByText('Šablona ke kontrole'));assert.ok(screen.getByText('SBK originál · review-1'));
  assert.equal(screen.queryByText('Rezervační doba'),null);assert.equal(screen.queryByText(/pracovních dnů od podpisu/),null);
  assert.equal(screen.queryByRole('button',{name:'Vygenerovat RS'}),null);assert.equal(screen.queryByRole('button',{name:'Vygenerovat SBK'}),null);
});
test('návrat k existující smlouvě neumožňuje externí URL ani jinou cestu',()=>{
  const view=render(<RsPreparationReturn search={`?returnTo=${encodeURIComponent(`/contracts/${contractId}`)}`}/>);assert.equal(screen.getByRole('link').getAttribute('href'),`/contracts/${contractId}`);
  view.rerender(<RsPreparationReturn search='?returnTo=https%3A%2F%2Fexample.test'/>);assert.equal(screen.queryByRole('link'),null);
});
test('SBK ukáže rozdíl proti přesné podepsané RS bez nabídky přepsání historie',async()=>{
 const value=ready();value.ready=false;value.summary!.precedingRsComparison={status:'compared',message:'Ověřte schválenou změnu.',contractId:'signed-rs',reference:'RS-TEST',contractVersion:2,documentVersionId:'exact',comparedFields:20,buyerChanged:true,
  differences:[{field:'contract.totalPriceAmount',label:'Kupní cena',previous:'5 000 000',current:'5 100 000'}]};
 mock.method(commercialRepository,'getRsReadiness',async()=>value);
 render(<RsGenerationPanel contractId={contractId} contractType='sbk' canGenerate onChanged={()=>{}}/>);
 await screen.findByRole('heading',{name:'Porovnání s podepsanou RS'});
 assert.ok(screen.getByRole('columnheader',{name:'Podepsaná RS'}));assert.ok(screen.getByRole('columnheader',{name:'Připravovaná SBK'}));
 assert.ok(screen.getByRole('cell',{name:'5 000 000'}));assert.ok(screen.getByRole('cell',{name:'5 100 000'}));
 assert.equal(screen.getByRole('link',{name:'Otevřít RS-TEST · verze 2'}).getAttribute('href'),'/contracts/signed-rs');
 assert.ok(screen.getByText(/jiný klientský záznam/));assert.equal(screen.queryByRole('button',{name:'Vygenerovat SBK'}),null);
 assert.equal(screen.queryByRole('button',{name:/Převzít|Přepsat/}),null);
});
test('externí RS jasně vyžaduje ruční porovnání, nikoli falešnou shodu',async()=>{
 const value=ready();value.summary!.precedingRsComparison={status:'unavailable',message:'Porovnejte podepsaný dokument ručně.',comparedFields:0,differences:[]};
 mock.method(commercialRepository,'getRsReadiness',async()=>value);
 render(<RsGenerationPanel contractId={contractId} contractType='sbk' canGenerate={false} onChanged={()=>{}}/>);
 await screen.findByText('Porovnejte podepsaný dokument ručně.');assert.equal(screen.queryByRole('table'),null);
 assert.equal(screen.queryByText(/Porovnáno/),null);
});
test('platební plán ukáže částky včetně haléřů, ale nevymýšlí datum splatnosti',async()=>{
  const value=ready();value.summary!.paymentPlan={versionId:'cv',variableSymbol:'417',rows:[
    {key:'sbk_first',amount:'1500000.03',anchor:'effective_signature',days:5,calendar:'czech_working_days'},
    {key:'sbk_final',amount:'5850000.07',anchor:'notice_delivery',days:30,calendar:'calendar_days'}]};
  mock.method(commercialRepository,'getRsReadiness',async()=>value);
  render(<RsGenerationPanel contractId={contractId} contractType="sbk" canGenerate={false} onChanged={()=>{}}/>);
  await screen.findByRole('heading',{name:'Platební plán'});
  const text=screen.getByLabelText('Platební plán smlouvy').textContent!.replace(/\s/g,' ');
  assert.match(text,/1 500 000,03 Kč/);assert.match(text,/5 pracovních dnů od posledního potřebného podpisu/);
  assert.match(text,/30 kalendářních dnů od doručení výzvy/);assert.doesNotMatch(text,/2026|1970/);
  assert.equal(formatMoney(1500000).replace(/\s/g,' '),'1 500 000 Kč');
});
test('příprava platebního plánu předá pouze aktuální verzi a znovu načte přehled',async()=>{
  let prepared=false;let changed=0;const value=ready();value.ready=false;
  value.summary!.paymentPlanPreparation={versionId:'current-version',canPrepare:true,hasExistingObligations:false};
  mock.method(commercialRepository,'getRsReadiness',async()=>{const next=structuredClone(value);if(prepared){next.summary!.paymentPlanPreparation!.canPrepare=false;next.summary!.paymentPlan={versionId:'current-version',variableSymbol:'417',rows:[{key:'rs_fee',amount:'150000',anchor:'effective_signature',days:3,calendar:'czech_working_days'}]};}return next;});
  const sent:unknown[]=[];mock.method(commercialRepository,'preparePaymentTerms',async(...args:unknown[])=>{sent.push(args);prepared=true;});
  render(<RsGenerationPanel contractId={contractId} canGenerate onChanged={()=>{changed++;}}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Připravit platební plán'}));
  await screen.findByRole('heading',{name:'Platební plán'});assert.deepEqual(sent,[[contractId,'current-version']]);assert.equal(changed,1);
  assert.equal(screen.queryByRole('button',{name:'Připravit platební plán'}),null);
});
test('stávající předpisy nenabízejí jejich tichou změnu a bez oprávnění není příprava dostupná',async()=>{
  const value=ready();value.summary!.paymentPlanPreparation={versionId:'cv',canPrepare:false,hasExistingObligations:true};
  mock.method(commercialRepository,'getRsReadiness',async()=>value);
  const view=render(<RsGenerationPanel contractId={contractId} canGenerate onChanged={()=>{}}/>);
  await screen.findByText(/Smlouva již má platební předpisy/);assert.equal(screen.queryByRole('button',{name:'Připravit platební plán'}),null);
  value.summary!.paymentPlanPreparation={versionId:'cv',canPrepare:true,hasExistingObligations:false};
  view.rerender(<RsGenerationPanel contractId="another" canGenerate={false} onChanged={()=>{}}/>);
  await waitFor(()=>assert.equal(screen.queryByText(/Smlouva již má platební předpisy/),null));
  assert.equal(screen.queryByRole('button',{name:'Připravit platební plán'}),null);
});

function appendixDocument():DocumentRecord{return{id:'doc-one',projectId:'project-one',projectName:'Test',name:'Katalogový list technické jednotky',
  category:'other',typeCode:'other',typeName:'Jiné',status:'ready',note:null,mimeType:'application/pdf',fileSize:100,
  storageProvider:'sharepoint',webUrl:'https://sharepoint.example.test/test.pdf',etag:'e1',sensitivity:'normal',createdAt:'',updatedAt:'',author:null,version:'v2',
  units:[],parties:[],contracts:[],salesCases:[],clientChanges:[],complaints:[],handovers:[],
  versions:[{id:'exact-v1',identifier:'v1',label:'v1',status:'ready',note:null,fileSize:100,createdAt:'',author:null},
    {id:'draft-v2',identifier:'v2',label:'v2',status:'draft',note:null,fileSize:100,createdAt:'',author:null}]};}
test('výběr přílohy předá konkrétní verzi a zachová původní concurrency token',async()=>{
  const doc=appendixDocument();mock.method(documentRepository,'listProject',async()=>({documents:[doc],connection:{status:'connected',syncStatus:'idle',lastSuccessfulSyncAt:null},source:'backend-api'}));
  mock.method(documentRepository,'get',async()=>doc);const sent:unknown[]=[];let saved=0;
  mock.method(commercialRepository,'setContractAppendix',async(...args:unknown[])=>{sent.push(args);});
  render(<ContractAppendicesPanel contractId={contractId} projectId='project-one' summary={{contractVersionId:'working-version',editable:true,
    items:[{number:1,label:'Katalogový list Bytu',documentId:'old-doc',documentVersionId:'old-exact',name:'Předchozí katalog',version:'v1',available:true}]}} disabled={false} onSaved={async()=>{saved++;}}/>);
  fireEvent.click(screen.getByRole('button',{name:'Vybrat přílohu 1'}));
  await screen.findByRole('option',{name:doc.name});
  fireEvent.change(screen.getByLabelText('Dokument'),{target:{value:doc.id}});
  await screen.findByRole('option',{name:'v1'});assert.equal(screen.queryByRole('option',{name:'v2'}),null);
  assert.equal((screen.getByRole('button',{name:'Uložit přílohu'}) as HTMLButtonElement).disabled,true);
  fireEvent.change(screen.getByLabelText('Verze dokumentu'),{target:{value:'exact-v1'}});
  fireEvent.click(screen.getByRole('button',{name:'Uložit přílohu'}));
  await waitFor(()=>assert.equal(saved,1));
  assert.deepEqual(sent,[[contractId,{versionId:'working-version',number:1,documentId:doc.id,documentVersionId:'exact-v1',expectedDocumentVersionId:'old-exact'}]]);
  assert.equal(screen.queryByRole('form',{name:'Výběr přílohy 1'}),null);
});
test('uzamčené přílohy nemají editaci; odmítnutý výběr zůstane viditelný pro opravu',async()=>{
  const doc=appendixDocument();const summary={contractVersionId:'working-version',editable:true,items:[{number:1,label:'Katalogový list Bytu',documentId:null,documentVersionId:null,name:null,version:null,available:false}]};
  mock.method(documentRepository,'listProject',async()=>({documents:[doc],connection:{status:'connected',syncStatus:'idle',lastSuccessfulSyncAt:null},source:'backend-api'}));
  mock.method(documentRepository,'get',async()=>doc);
  mock.method(commercialRepository,'setContractAppendix',async()=>{throw new Error('Příloha byla mezitím změněna.');});
  const view=render(<ContractAppendicesPanel contractId={contractId} projectId='project-one' summary={{...summary,editable:false}} disabled={false} onSaved={async()=>assert.fail('neuloženo')}/>);
  assert.equal(screen.queryByRole('button',{name:'Vybrat přílohu 1'}),null);
  view.rerender(<ContractAppendicesPanel contractId={contractId} projectId='project-one' summary={summary} disabled={false} onSaved={async()=>assert.fail('neuloženo')}/>);
  fireEvent.click(screen.getByRole('button',{name:'Vybrat přílohu 1'}));await screen.findByRole('option',{name:doc.name});
  fireEvent.change(screen.getByLabelText('Dokument'),{target:{value:doc.id}});await screen.findByRole('option',{name:'v1'});
  fireEvent.change(screen.getByLabelText('Verze dokumentu'),{target:{value:'exact-v1'}});fireEvent.click(screen.getByRole('button',{name:'Uložit přílohu'}));
  await screen.findByRole('alert');assert.ok(screen.getByText('Příloha byla mezitím změněna.'));assert.equal((screen.getByLabelText('Verze dokumentu') as HTMLSelectElement).value,'exact-v1');
});

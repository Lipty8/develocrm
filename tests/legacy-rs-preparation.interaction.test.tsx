import assert from 'node:assert/strict';
import {before,afterEach,test,mock} from 'node:test';
import React from 'react';
import {JSDOM} from 'jsdom';
import {LegacyRsPreparation} from '../app/components/legacy-rs-preparation';
import {commercialRepository,LegacyRsPreparationRejectedError,type LegacyRsPreparationPreview,type LegacyRsPreparationInput} from '../app/repositories/commercial-repository';
import {entraAuth} from '../app/lib/entra-auth';
import {GET,POST} from '../app/api/commercial/contracts/[contractId]/legacy-preparation/route';
let render:typeof import('@testing-library/react').render,screen:typeof import('@testing-library/react').screen,cleanup:typeof import('@testing-library/react').cleanup,fireEvent:typeof import('@testing-library/react').fireEvent,waitFor:typeof import('@testing-library/react').waitFor;
before(async()=>{const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://develocrm.test',pretendToBeVisual:true});Object.assign(globalThis,{self:dom.window,window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,Node:dom.window.Node});Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});({render,screen,cleanup,fireEvent,waitFor}=await import('@testing-library/react'));});
afterEach(()=>{cleanup();mock.restoreAll();});
const contractId='00000000-0000-4000-8000-000000000081';
function preview():LegacyRsPreparationPreview{return{contractId,projectId:'project',unitId:'unit',salesCaseId:'case',versionId:'00000000-0000-4000-8000-000000000001',previewToken:'a'.repeat(64),currentUnitPrice:'13770000.00',accessoryPrice:'1580000.00',currentTotalPrice:'15350000.00',accessories:[{assignmentId:'assignment',accessoryId:'accessory',code:'S-TECH',type:'cellar',amount:'1580000.00'}]};}
async function open(){fireEvent.click(screen.getByRole('button',{name:'Doplnit smluvní údaje'}));await screen.findByText('S-TECH · 1 580 000 Kč',{exact:false});}
function fill(){
 fireEvent.change(screen.getByLabelText(/Sjednaná cena jednotky/),{target:{value:'13 000 000,03'}});
 fireEvent.change(screen.getByLabelText(/Rezervační poplatek/),{target:{value:'100 000,01'}});
 fireEvent.change(screen.getByLabelText('Důvod přípravy'),{target:{value:'Potvrzené technické údaje'}});
 fireEvent.click(screen.getByLabelText('Potvrzuji sjednanou cenu a uvedené příslušenství.'));
}
test('explicit confirmation starts empty, uses exact Czech amounts and submits only authorized command fields',async()=>{
 let reads=0,saved=0;const commands:LegacyRsPreparationInput[]=[];
 mock.method(commercialRepository,'getLegacyRsPreparation',async()=>{reads++;return preview();});
 mock.method(commercialRepository,'prepareLegacyRs',async(id:string,input:LegacyRsPreparationInput)=>{assert.equal(id,contractId);commands.push(input);return{versionId:'new-version',replayed:false};});
 render(<LegacyRsPreparation contractId={contractId} unitLabel='TECH-81' disabled={false} onSaved={async()=>{saved++;}}/>);
 assert.equal(reads,0);await open();
 assert.equal((screen.getByLabelText(/Sjednaná cena jednotky/) as HTMLInputElement).value,'');
 assert.equal((screen.getByLabelText(/Rezervační poplatek/) as HTMLInputElement).value,'');
 fill();fireEvent.click(screen.getByRole('button',{name:'Potvrdit a vytvořit verzi'}));
 await waitFor(()=>assert.equal(saved,1));assert.equal(screen.queryByRole('dialog'),null);
 assert.equal(commands.length,1);assert.equal(commands[0].agreedUnitPrice,'13000000.03');assert.equal(commands[0].reservationFee,'100000.01');
 assert.equal(commands[0].previewToken,preview().previewToken);assert.equal(commands[0].expectedVersionId,preview().versionId);
 assert.deepEqual(Object.keys(commands[0]).sort(),['agreedUnitPrice','expectedVersionId','idempotencyKey','previewToken','reason','reservationFee'].sort());
});
test('copying current price is deliberate and editing money clears confirmation',async()=>{
 mock.method(commercialRepository,'getLegacyRsPreparation',async()=>preview());
 render(<LegacyRsPreparation contractId={contractId} unitLabel='TECH-81' disabled={false} onSaved={async()=>{}}/>);await open();
 fireEvent.click(screen.getByRole('button',{name:'Použít aktuální cenu jednotky'}));
 assert.equal((screen.getByLabelText(/Sjednaná cena jednotky/) as HTMLInputElement).value.replace(/\s/g,''),'13770000');
 assert.equal((screen.getByLabelText(/Rezervační poplatek/) as HTMLInputElement).value,'');
 assert.ok(screen.getByRole('checkbox').closest('label')?.classList.contains('form-confirmation'));
 fill();fireEvent.change(screen.getByLabelText(/Rezervační poplatek/),{target:{value:'101'}});
 assert.equal((screen.getByRole('checkbox') as HTMLInputElement).checked,false);
});
test('unknown save failure freezes inputs and retries the identical request even after closing',async()=>{
 mock.method(commercialRepository,'getLegacyRsPreparation',async()=>preview());const commands:LegacyRsPreparationInput[]=[];let saved=0;
 mock.method(commercialRepository,'prepareLegacyRs',async(_id:string,input:LegacyRsPreparationInput)=>{commands.push(input);if(commands.length===1)throw new Error('Odpověď se ztratila.');return{versionId:'new-version',replayed:true};});
 render(<LegacyRsPreparation contractId={contractId} unitLabel='TECH-81' disabled={false} onSaved={async()=>{saved++;}}/>);await open();fill();
 fireEvent.click(screen.getByRole('button',{name:'Potvrdit a vytvořit verzi'}));await screen.findByText('Odpověď se ztratila.');
 assert.equal((screen.getByLabelText(/Sjednaná cena jednotky/) as HTMLInputElement).disabled,true);
 fireEvent.click(screen.getByRole('button',{name:'Zrušit'}));fireEvent.click(screen.getByRole('button',{name:'Doplnit smluvní údaje'}));
 fireEvent.click(screen.getByRole('button',{name:'Ověřit předchozí uložení'}));await waitFor(()=>assert.equal(saved,1));
 assert.equal(commands.length,2);assert.deepEqual(commands[1],commands[0]);
});
test('stale preview requires a fresh read and a new explicit confirmation',async()=>{
 let reads=0;const commands:LegacyRsPreparationInput[]=[];
 mock.method(commercialRepository,'getLegacyRsPreparation',async()=>({...preview(),previewToken:(++reads===1?'a':'b').repeat(64)}));
 mock.method(commercialRepository,'prepareLegacyRs',async(_id:string,input:LegacyRsPreparationInput)=>{commands.push(input);if(commands.length===1)throw new LegacyRsPreparationRejectedError('Náhled se změnil.',409);return{versionId:'new-version',replayed:false};});
 render(<LegacyRsPreparation contractId={contractId} unitLabel='TECH-81' disabled={false} onSaved={async()=>{}}/>);await open();fill();
 fireEvent.click(screen.getByRole('button',{name:'Potvrdit a vytvořit verzi'}));await screen.findByText('Náhled se změnil.');
 fireEvent.click(screen.getByRole('button',{name:'Načíst aktuální náhled'}));await screen.findByText('S-TECH · 1 580 000 Kč',{exact:false});
 assert.equal((screen.getByRole('checkbox') as HTMLInputElement).checked,false);
 fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Potvrdit a vytvořit verzi'}));
 await waitFor(()=>assert.equal(commands.length,2));assert.equal(commands[1].previewToken,'b'.repeat(64));assert.notEqual(commands[1].idempotencyKey,commands[0].idempotencyKey);
});
test('failure refreshing after successful save never sends the mutation twice',async()=>{
 mock.method(commercialRepository,'getLegacyRsPreparation',async()=>preview());let writes=0,refreshes=0;
 mock.method(commercialRepository,'prepareLegacyRs',async()=>{writes++;return{versionId:'new-version',replayed:false};});
 render(<LegacyRsPreparation contractId={contractId} unitLabel='TECH-81' disabled={false} onSaved={async()=>{if(++refreshes===1)throw new Error('Přehled se neobnovil.');}}/>);await open();fill();
 fireEvent.click(screen.getByRole('button',{name:'Potvrdit a vytvořit verzi'}));await screen.findByText('Přehled se neobnovil.');
 fireEvent.click(screen.getByRole('button',{name:'Obnovit přehled'}));await waitFor(()=>assert.equal(refreshes,2));assert.equal(writes,1);
});
test('invalid negative, fractional and excessive money never silently changes or reaches the backend',async()=>{
 mock.method(commercialRepository,'getLegacyRsPreparation',async()=>preview());let writes=0;
 mock.method(commercialRepository,'prepareLegacyRs',async()=>{writes++;return{versionId:'no',replayed:false};});
 render(<LegacyRsPreparation contractId={contractId} unitLabel='TECH-81' disabled={false} onSaved={async()=>{}}/>);await open();fill();
 for(const value of ['-100','0.001','1e6','999999999999.99']){
  fireEvent.change(screen.getByLabelText(/Sjednaná cena jednotky/),{target:{value}});fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button',{name:'Potvrdit a vytvořit verzi'}));await screen.findByRole('alert');assert.equal(writes,0);
 }
});
test('actual repository transport preserves the command, targets one contract and does not bootstrap the workspace',async()=>{
 mock.method(entraAuth,'getAccessToken',async()=>null);const requests:Array<{url:string;body:unknown}>=[];let mutations=0;
 const listener=()=>{mutations++;};window.addEventListener('develocrm:data-mutated',listener);
 mock.method(globalThis,'fetch',async(url:unknown,init?:RequestInit)=>{
  requests.push({url:String(url),body:init?.body?JSON.parse(String(init.body)):null});
  return Response.json(init?.method==='POST'?{preparation:{versionId:'saved',replayed:false}}:{preview:preview()});
 });
 try{
  assert.deepEqual(await commercialRepository.getLegacyRsPreparation(contractId),preview());
  const input:LegacyRsPreparationInput={expectedVersionId:preview().versionId,previewToken:preview().previewToken,agreedUnitPrice:'13000000.03',reservationFee:'100000.01',idempotencyKey:'same-technical-request',reason:'Explicit technical command'};
  await commercialRepository.prepareLegacyRs(contractId,input);
  assert.deepEqual(requests.map(r=>r.url),Array(2).fill(`/api/commercial/contracts/${contractId}/legacy-preparation`));
  assert.deepEqual(requests[1].body,input);assert.equal(mutations,0);
 }finally{window.removeEventListener('develocrm:data-mutated',listener);}
});
test('unexpected server/transport failures are safe and do not masquerade as a proven rejection',async()=>{
 mock.method(entraAuth,'getAccessToken',async()=>null);
 const input:LegacyRsPreparationInput={expectedVersionId:preview().versionId,previewToken:preview().previewToken,agreedUnitPrice:'1',reservationFee:'1',idempotencyKey:'technical-error-request',reason:'Technical error only'};
 mock.method(globalThis,'fetch',async()=>Response.json({error:'SELECT SECRET FROM private_sql_table'},{status:500}));
 await assert.rejects(commercialRepository.prepareLegacyRs(contractId,input),e=>e instanceof Error&&!(e instanceof LegacyRsPreparationRejectedError)&&!e.message.includes('SELECT'));
 await assert.rejects(commercialRepository.getLegacyRsPreparation(contractId),e=>e instanceof Error&&!e.message.includes('SELECT'));
});
test('changing contract aborts the old preview and never fills another case with its result',async()=>{
 let resolveOld!:(value:LegacyRsPreparationPreview)=>void;let oldSignal:AbortSignal|undefined;
 const other='00000000-0000-4000-8000-000000000082';
 mock.method(commercialRepository,'getLegacyRsPreparation',async(id:string,signal?:AbortSignal)=>{
  if(id===contractId){oldSignal=signal;return new Promise<LegacyRsPreparationPreview>(resolve=>{resolveOld=resolve;});}
  return{...preview(),contractId:other,unitId:'other-unit',accessories:[{...preview().accessories[0],code:'OTHER-CASE'}]};
 });
 const view=render(<LegacyRsPreparation key={contractId} contractId={contractId} unitLabel='TECH-81' disabled={false} onSaved={async()=>{}}/>);
 fireEvent.click(screen.getByRole('button',{name:'Doplnit smluvní údaje'}));await screen.findByText('Načítám cenu a příslušenství…');
 view.rerender(<LegacyRsPreparation key={other} contractId={other} unitLabel='TECH-82' disabled={false} onSaved={async()=>{}}/>);
 assert.equal(oldSignal?.aborted,true);fireEvent.click(screen.getByRole('button',{name:'Doplnit smluvní údaje'}));
 await screen.findByText('OTHER-CASE · 1 580 000 Kč',{exact:false});resolveOld(preview());
 await waitFor(()=>assert.equal(screen.queryByText('S-TECH · 1 580 000 Kč',{exact:false}),null));
 assert.equal((screen.getByLabelText(/Sjednaná cena jednotky/) as HTMLInputElement).value,'');
});
test('BFF forwards only to configured backend, normalizes mutation auth and preserves correlation',async()=>{
 const previous={url:process.env.DEVELOCRM_API_URL,tenant:process.env.DEVELOCRM_TENANT_ID};
 process.env.DEVELOCRM_API_URL='https://api.example.test';process.env.DEVELOCRM_TENANT_ID='configured-tenant';
 const calls:Array<{url:string;headers:Headers;redirect:RequestRedirect|undefined}>=[];
 mock.method(globalThis,'fetch',async(url:unknown,init?:RequestInit)=>{calls.push({url:String(url),headers:new Headers(init?.headers),redirect:init?.redirect});return Response.json({ok:true},{headers:{'x-correlation-id':'backend-correlation'}});});
 try{
  const context={params:Promise.resolve({contractId})};
  const read=await GET(new Request('https://crm.example.test/api/legacy',{headers:{authorization:'Bearer technical-token','x-correlation-id':'read-correlation'}}),context);
  assert.equal(read.status,200);assert.equal(read.headers.get('cache-control'),'no-store');assert.equal(calls[0].redirect,'manual');
  assert.equal(calls[0].headers.get('x-tenant-id'),'configured-tenant');assert.equal(calls[0].headers.get('x-correlation-id'),'read-correlation');
  await POST(new Request('https://crm.example.test/api/legacy',{method:'POST',headers:{authorization:'DeveloCRM technical-token','content-type':'application/json'},body:JSON.stringify({technical:'request'})}),context);
  assert.equal(calls[1].headers.get('authorization'),'Bearer technical-token');
  assert.ok(calls.every(call=>call.url===`https://api.example.test/v1/contracts/${contractId}/legacy-preparation`));
 }finally{
  if(previous.url===undefined)delete process.env.DEVELOCRM_API_URL;else process.env.DEVELOCRM_API_URL=previous.url;
  if(previous.tenant===undefined)delete process.env.DEVELOCRM_TENANT_ID;else process.env.DEVELOCRM_TENANT_ID=previous.tenant;
 }
});

import assert from "node:assert/strict";
import {before,afterEach,test} from "node:test";
import React from "react";
import {JSDOM} from "jsdom";
import {ContractDocumentEvidence,ContractVersionDocumentAction,ExactContractDocumentDownload} from "../app/components/contract-document-evidence";
import {entraAuth} from '../app/lib/entra-auth';
let render:typeof import('@testing-library/react').render,screen:typeof import('@testing-library/react').screen,cleanup:typeof import('@testing-library/react').cleanup,fireEvent:typeof import('@testing-library/react').fireEvent,waitFor:typeof import('@testing-library/react').waitFor,act:typeof import('@testing-library/react').act;
let TestFile:typeof File;
before(async()=>{const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://develocrm.test'});Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,Node:dom.window.Node,FileReader:dom.window.FileReader});TestFile=dom.window.File;Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});({render,screen,cleanup,fireEvent,waitFor,act}=await import('@testing-library/react'));});
afterEach(()=>cleanup());
test('Word má jednoznačnou akci stažení přesné verze',()=>{render(<ContractDocumentEvidence contractId="c" version={{id:'v',number:1,status:'working',documentVersionId:'dv',documentReady:true,documentName:'RS.docx'}} canUpload={false} onChanged={()=>{}}/>);assert.ok(screen.getByRole('button',{name:'Stáhnout Word'}));});
test('čekání na ověření podpisového dokumentu není chyba a neumožní předčasné otevření',()=>{const view=render(<ContractDocumentEvidence contractId="c" version={{id:'v',number:1,status:'signed',documentVersionId:'dv',documentReady:false,evidenceState:'documented'}} verifying canUpload={false} onChanged={()=>{}}/>);assert.ok(screen.getByRole('status').textContent?.includes('Ověřuji dostupnost'));assert.equal(screen.queryByRole('alert'),null);assert.equal(screen.queryByRole('button',{name:'Otevřít přesný dokument ze SharePointu'}),null);view.rerender(<ContractDocumentEvidence contractId="c" version={{id:'v',number:1,status:'signed',documentVersionId:'dv',documentReady:true,evidenceState:'documented'}} canUpload={false} onChanged={()=>{}}/>);assert.ok(screen.getByRole('button',{name:'Otevřít přesný dokument ze SharePointu'}));assert.equal(screen.queryByRole('status'),null);});
test('historická výjimka není prezentována jako doložený podpis',()=>{render(<ContractDocumentEvidence contractId="c" version={{id:'v',number:1,status:'signed',evidenceState:'legacy_missing'}} canUpload={false} onChanged={()=>{}}/>);assert.ok(screen.getByText(/Historický podpis · čeká na doložení/));assert.equal(screen.queryByRole('button',{name:'Otevřít přesný dokument ze SharePointu'}),null);});
test('neznámý nedoložený podpis není automaticky označen za historickou výjimku',()=>{render(<ContractDocumentEvidence contractId="c" version={{id:'v',number:1,status:'signed',evidenceState:'invalid'}} canUpload={false} onChanged={()=>{}}/>);assert.ok(screen.getByRole('alert'));assert.equal(screen.queryByText(/Historický podpis · čeká na doložení/),null);});
test('bez dokumentu není dostupné otevření a nabízí se externí upload',()=>{render(<ContractDocumentEvidence contractId="c" version={{id:'v',number:1,status:'working'}} canUpload onChanged={()=>{}}/>);assert.ok(screen.getByText('Před evidencí podpisu připravte finální dokument.'));assert.equal(screen.queryByText('Otevřít přesný dokument ze SharePointu'),null);assert.equal((screen.getByText('Nahrát externí dokument') as HTMLButtonElement).disabled,true);});
test('ready dokument má čitelný název a přesnou akci otevření',()=>{render(<ContractDocumentEvidence contractId="c" version={{id:'v',number:2,status:'approved_for_signing',documentVersionId:'dv',documentReady:true,documentName:'final.pdf'}} canUpload onChanged={()=>{}}/>);assert.ok(screen.getByText('Dokument připraven'));assert.ok(screen.getByText(/Verze 2 · final.pdf/));assert.ok(screen.getByRole('button',{name:'Otevřít přesný dokument ze SharePointu'}));});
test('podepsaný dokument zobrazuje evidenci a nenabízí výměnu souboru',()=>{render(<ContractDocumentEvidence contractId="c" version={{id:'v',number:2,status:'signed',documentVersionId:'dv',documentReady:true,documentName:'signed.pdf',signatureRecordedAt:'2026-10-13T08:00:00Z'}} canUpload onChanged={()=>{}}/>);assert.ok(screen.getByText('Podepsaný dokument'));assert.ok(screen.getByText(/Evidováno/));assert.equal(screen.queryByText('Nahrát externí dokument'),null);});

test('odmítnutý nevyplněný Word ukáže bezpečnou hlášku a zachová výběr i retry klíč',async t=>{
  t.mock.method(entraAuth,'getAccessToken',async()=>null);
  const keys:string[]=[];const message='Dokument obsahuje nevyplněná pole. Doplňte je a nahrajte finální verzi.';
  t.mock.method(globalThis,'fetch',async(_url:unknown,init?:RequestInit)=>{keys.push(JSON.parse(String(init?.body)).idempotencyKey);return Response.json({error:message,correlationId:'test-only'},{status:409});});
  render(<ContractDocumentEvidence contractId="c" version={{id:'v',number:1,status:'working'}} canUpload onChanged={()=>assert.fail('upload did not succeed')}/>);
  const file=new TestFile(['technical test'], 'final.docx',{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
  fireEvent.change(screen.getByLabelText('Externí dokument (DOCX nebo PDF, do 4 MB)'),{target:{files:[file]}});
  fireEvent.click(screen.getByRole('button',{name:'Nahrát externí dokument'}));await screen.findByText(message);
  assert.equal((screen.getByRole('button',{name:'Nahrát externí dokument'}) as HTMLButtonElement).disabled,false);
  fireEvent.click(screen.getByRole('button',{name:'Nahrát externí dokument'}));
  await screen.findByText(message);assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);
});

test('historie stáhne vybranou starší verzi, nikoli poslední dokument smlouvy',async t=>{
  t.mock.method(entraAuth,'getAccessToken',async()=>null);
  const requests:string[]=[],files:string[]=[],revoked:string[]=[];
  t.mock.method(globalThis,'fetch',async(url:unknown)=>{requests.push(String(url));return new Response('exact-version-bytes');});
  t.mock.method(URL,'createObjectURL',()=>`blob:test-${requests.length}`);
  t.mock.method(URL,'revokeObjectURL',(url:string)=>{revoked.push(url);});
  t.mock.method(window.HTMLAnchorElement.prototype,'click',function(this:HTMLAnchorElement){files.push(this.download);});
  const view=render(<><ContractVersionDocumentAction contractId="contract-a" version={{id:'older-id',number:1,status:'superseded',documentVersionId:'dv1',documentReady:true,documentName:'RS-v1.docx'}}/>
    <ContractVersionDocumentAction contractId="contract-a" version={{id:'latest-id',number:2,status:'signed',documentVersionId:'dv2',documentReady:true,documentName:'RS-v2.docx'}}/></>);
  fireEvent.click(screen.getByRole('button',{name:'Stáhnout dokument v1'}));
  await waitFor(()=>assert.deepEqual(files,['RS-v1.docx']));
  assert.deepEqual(requests,['/api/commercial/contracts/contract-a/versions/older-id/document']);
  fireEvent.click(screen.getByRole('button',{name:'Stáhnout dokument v2'}));
  await waitFor(()=>assert.deepEqual(files,['RS-v1.docx','RS-v2.docx']));
  assert.equal(requests[1],'/api/commercial/contracts/contract-a/versions/latest-id/document');
  view.unmount();assert.equal(revoked.length,2);
});

test('nedoložené a neověřitelné historické verze nenabízejí odkaz na poslední soubor',()=>{
  render(<><ContractVersionDocumentAction contractId="c" version={{id:'v1',number:1,status:'signed',evidenceState:'legacy_missing'}}/>
    <ContractVersionDocumentAction contractId="c" version={{id:'v2',number:2,status:'working'}}/>
    <ContractVersionDocumentAction contractId="c" version={{id:'v3',number:3,status:'superseded',documentVersionId:'dv3',documentReady:false}}/></>);
  assert.ok(screen.getByText('Podepsaný dokument dosud není doložen.'));
  assert.ok(screen.getByText('Bez dokumentu.'));assert.ok(screen.getByText('Dokument není dostupný.'));
  assert.equal(screen.queryAllByRole('button').length,0);
});

test('odmítnutí přesné verze zůstane bezpečnou chybou bez fallbacku a dovolí retry',async t=>{
  t.mock.method(entraAuth,'getAccessToken',async()=>null);let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({error:'PRIVATE_STORAGE_KEY SQL TRACE'},{status:409});});
  render(<ContractVersionDocumentAction contractId="c" version={{id:'old',number:1,status:'superseded',documentVersionId:'dv',documentReady:true}}/>);
  fireEvent.click(screen.getByRole('button',{name:'Stáhnout dokument v1'}));
  assert.equal((await screen.findByRole('alert')).textContent,'Přesný dokument se nepodařilo ověřit a stáhnout.');
  assert.equal(calls,1);assert.equal(screen.queryByText(/PRIVATE_STORAGE_KEY/),null);
  assert.equal((screen.getByRole('button',{name:'Stáhnout dokument v1'}) as HTMLButtonElement).disabled,false);
  fireEvent.click(screen.getByRole('button',{name:'Stáhnout dokument v1'}));await waitFor(()=>assert.equal(calls,2));
});

test('přepnutí obchodního kontextu zruší request a pozdní odpověď nestáhne cizí dokument',async t=>{
  t.mock.method(entraAuth,'getAccessToken',async()=>null);
  const pending:Array<{resolve:(r:Response)=>void;signal:AbortSignal}>=[],files:string[]=[];
  t.mock.method(globalThis,'fetch',async(_url:unknown,init?:RequestInit)=>new Promise<Response>(resolve=>pending.push({resolve,signal:init!.signal as AbortSignal})));
  t.mock.method(URL,'createObjectURL',()=>`blob:context-test`);t.mock.method(URL,'revokeObjectURL',()=>{});
  t.mock.method(window.HTMLAnchorElement.prototype,'click',function(this:HTMLAnchorElement){files.push(this.download);});
  const view=render(<ExactContractDocumentDownload contractId="a" version={{id:'v1',number:1,status:'signed',documentName:'old.docx'}}/>);
  fireEvent.click(screen.getByRole('button',{name:'Stáhnout Word'}));await waitFor(()=>assert.equal(pending.length,1));
  assert.equal((screen.getByRole('button',{name:'Stáhnout Word'}) as HTMLButtonElement).disabled,true);
  view.rerender(<ExactContractDocumentDownload contractId="b" version={{id:'v2',number:2,status:'signed',documentName:'new.docx'}}/>);
  assert.equal(pending[0].signal.aborted,true);
  fireEvent.click(screen.getByRole('button',{name:'Stáhnout Word'}));await waitFor(()=>assert.equal(pending.length,2));
  await act(async()=>pending[0].resolve(new Response('old-bytes')));assert.deepEqual(files,[]);
  await act(async()=>pending[1].resolve(new Response('new-bytes')));await waitFor(()=>assert.deepEqual(files,['new.docx']));
  view.unmount();
});

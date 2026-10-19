import assert from 'node:assert/strict';
import {before,afterEach,test,mock} from 'node:test';
import React from 'react';
import {JSDOM} from 'jsdom';
import {ContractFinalNotice} from '../app/components/contract-final-notice';
import {entraAuth} from '../app/lib/entra-auth';
import type {SbkFinalNoticeContext} from '../backend/src/shared/sbk-final-notice';
let render:typeof import('@testing-library/react').render,screen:typeof import('@testing-library/react').screen,cleanup:typeof import('@testing-library/react').cleanup,fireEvent:typeof import('@testing-library/react').fireEvent,waitFor:typeof import('@testing-library/react').waitFor;
let dom:JSDOM;
before(async()=>{dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://develocrm.test'});Object.assign(globalThis,{self:dom.window,window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,Node:dom.window.Node,FileReader:dom.window.FileReader,CustomEvent:dom.window.CustomEvent});Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});({render,screen,cleanup,fireEvent,waitFor}=await import('@testing-library/react'));});
afterEach(()=>{cleanup();mock.restoreAll();});
const base:SbkFinalNoticeContext={versionId:'exact-version',amount:'5750000.07',signedOn:'2026-04-10',canRecord:true,notice:null};
test('evidenced delivery submits the exact version, date and file; retry retains one key',async()=>{
  mock.method(entraAuth,'getAccessToken',async()=>null);const requests:Array<Record<string,string>>=[];let fail=true;let changes=0;
  mock.method(globalThis,'fetch',async(_url:unknown,init?:RequestInit)=>{
    if(init?.method==='POST'){requests.push(JSON.parse(String(init.body)));if(fail)return Response.json({error:'Dočasná chyba.'},{status:409});
      return Response.json({context:{...base,canRecord:false,notice:{deliveredOn:requests.at(-1)!.deliveredOn,dueOn:'2026-05-13',documentId:'doc',documentName:'Doklad',webUrl:'https://sharepoint.example.test/proof'}}});}
    return Response.json({context:base});
  });
  render(<ContractFinalNotice contractId="contract" canManage onChanged={()=>{changes++;}}/>);
  await screen.findByRole('button',{name:'Evidovat doručení výzvy'});
  fireEvent.change(screen.getByLabelText('Datum skutečného doručení'),{target:{value:'2026-04-13'}});
  fireEvent.change(screen.getByLabelText('Doklad o doručení (PDF nebo DOCX, do 4 MB)'),{target:{files:[new dom.window.File(['%PDF-1.4\nTechnical proof'],'proof.pdf',{type:'application/pdf'})]}});
  fireEvent.click(screen.getByRole('button',{name:'Evidovat doručení výzvy'}));await screen.findByText('Dočasná chyba.');fail=false;
  fireEvent.click(screen.getByRole('button',{name:'Evidovat doručení výzvy'}));await screen.findByRole('link',{name:'Otevřít doklad o doručení'});
  await waitFor(()=>assert.equal(changes,1));assert.equal(requests.length,2);assert.equal(requests[0].idempotencyKey,requests[1].idempotencyKey);
  assert.equal(requests[1].versionId,'exact-version');assert.equal(requests[1].deliveredOn,'2026-04-13');assert.ok(requests[1].contentBase64);
  for(const forbidden of ['tenantId','projectId','driveId','siteId','amount','dueAt'])assert.equal(requests[1][forbidden],undefined);
  assert.equal(screen.queryByRole('button',{name:'Evidovat doručení výzvy'}),null);assert.ok(screen.getByText('13. 5. 2026'));
});
test('without edit permission and for zero balance there is no financial action or invented due date',async()=>{
  mock.method(entraAuth,'getAccessToken',async()=>null);mock.method(globalThis,'fetch',async()=>Response.json({context:{...base,canRecord:false,amount:'0'}}));
  render(<ContractFinalNotice contractId="contract" canManage={false} onChanged={()=>{}}/>);
  await screen.findByText('Bez doplatku');assert.equal(screen.queryByRole('button',{name:'Evidovat doručení výzvy'}),null);
});
test('legacy contract has no new panel and a real read failure remains visible',async()=>{
  mock.method(entraAuth,'getAccessToken',async()=>null);let failure=false;
  mock.method(globalThis,'fetch',async()=>failure?Response.json({error:'Nemáte přístup.'},{status:403}):Response.json({context:null}));
  const view=render(<ContractFinalNotice contractId="legacy" canManage onChanged={()=>{}}/>);
  await waitFor(()=>assert.equal(screen.queryByRole('status'),null));assert.equal(screen.queryByLabelText('Doručení výzvy k doplatku'),null);
  view.unmount();failure=true;render(<ContractFinalNotice contractId="forbidden" canManage onChanged={()=>{}}/>);await screen.findByRole('alert');
});

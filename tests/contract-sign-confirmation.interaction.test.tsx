import assert from 'node:assert/strict';
import {afterEach,before,mock,test} from 'node:test';
import React from 'react';
import {JSDOM} from 'jsdom';
import {ContractSignedModal} from '../app/CRMApp';
import {contracts} from '../app/crm-data';
import {localDateKey} from '../app/lib/date-time';

let render:typeof import('@testing-library/react').render,screen:typeof import('@testing-library/react').screen,cleanup:typeof import('@testing-library/react').cleanup,fireEvent:typeof import('@testing-library/react').fireEvent,waitFor:typeof import('@testing-library/react').waitFor;
before(async()=>{
  const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://develocrm.test'});
  Object.assign(globalThis,{self:dom.window,window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,Node:dom.window.Node});
  Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
  ({render,screen,cleanup,fireEvent,waitFor}=await import('@testing-library/react'));
});
afterEach(()=>{cleanup();mock.restoreAll();});
const version={id:'version-1',number:1,name:'TECH66 v01',status:'approved_for_signing',basedOnVersionId:null,source:'manual',createdAt:'2026-01-01T12:00:00Z',signedAt:null,documentVersionId:'document-1',documentName:'TECH-NONBINDING.pdf'};
const contract={...contracts[0],id:'technical-contract',reference:'TECH66-SIGN',versions:[version]};
const confirm=()=>screen.getByRole('checkbox',{name:/Potvrzuji, že smlouva/});
const submit=()=>fireEvent.click(screen.getByRole('button',{name:/^Evidovat podpis$/}));

test('signature requires explicit visible confirmation and never opens native confirm',async()=>{
  mock.method(window,'confirm',()=>{throw new Error('Native confirm must not run');});let calls=0;
  render(<ContractSignedModal contract={contract} close={()=>{}} save={async()=>{calls++;}}/>);
  assert.ok(screen.getByText(version.documentName));assert.ok(screen.getByText(/již provedený podpis/));
  submit();await screen.findByText('Potvrďte, že zobrazená verze smlouvy byla skutečně podepsána.');assert.equal(calls,0);
  fireEvent.click(confirm());submit();await waitFor(()=>assert.equal(calls,1));
});

test('past signature date is sent as that day, not the recording date',async()=>{
  let saved:Parameters<React.ComponentProps<typeof ContractSignedModal>['save']>[0]|undefined;
  render(<ContractSignedModal contract={contract} close={()=>{}} save={async value=>{saved=value;}}/>);
  fireEvent.change(screen.getByLabelText('Datum podpisu'),{target:{value:'2020-01-16'}});
  fireEvent.change(screen.getByLabelText('Poznámka (volitelné)'),{target:{value:'  Technický test  '}});
  fireEvent.click(confirm());submit();await waitFor(()=>assert.ok(saved));
  assert.equal(localDateKey(new Date(saved!.signedAt)),'2020-01-16');assert.equal(saved!.note,'Technický test');
});

test('changing date invalidates the previous confirmation',async()=>{
  let calls=0;render(<ContractSignedModal contract={contract} close={()=>{}} save={async()=>{calls++;}}/>);
  fireEvent.click(confirm());fireEvent.change(screen.getByLabelText('Datum podpisu'),{target:{value:'2020-01-16'}});
  assert.equal((confirm() as HTMLInputElement).checked,false);submit();
  await screen.findByText('Potvrďte, že zobrazená verze smlouvy byla skutečně podepsána.');assert.equal(calls,0);
});

test('a different contract or exact document version cannot reuse confirmation',()=>{
  const otherVersion={...version,documentVersionId:'document-2'};
  const view=render(<ContractSignedModal contract={contract} close={()=>{}} save={async()=>{}}/>);
  fireEvent.click(confirm());
  view.rerender(<ContractSignedModal contract={{...contract,versions:[otherVersion]}} close={()=>{}} save={async()=>{}}/>);
  assert.equal((confirm() as HTMLInputElement).checked,false);
  fireEvent.click(confirm());
  view.rerender(<ContractSignedModal contract={{...contract,id:'other-contract',versions:[otherVersion]}} close={()=>{}} save={async()=>{}}/>);
  assert.equal((confirm() as HTMLInputElement).checked,false);
});

test('missing version and future date remain blocked before the request',async()=>{
  let calls=0;const save=async()=>{calls++;};
  const view=render(<ContractSignedModal contract={{...contract,versions:[]}} close={()=>{}} save={save}/>);
  fireEvent.click(confirm());submit();await screen.findByText('Smlouvu nelze podepsat, protože nemá platnou aktuální verzi.');assert.equal(calls,0);
  view.unmount();render(<ContractSignedModal contract={contract} close={()=>{}} save={save}/>);
  fireEvent.change(screen.getByLabelText('Datum podpisu'),{target:{value:'2099-01-01'}});fireEvent.click(confirm());submit();
  await screen.findByText('Datum podpisu nesmí být v budoucnosti');assert.equal(calls,0);
});

test('server rejection stays visible and preserves date and note for a safe retry',async()=>{
  render(<ContractSignedModal contract={contract} close={()=>{}} save={async()=>{throw new Error('Dokument není připravený.');}}/>);
  fireEvent.change(screen.getByLabelText('Datum podpisu'),{target:{value:'2020-01-16'}});
  fireEvent.change(screen.getByLabelText('Poznámka (volitelné)'),{target:{value:'Technický test'}});
  fireEvent.click(confirm());submit();await screen.findByText('Dokument není připravený.');
  assert.equal((screen.getByLabelText('Datum podpisu') as HTMLInputElement).value,'2020-01-16');
  assert.equal((screen.getByLabelText('Poznámka (volitelné)') as HTMLInputElement).value,'Technický test');
});

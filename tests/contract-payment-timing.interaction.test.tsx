import assert from 'node:assert/strict';
import {before,afterEach,test,mock} from 'node:test';
import React from 'react';
import {JSDOM} from 'jsdom';
import {NewContractModal} from '../app/CRMApp';
import {commercialRepository,type UnitNextContractAction} from '../app/repositories/commercial-repository';
import {getSalesProcessState} from '../backend/src/shared/next-contract-action';
import type {UnitRecord} from '../app/crm-data';
let render:typeof import('@testing-library/react').render,screen:typeof import('@testing-library/react').screen,cleanup:typeof import('@testing-library/react').cleanup,fireEvent:typeof import('@testing-library/react').fireEvent,waitFor:typeof import('@testing-library/react').waitFor;
before(async()=>{const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://develocrm.test'});Object.assign(globalThis,{self:dom.window,window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,Node:dom.window.Node});Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});({render,screen,cleanup,fireEvent,waitFor}=await import('@testing-library/react'));});
afterEach(()=>{cleanup();mock.restoreAll();});
const unit:UnitRecord={backendId:'10000000-0000-4000-8000-000000000001',id:'TEST66',project:'TECH',building:'A',layout:'1+kk',area:30,floor:'1. NP',orientation:'J',price:10000000,status:'Rezervovaná',construction:'Dokončeno',handover:'—',accessory:'—'};
function action(type:'rs'|'sbk',timing:'signature'|'fixed_date'):UnitNextContractAction{
  const salesProcess=getSalesProcessState({hasActiveSalesCase:true,contracts:type==='sbk'?[{id:'rs',type:'rs',status:'signed'}]:[]});
  return{...salesProcess.nextContractAction,unitId:unit.backendId!,unitCode:unit.id,salesCaseId:'case',buyerNames:['Testovací kupující'],salesProcess,paymentTimings:{rs:timing,sbk:timing}};
}
test('SBK from the original template asks neither an invented installment nor a creation-relative due date',async()=>{
  const a=action('sbk','signature');mock.method(commercialRepository,'getNextContractAction',async()=>a);let saved:unknown;
  render(<NewContractModal units={[unit]} context={{unit,action:a}} close={()=>{}} save={async value=>{saved=value;}}/>);
  await screen.findByText(/První splátka činí 20 %/);
  assert.equal(screen.queryByText('Způsob výpočtu'),null);assert.equal(screen.queryByText('Splatnost'),null);
  fireEvent.click(screen.getByRole('button',{name:'Vytvořit smlouvu'}));await waitFor(()=>assert.ok(saved));
  const body=saved as Record<string,unknown>;assert.equal(body.unitId,unit.backendId);assert.equal(body.type,'sbk');assert.equal(body.paymentTiming,'signature');
  for(const key of ['paymentCalculationType','paymentInputValue','paymentDueAt'])assert.equal(body[key],undefined);
});
test('RS retains the fee input, removes the arbitrary date and sends no due date',async()=>{
  const a=action('rs','signature');mock.method(commercialRepository,'getNextContractAction',async()=>a);let saved:unknown;
  render(<NewContractModal units={[unit]} context={{unit,action:a}} close={()=>{}} save={async value=>{saved=value;}}/>);
  await screen.findByText(/Rezervační poplatek bude splatný/);assert.ok(screen.getByText('Způsob výpočtu'));assert.equal(screen.queryByText('Splatnost'),null);
  fireEvent.click(screen.getByRole('button',{name:'Připravit RS'}));await waitFor(()=>assert.ok(saved));
  assert.equal((saved as Record<string,unknown>).paymentInputValue,2);assert.equal((saved as Record<string,unknown>).paymentDueAt,undefined);
});
test('legacy fixed-date project keeps its existing form and a failed discovery blocks saving',async()=>{
  const a=action('rs','fixed_date');let failing=false;mock.method(commercialRepository,'getNextContractAction',async()=>{if(failing)throw new Error('Podmínky nejsou dostupné.');return a;});let saves=0;
  const view=render(<NewContractModal units={[unit]} context={{unit,action:a}} close={()=>{}} save={async()=>{saves++;}}/>);
  await screen.findByText('Splatnost');assert.ok(screen.getByText('Způsob výpočtu'));
  view.unmount();failing=true;
  render(<NewContractModal units={[unit]} context={{unit,action:a}} close={()=>{}} save={async()=>{saves++;}}/>);
  await screen.findByRole('alert');fireEvent.click(screen.getByRole('button',{name:'Připravit RS'}));await screen.findAllByText('Podmínky nejsou dostupné.');assert.equal(saves,0);
});
test('late response for another unit never changes the current form or its due-date rule',async()=>{
  const other={...unit,backendId:'10000000-0000-4000-8000-000000000002',id:'OTHER66'};
  const old=action('rs','fixed_date'),current={...action('rs','signature'),unitId:other.backendId,unitCode:other.id};
  let resolve!:(value:UnitNextContractAction)=>void;
  mock.method(commercialRepository,'getNextContractAction',async(id:string)=>id===unit.backendId?new Promise<UnitNextContractAction>(done=>{resolve=done;}):current);
  const view=render(<NewContractModal units={[unit,other]} context={{unit,action:old}} close={()=>{}} save={async()=>{}}/>);
  await screen.findByRole('status');
  view.rerender(<NewContractModal units={[unit,other]} context={{unit:other,action:current}} close={()=>{}} save={async()=>{}}/>);
  await screen.findByText(/Rezervační poplatek bude splatný/);resolve(old);
  await new Promise(done=>setTimeout(done,0));assert.equal(screen.queryByText('Splatnost'),null);
  assert.ok(screen.getByText('OTHER66'));
});
test('ambiguous RS template never falls back to an arbitrary fixed-date form',async()=>{
  const a=action('rs','signature');a.paymentTimings!.rs=null;
  mock.method(commercialRepository,'getNextContractAction',async()=>a);let saved=false;
  render(<NewContractModal units={[unit]} context={{unit,action:a}} close={()=>{}} save={async()=>{saved=true;}}/>);
  await screen.findByRole('alert');assert.equal(screen.queryByText('Splatnost'),null);
  fireEvent.click(screen.getByRole('button',{name:'Připravit RS'}));await screen.findAllByText('Pro tento typ smlouvy není jednoznačně vybraná projektová šablona.');assert.equal(saved,false);
});

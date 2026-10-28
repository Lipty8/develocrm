import assert from 'node:assert/strict';
import {before,afterEach,test} from 'node:test';
import React from 'react';
import {JSDOM} from 'jsdom';
import {NewClientChangeModal} from '../app/CRMApp';
import {units,projects,clients,unitCommercialContexts,type ClientRecord} from '../app/crm-data';
import {clientChangeCandidates} from '../app/lib/business-context';
let render:typeof import('@testing-library/react').render,screen:typeof import('@testing-library/react').screen,cleanup:typeof import('@testing-library/react').cleanup;
before(async()=>{const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://develocrm.test'});Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement});Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});({render,screen,cleanup}=await import('@testing-library/react'));});
afterEach(()=>cleanup());
test('active client-change candidates follow current buyer order, never historical links',()=>{
 const unit={...units[0],backendId:'unit-current'};
 const a={...clients[0],id:'old',unitRelations:[{unitId:'unit-current',code:'417',projectId:'project',project:'Test'}]} as ClientRecord;
 const b={...a,id:'buyer'},c={...a,id:'co-buyer'},representative={...a,id:'agent'};
 const context={salesCaseId:'current-case',buyers:[{partyId:'buyer',name:'Buyer',email:'',role:'buyer',share:null},{partyId:'co-buyer',name:'Co-buyer',email:'',role:'co_buyer',share:null},{partyId:'agent',name:'Agent',email:'',role:'representative',share:null}],interests:[],stage:'rs',hold:null};
 assert.deepEqual(clientChangeCandidates(unit,context,[a,c,representative,b]).map(row=>row.id),['buyer','co-buyer']);
 assert.deepEqual(clientChangeCandidates(unit,{...context,buyers:[]},[a,b]),[]);
 assert.deepEqual(clientChangeCandidates(unit,{...context,salesCaseId:null,clientChangesRequireNewSale:true},[a,b]),[]);
 assert.deepEqual(clientChangeCandidates(undefined,context,[a,b]),[]);
 assert.deepEqual(clientChangeCandidates({...unit,backendId:'other'},undefined,[a]),[]);
 // Existing no-active-case path remains unchanged pending its separate audit.
 assert.deepEqual(clientChangeCandidates(unit,undefined,[a]).map(row=>row.id),['old']);
});
test('new client-change modal selects current buyer B even if historical A is first',()=>{
 const unit=units[0],project=projects.find(row=>row.backendId===unit.projectBackendId||row.name===unit.project)!;
 const originalClients=[...clients],originalContext=unitCommercialContexts[unit.backendId??unit.id];
 const a={...clients[0],id:'historical-a',name:'Historický kupující A',unitRelations:[{unitId:unit.backendId!,code:unit.id,projectId:project.backendId!,project:project.name}]} as ClientRecord;
 const b={...a,id:'current-b',name:'Aktuální kupující B'};
 try{
  clients.splice(0,clients.length,a,b);
  unitCommercialContexts[unit.backendId??unit.id]={salesCaseId:'current-case',buyers:[{partyId:b.id,name:b.name,email:'',role:'buyer',share:null}],interests:[],stage:'pre_reservation',hold:null};
  const view=render(<NewClientChangeModal project={project} fixedUnit={unit} memberships={[]} close={()=>undefined} save={async()=>undefined}/>);
  const select=screen.getByRole('combobox',{name:'Klient'}) as HTMLSelectElement;
  assert.equal(select.value,b.id);
  assert.equal(screen.queryByRole('option',{name:a.name}),null);
  unitCommercialContexts[unit.backendId??unit.id]={salesCaseId:null,buyers:[],interests:[],stage:null,hold:null,clientChangesRequireNewSale:true};
  view.rerender(<NewClientChangeModal project={project} fixedUnit={unit} memberships={[]} close={()=>undefined} save={async()=>undefined}/>);
  assert.equal((screen.getByRole('combobox',{name:'Klient'}) as HTMLSelectElement).value,'');
  assert.equal(screen.queryByRole('option',{name:b.name}),null);
  assert.ok(screen.getByText(/Původní obchod je ukončen/));
 }finally{clients.splice(0,clients.length,...originalClients);if(originalContext)unitCommercialContexts[unit.backendId??unit.id]=originalContext;else delete unitCommercialContexts[unit.backendId??unit.id];}
});

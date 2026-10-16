import assert from 'node:assert/strict';
import {before,afterEach,test,mock} from 'node:test';
import React from 'react';
import {JSDOM} from 'jsdom';
import {RsGenerationPanel,RsPreparationReturn} from '../app/components/rs-generation-panel';
import {commercialRepository,type RsReadiness} from '../app/repositories/commercial-repository';
let render:typeof import('@testing-library/react').render,screen:typeof import('@testing-library/react').screen,cleanup:typeof import('@testing-library/react').cleanup,fireEvent:typeof import('@testing-library/react').fireEvent,waitFor:typeof import('@testing-library/react').waitFor;
before(async()=>{const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://develocrm.test',pretendToBeVisual:true});Object.assign(globalThis,{self:dom.window,window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,Node:dom.window.Node});Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});({render,screen,cleanup,fireEvent,waitFor}=await import('@testing-library/react'));});
afterEach(()=>{cleanup();mock.restoreAll();});
const contractId='10000000-0000-4000-8000-000000000001';
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
  mock.method(commercialRepository,'generateRs',async(_id:string,key:string)=>{keys.push(key);if(keys.length===1)throw new Error('Dočasná chyba');return{operationId:'o',documentId:'d',documentVersionId:'dv',contractVersionId:'cv',contractVersion:1,replayed:true};});
  render(<RsGenerationPanel contractId={contractId} canGenerate onChanged={()=>{changes++;}}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Vygenerovat RS'}));await screen.findByText('Dočasná chyba');
  fireEvent.click(screen.getByRole('button',{name:'Vygenerovat RS'}));await waitFor(()=>assert.equal(changes,1));
  assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);
});
test('návrat do tabu obnoví CRM data, konfigurace bez manage nenabízí generování',async()=>{
  let count=0;mock.method(commercialRepository,'getRsReadiness',async()=>{const result=ready();result.summary!.buyers[0].label=++count===1?'Původní kupující':'Opravený kupující';return result;});
  render(<RsGenerationPanel contractId={contractId} canGenerate={false} onChanged={()=>{}}/>);await screen.findByText('Původní kupující');
  fireEvent.focus(window);await screen.findByText('Opravený kupující');assert.equal(screen.queryByRole('button',{name:'Vygenerovat RS'}),null);
});
test('návrat k existující smlouvě neumožňuje externí URL ani jinou cestu',()=>{
  const view=render(<RsPreparationReturn search={`?returnTo=${encodeURIComponent(`/contracts/${contractId}`)}`}/>);assert.equal(screen.getByRole('link').getAttribute('href'),`/contracts/${contractId}`);
  view.rerender(<RsPreparationReturn search='?returnTo=https%3A%2F%2Fexample.test'/>);assert.equal(screen.queryByRole('link'),null);
});

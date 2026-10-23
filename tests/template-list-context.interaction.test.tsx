import assert from 'node:assert/strict';
import {before,afterEach,test} from 'node:test';
import React,{useState} from 'react';
import {JSDOM} from 'jsdom';
import {TemplateAdminList} from '../app/CRMApp';
import {templateRepository,type DocumentTemplate} from '../app/repositories/template-repository';
import {templateListContext} from '../app/lib/template-list-context';
import {updateSearch} from '../app/crm-routing.mjs';
import {ReadError} from '../app/lib/read-state';

let render:typeof import('@testing-library/react').render,screen:typeof import('@testing-library/react').screen,
  cleanup:typeof import('@testing-library/react').cleanup,fireEvent:typeof import('@testing-library/react').fireEvent,
  act:typeof import('@testing-library/react').act,waitFor:typeof import('@testing-library/react').waitFor;
const originalList=templateRepository.list,originalAction=templateRepository.action;
const projects=[{id:'project-a',name:'Projekt A'},{id:'project-b',name:'Projekt B'}];
const notify=()=>{};
before(async()=>{
  const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://develocrm.test/contracts'});
  Object.assign(globalThis,{self:dom.window,window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,Node:dom.window.Node});
  Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
  ({render,screen,cleanup,fireEvent,act,waitFor}=await import('@testing-library/react'));
});
afterEach(()=>{cleanup();templateRepository.list=originalList;templateRepository.action=originalAction;});
function template(id:string,projectId:string):DocumentTemplate{return{id,projectId,projectName:projectId,code:id,name:id,
  outputTypeCode:'future_purchase_contract',contractType:'sbk',variantKey:'dejvice-original-dob-delivery-v2',status:'active',canManage:true,canApprove:true,
  generationSupported:true,versions:[{id:'version',versionLabel:'v1',contentHash:'sha256:test',status:'draft',effectiveFrom:'2026-10-23',
    validation:{valid:true,tokens:[],unknownTokens:[],missingTokens:[],malformedTokens:[],legacyMarkers:[],errors:[]},createdAt:'2026-10-23T10:00:00Z',
    validatedAt:null,approvedAt:null,retiredAt:null,actor:null,sourceWebUrl:null,sourceFileName:'technical.docx'}]};}
function Harness({search}:{search:string}){
  const [query,setQuery]=useState(search);const{projectId,typeCode}=templateListContext(new URLSearchParams(query));
  return <><output aria-label="Aktuální odkaz">{query}</output><TemplateAdminList key={JSON.stringify([projectId,typeCode])}
    projectId={projectId} typeCode={typeCode} availableProjects={projects} notify={notify}
    onFilter={patch=>setQuery(updateSearch('/contracts',query,patch).split('?')[1]??'')}/></>;
}
function Scoped({projectId}:{projectId:string}){return <TemplateAdminList key={projectId} projectId={projectId} typeCode=""
  availableProjects={projects} notify={notify} onFilter={()=>{}}/>;}

test('odkaz z přípravy smlouvy načte jen konkrétní projekt a zachová filtr i návratový odkaz',async()=>{
  const calls:Array<{projectId?:string;outputTypeCode?:string}>=[];
  templateRepository.list=async filters=>{calls.push(filters??{});return[template('SBK A',filters?.projectId??'')];};
  const query='view=templates&project=project-a&returnTo=%2Fcontracts%2Fcontract-a';
  const view=render(<Harness search={query}/>);await screen.findByRole('heading',{name:'SBK A'});
  assert.equal((screen.getByRole('combobox',{name:'Projekt'}) as HTMLSelectElement).value,'project-a');
  assert.equal(calls[0].projectId,'project-a');
  fireEvent.change(screen.getByRole('combobox',{name:'Typ'}),{target:{value:'future_purchase_contract'}});
  await waitFor(()=>assert.equal(calls.at(-1)?.outputTypeCode,'future_purchase_contract'));
  const persisted=screen.getByLabelText('Aktuální odkaz').textContent!;const params=new URLSearchParams(persisted);
  assert.equal(params.get('project'),'project-a');assert.equal(params.get('returnTo'),'/contracts/contract-a');assert.equal(params.get('view'),'templates');
  view.unmount();render(<Harness search={persisted}/>);await screen.findByRole('heading',{name:'SBK A'});
  assert.equal((screen.getByRole('combobox',{name:'Typ'}) as HTMLSelectElement).value,'future_purchase_contract');
  fireEvent.change(screen.getByRole('combobox',{name:'Projekt'}),{target:{value:''}});
  await waitFor(()=>assert.equal(calls.at(-1)?.projectId,undefined));
  assert.equal(new URLSearchParams(screen.getByLabelText('Aktuální odkaz').textContent!).get('returnTo'),'/contracts/contract-a');
});

test('rychlé přepnutí projektu abortuje starou odpověď a nepředvyplní cizí šablonu',async()=>{
  const finish:Record<string,(rows:DocumentTemplate[])=>void>={},signals:Record<string,AbortSignal>={};
  templateRepository.list=(filters,signal)=>new Promise(resolve=>{finish[filters!.projectId!]=resolve;signals[filters!.projectId!]=signal!;});
  const view=render(<Scoped projectId="project-a"/>);assert.equal((screen.getByRole('button',{name:'Nahrát novou verzi'}) as HTMLButtonElement).disabled,true);
  view.rerender(<Scoped projectId="project-b"/>);assert.equal(signals['project-a'].aborted,true);
  await act(async()=>finish['project-a']([template('Pozdní A','project-a')]));assert.equal(screen.queryByText('Pozdní A'),null);
  await act(async()=>finish['project-b']([template('Aktuální B','project-b')]));
  assert.ok(screen.getByRole('heading',{name:'Aktuální B'}));assert.equal(screen.queryByText('Pozdní A'),null);
  assert.equal((screen.getByRole('button',{name:'Nahrát novou verzi'}) as HTMLButtonElement).disabled,false);
});

test('nedostatečné oprávnění se nezamění za prázdný seznam a retry neodstraní projektový kontext',async()=>{
  let count=0;templateRepository.list=async filters=>{assert.equal(filters?.projectId,'project-a');if(++count===1)throw new ReadError(403);return[];};
  render(<Scoped projectId="project-a"/>);await screen.findByText('Nedostatečné oprávnění');
  assert.equal(screen.queryByText('Zatím bez šablon'),null);assert.equal((screen.getByRole('button',{name:'Nahrát novou verzi'}) as HTMLButtonElement).disabled,true);
  fireEvent.click(screen.getByRole('button',{name:'Zkusit znovu'}));await screen.findByText('Zatím bez šablon');assert.equal(count,2);
});

test('neznámý projekt se tiše nezmění na všechny projekty ani nenabídne upload do prvního projektu',async()=>{
  let requested:string|undefined;templateRepository.list=async filters=>{requested=filters?.projectId;return[];};
  render(<Scoped projectId="foreign-or-unavailable"/>);await screen.findByText('Zatím bez šablon');
  assert.equal(requested,'foreign-or-unavailable');assert.equal((screen.getByRole('combobox',{name:'Projekt'}) as HTMLSelectElement).value,'foreign-or-unavailable');
  assert.ok(screen.getByRole('option',{name:'Projekt není dostupný'}));assert.equal((screen.getByRole('button',{name:'Nahrát novou verzi'}) as HTMLButtonElement).disabled,true);
});

test('dokončení staré lifecycle akce po přepnutí nevrátí staré řádky ani modal',async()=>{
  let finishAction:()=>void=()=>assert.fail('action not started');
  templateRepository.list=async filters=>[template(filters?.projectId==='project-a'?'Verze A':'Verze B',filters!.projectId!)];
  templateRepository.action=()=>new Promise(resolve=>{finishAction=()=>resolve({});});
  const view=render(<Scoped projectId="project-a"/>);await screen.findByRole('heading',{name:'Verze A'});
  fireEvent.click(screen.getByRole('button',{name:'Znovu validovat'}));view.rerender(<Scoped projectId="project-b"/>);
  await screen.findByRole('heading',{name:'Verze B'});await act(async()=>finishAction());
  assert.ok(screen.getByRole('heading',{name:'Verze B'}));assert.equal(screen.queryByText('Verze A'),null);
});

test('změna projektového kontextu zavře neuložený upload místo přenosu do jiného projektu',async()=>{
  templateRepository.list=async filters=>[template('Vybraná šablona',filters!.projectId!)];
  const view=render(<Scoped projectId="project-a"/>);await screen.findByRole('heading',{name:'Vybraná šablona'});
  fireEvent.click(screen.getByRole('button',{name:'Nahrát novou verzi'}));assert.ok(screen.getByRole('heading',{name:'Nahrát novou verzi šablony'}));
  view.rerender(<Scoped projectId="project-b"/>);assert.equal(screen.queryByRole('heading',{name:'Nahrát novou verzi šablony'}),null);
  await screen.findByRole('heading',{name:'Vybraná šablona'});
});

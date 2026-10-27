import assert from 'node:assert/strict';
import {before,afterEach,test,mock} from 'node:test';
import React from 'react';
import {JSDOM} from 'jsdom';
import {AppRouterContext,type AppRouterInstance} from 'next/dist/shared/lib/app-router-context.shared-runtime.js';
import {UnitDocuments,ClientDocuments,WorkflowDocuments} from '../app/CRMApp';
import {units,clients} from '../app/crm-data';
import {documentRepository,type DocumentRecord,type DocumentListResponse} from '../app/repositories/document-repository';
import {ReadError} from '../app/lib/read-state';
let render:typeof import('@testing-library/react').render,screen:typeof import('@testing-library/react').screen,cleanup:typeof import('@testing-library/react').cleanup,fireEvent:typeof import('@testing-library/react').fireEvent,waitFor:typeof import('@testing-library/react').waitFor,act:typeof import('@testing-library/react').act;
before(async()=>{const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://develocrm.test',pretendToBeVisual:true});Object.assign(globalThis,{self:dom.window,window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,Node:dom.window.Node});Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});({render,screen,cleanup,fireEvent,waitFor,act}=await import('@testing-library/react'));});
afterEach(()=>{cleanup();mock.restoreAll();});
const unitA={...units[0],id:'TECH-A',backendId:'10000000-0000-4000-8000-000000000001'},unitB={...units[0],id:'TECH-B',backendId:'10000000-0000-4000-8000-000000000002'};
function result(name:string):DocumentListResponse{const doc:DocumentRecord={id:name,projectId:'project-test',projectName:'Test',name,category:'contract',typeCode:'reservation_contract',typeName:'RS',status:'ready',note:null,mimeType:'application/pdf',fileSize:100,storageProvider:'sharepoint',webUrl:null,etag:null,sensitivity:'normal',createdAt:'',updatedAt:'',author:null,version:'v1',units:[],parties:[],contracts:[],salesCases:[],clientChanges:[],complaints:[],handovers:[]};return{documents:[doc],connection:{status:'connected',syncStatus:'idle',lastSuccessfulSyncAt:null},source:'backend-api'};}
function deferred<T>(){let resolve!:(value:T)=>void;let reject!:(error:unknown)=>void;const promise=new Promise<T>((done,fail)=>{resolve=done;reject=fail;});return{promise,resolve,reject};}
test('workflow documents: switching target hides the prior rows and selected project document immediately',async()=>{
 const pending=deferred<DocumentListResponse>();
 mock.method(documentRepository,'listHandover',async(id:string)=>id==='handover-a'?result('LINKED-A'):pending.promise);
 mock.method(documentRepository,'listProject',async(id:string)=>result(id==='project-a'?'AVAILABLE-A':'AVAILABLE-B'));
 const view=render(<WorkflowDocuments projectId="project-a" target={{type:'handover',id:'handover-a'}}/>);
 await screen.findByText('LINKED-A');fireEvent.change(screen.getByRole('combobox'),{target:{value:'AVAILABLE-A'}});
 view.rerender(<WorkflowDocuments projectId="project-b" target={{type:'handover',id:'handover-b'}}/>);
 assert.equal(Boolean(screen.queryByText('LINKED-A')),false);
 assert.equal(Boolean(screen.queryByRole('option',{name:'AVAILABLE-A'})),false);
 assert.equal(Boolean(screen.queryByRole('button',{name:'Připojit'})),false);
 await act(async()=>pending.resolve({...result('IGNORED'),documents:[]}));
 await screen.findByRole('option',{name:'AVAILABLE-B'});
 assert.equal(screen.getByRole('combobox').getAttribute('value')??(screen.getByRole('combobox') as HTMLSelectElement).value,'');
});
for(const [type,method] of [['client_change','listClientChange'],['complaint','listComplaint'],['handover','listHandover']] as const)
test(`workflow documents: ${type} permission failure is explicit and retryable, never an empty list`,async()=>{
 let requests=0;
 mock.method(documentRepository,method,async()=>{if(++requests===1)throw new ReadError(403);return result('RECOVERED-WORKFLOW');});
 mock.method(documentRepository,'listProject',async()=>result('PROJECT-OPTION'));
 render(<WorkflowDocuments projectId="project-a" target={{type,id:'target-a'}}/>);
 assert.match((await screen.findByRole('alert')).textContent??'',/Nedostatečné oprávnění/);
 assert.equal(Boolean(screen.queryByText('Žádné dokumenty v tomto rozsahu')),false);
 assert.equal(Boolean(screen.queryByRole('combobox')),false);
 fireEvent.click(screen.getByRole('button',{name:'Zkusit znovu'}));await screen.findByText('RECOVERED-WORKFLOW');assert.equal(requests,2);
});
test('workflow documents: late aborted response cannot overwrite another target',async()=>{
 const pending=deferred<DocumentListResponse>();let oldSignal:AbortSignal|undefined;
 mock.method(documentRepository,'listComplaint',async(id:string,signal?:AbortSignal)=>{if(id==='old'){oldSignal=signal;return pending.promise;}return result('CURRENT-COMPLAINT');});
 mock.method(documentRepository,'listProject',async()=>result('AVAILABLE'));
 const view=render(<WorkflowDocuments projectId="project" target={{type:'complaint',id:'old'}}/>);
 view.rerender(<WorkflowDocuments projectId="project" target={{type:'complaint',id:'current'}}/>);
 await screen.findByText('CURRENT-COMPLAINT');assert.equal(oldSignal?.aborted,true);
 await act(async()=>pending.resolve(result('LATE-COMPLAINT')));
 assert.equal(Boolean(screen.queryByText('LATE-COMPLAINT')),false);assert.ok(screen.getByText('CURRENT-COMPLAINT'));
});
test('workflow documents: linking is single-flight and refreshes the original target',async()=>{
 const pending=deferred<void>();let linked=false;const calls:unknown[]=[];
 mock.method(documentRepository,'listClientChange',async()=>({...result('NEW-LINK'),documents:linked?result('NEW-LINK').documents:[]}));
 mock.method(documentRepository,'listProject',async()=>result('NEW-LINK'));
 mock.method(documentRepository,'link',async(id:string,target:unknown)=>{calls.push([id,target]);await pending.promise;linked=true;});
 render(<WorkflowDocuments projectId="project" target={{type:'client_change',id:'change'}}/>);
 fireEvent.change(await screen.findByRole('combobox'),{target:{value:'NEW-LINK'}});
 const button=screen.getByRole('button',{name:'Připojit'});fireEvent.click(button);fireEvent.click(button);
 assert.equal(calls.length,1);assert.equal((screen.getByRole('button',{name:'Připojuji…'}) as HTMLButtonElement).disabled,true);
 await act(async()=>pending.resolve());await screen.findByText('NEW-LINK');
 assert.deepEqual(calls,[['NEW-LINK',{type:'client_change',targetId:'change'}]]);
 assert.equal(Boolean(screen.queryByRole('combobox')),false);
});
test('workflow documents: late mutation error cannot affect a newly opened project',async()=>{
 const pending=deferred<void>();const calls:unknown[]=[];
 mock.method(documentRepository,'listHandover',async()=>({...result('EMPTY'),documents:[]}));
 mock.method(documentRepository,'listProject',async(id:string)=>result(id==='old-project'?'OLD-OPTION':'NEW-OPTION'));
 mock.method(documentRepository,'link',async(id:string,target:unknown)=>{calls.push([id,target]);return pending.promise;});
 const view=render(<WorkflowDocuments projectId="old-project" target={{type:'handover',id:'old-target'}}/>);
 fireEvent.change(await screen.findByRole('combobox'),{target:{value:'OLD-OPTION'}});
 fireEvent.click(screen.getByRole('button',{name:'Připojit'}));
 view.rerender(<WorkflowDocuments projectId="new-project" target={{type:'handover',id:'new-target'}}/>);
 await screen.findByRole('option',{name:'NEW-OPTION'});
 await act(async()=>pending.reject(new Error('PRIVATE_SQL_DETAIL')));
 assert.equal(Boolean(screen.queryByRole('alert')),false);assert.equal((screen.getByRole('combobox') as HTMLSelectElement).value,'');
 assert.deepEqual(calls,[['OLD-OPTION',{type:'handover',targetId:'old-target'}]]);
});
test('workflow documents: link failure hides internal detail and preserves retry',async()=>{
 let attempts=0;
 mock.method(documentRepository,'listHandover',async()=>({...result('EMPTY'),documents:[]}));
 mock.method(documentRepository,'listProject',async()=>result('OPTION'));
 mock.method(documentRepository,'link',async()=>{if(++attempts===1)throw new Error('PRIVATE_STORAGE_DETAIL');});
 render(<WorkflowDocuments projectId="project" target={{type:'handover',id:'handover'}}/>);
 fireEvent.change(await screen.findByRole('combobox'),{target:{value:'OPTION'}});
 fireEvent.click(screen.getByRole('button',{name:'Připojit'}));
 assert.match((await screen.findByRole('alert')).textContent??'',/Dokument se nepodařilo připojit/);
 assert.equal(Boolean(screen.queryByText(/PRIVATE_STORAGE_DETAIL/)),false);
 fireEvent.click(screen.getByRole('button',{name:'Připojit'}));await waitFor(()=>assert.equal(attempts,2));
});
test('documents: forbidden unit read is not an empty result or disconnected SharePoint',async()=>{
 mock.method(documentRepository,'listUnit',async()=>{throw new ReadError(403);});
 render(<UnitDocuments unit={unitA}/>);
 assert.match((await screen.findByRole('alert')).textContent??'',/Nedostatečné oprávnění/);
 assert.equal(screen.queryByText('Žádné dokumenty v tomto rozsahu'),null);
 assert.equal(screen.queryByText('SharePoint zatím není připojen'),null);
});
test('documents: failed read hides technical errors and can be retried',async()=>{
 let requests=0;mock.method(documentRepository,'listUnit',async()=>{if(++requests===1)throw new Error('PRIVATE_SQL_DETAIL');return result('RECOVERED-DOCUMENT');});
 render(<UnitDocuments unit={unitA}/>);await screen.findByRole('alert');
 assert.equal(screen.queryByText(/PRIVATE_SQL_DETAIL/),null);
 fireEvent.click(screen.getByRole('button',{name:'Zkusit znovu'}));
 await screen.findByText('RECOVERED-DOCUMENT');assert.equal(screen.queryByRole('alert'),null);assert.equal(requests,2);
});
test('documents: changing unit hides the previous rows while loading',async()=>{
 const pending=deferred<DocumentListResponse>();
 mock.method(documentRepository,'listUnit',async(id:string)=>id===unitA.backendId?result('ONLY-A'):pending.promise);
 const view=render(<UnitDocuments unit={unitA}/>);await screen.findByText('ONLY-A');
 view.rerender(<UnitDocuments unit={unitB}/>);
 assert.equal(screen.queryByText('ONLY-A'),null);assert.ok(screen.getByRole('status'));
 await act(async()=>pending.resolve(result('ONLY-B')));await screen.findByText('ONLY-B');
});
test('documents: an aborted late unit response cannot replace the current unit',async()=>{
 const pending=deferred<DocumentListResponse>();let oldSignal:AbortSignal|undefined;
 mock.method(documentRepository,'listUnit',async(id:string,_filters:unknown,signal?:AbortSignal)=>{if(id===unitA.backendId){oldSignal=signal;return pending.promise;}return result('CURRENT-B');});
 const view=render(<UnitDocuments unit={unitA}/>);view.rerender(<UnitDocuments unit={unitB}/>);await screen.findByText('CURRENT-B');
 assert.equal(oldSignal?.aborted,true);await act(async()=>pending.resolve(result('LATE-A')));
 assert.equal(screen.queryByText('LATE-A'),null);assert.ok(screen.getByText('CURRENT-B'));
});
test('documents: category filter keeps unit context and loading hides previous rows',async()=>{
 const pending=deferred<DocumentListResponse>();const calls:unknown[]=[];
 mock.method(documentRepository,'listUnit',async(id:string,filters:unknown)=>{calls.push([id,filters]);return calls.length===1?result('UNFILTERED'):pending.promise;});
 render(<UnitDocuments unit={unitA}/>);await screen.findByText('UNFILTERED');
 fireEvent.change(screen.getByLabelText('Kategorie'),{target:{value:'contract'}});
 assert.equal(screen.queryByText('UNFILTERED'),null);
 await act(async()=>pending.resolve({...result('IGNORED'),documents:[]}));
 await screen.findByText('Žádné dokumenty v tomto rozsahu');
 assert.deepEqual(calls,[[unitA.backendId,{category:undefined}],[unitA.backendId,{category:'contract'}]]);
});
const router:AppRouterInstance={back(){},forward(){},refresh(){},push(){},replace(){},prefetch(){},bfcacheId:'document-test'};
test('documents: client permission failure can retry and open the exact CRM document',async()=>{
 let requests=0;const navigation:string[]=[];
 mock.method(router,'push',(href:string)=>{navigation.push(href);});
 mock.method(documentRepository,'listParty',async()=>{if(++requests===1)throw new ReadError(403);return result('CLIENT-EXACT-DOCUMENT');});
 render(<AppRouterContext.Provider value={router}><ClientDocuments client={{...clients[0],id:'client-test',name:'Test'}}/></AppRouterContext.Provider>);
 assert.match((await screen.findByRole('alert')).textContent??'',/Nedostatečné oprávnění/);
 assert.equal(screen.queryByText('Žádné dokumenty v tomto rozsahu'),null);
 fireEvent.click(screen.getByRole('button',{name:'Zkusit znovu'}));await screen.findByText('CLIENT-EXACT-DOCUMENT');
 fireEvent.click(screen.getByRole('button',{name:'Detail CLIENT-EXACT-DOCUMENT'}));
 await waitFor(()=>assert.deepEqual(navigation,['/contracts/documents/CLIENT-EXACT-DOCUMENT']));assert.equal(requests,2);
});
test('documents: client change cannot retain a prior client document',async()=>{
 const pending=deferred<DocumentListResponse>();const a={...clients[0],id:'client-a',name:'Test A'},b={...clients[0],id:'client-b',name:'Test B'};
 mock.method(documentRepository,'listParty',async(id:string)=>id==='client-a'?result('CLIENT-A-DOCUMENT'):pending.promise);
 const view=render(<AppRouterContext.Provider value={router}><ClientDocuments client={a}/></AppRouterContext.Provider>);await screen.findByText('CLIENT-A-DOCUMENT');
 view.rerender(<AppRouterContext.Provider value={router}><ClientDocuments client={b}/></AppRouterContext.Provider>);
 assert.equal(screen.queryByText('CLIENT-A-DOCUMENT'),null);assert.ok(screen.getByRole('status'));
 await act(async()=>pending.resolve({...result('IGNORED'),documents:[]}));await screen.findByText('Žádné dokumenty v tomto rozsahu');
});

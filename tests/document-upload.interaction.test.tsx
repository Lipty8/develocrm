import assert from 'node:assert/strict';
import {before,afterEach,test,mock} from 'node:test';
import React from 'react';
import {JSDOM} from 'jsdom';
import {DocumentUploadModal} from '../app/components/document-upload-modal';
import {documentUploadProjects,validateDocumentFile} from '../app/lib/document-upload';
import {documentRepository,type DocumentRecord,type DocumentFileUploadInput} from '../app/repositories/document-repository';
import {entraAuth} from '../app/lib/entra-auth';
import {POST} from '../app/api/documents/sharepoint-upload/route';
let dom:JSDOM;
let render:typeof import('@testing-library/react').render,screen:typeof import('@testing-library/react').screen,cleanup:typeof import('@testing-library/react').cleanup,fireEvent:typeof import('@testing-library/react').fireEvent,waitFor:typeof import('@testing-library/react').waitFor;
const projectA='11111111-1111-4111-8111-111111111111',projectB='22222222-2222-4222-8222-222222222222',unitA='33333333-3333-4333-8333-333333333333',partyA='44444444-4444-4444-8444-444444444444',docId='55555555-5555-4555-8555-555555555555',versionId='66666666-6666-4666-8666-666666666666';
const projects=[{id:projectA,name:'Projekt A'},{id:projectB,name:'Projekt B'}];
before(async()=>{dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://develocrm.test'});Object.assign(globalThis,{self:dom.window,window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,Node:dom.window.Node,FileReader:dom.window.FileReader,CustomEvent:dom.window.CustomEvent});Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});({render,screen,cleanup,fireEvent,waitFor}=await import('@testing-library/react'));});
afterEach(()=>{cleanup();mock.restoreAll();});
const file=()=>new dom.window.File(['%PDF-1.4\nTechnical test only'],'test.pdf',{type:'application/pdf'});
function selectFile(){fireEvent.change(screen.getByLabelText('Soubor'),{target:{files:[file()]}});}

test('upload form requires a physical file, uses UUID links and resets them when the project changes',async()=>{
  const sent:DocumentFileUploadInput[]=[];
  render(<DocumentUploadModal projects={projects} initialProjectId={projectA} units={[{id:unitA,label:'417',projectId:projectA}]} parties={[{id:partyA,label:'Test buyer',projectId:projectA}]} close={()=>{}} save={async value=>{sent.push(value);}}/>);
  fireEvent.click(screen.getByRole('button',{name:'Nahrát dokument'}));await screen.findByText('Doplňte název dokumentu.');
  fireEvent.change(screen.getByLabelText('Název dokumentu'),{target:{value:'Technická příloha'}});fireEvent.click(screen.getByRole('button',{name:'Nahrát dokument'}));await screen.findByText('Vyberte soubor k nahrání.');
  selectFile();fireEvent.change(screen.getByLabelText('Jednotka (volitelné)'),{target:{value:unitA}});fireEvent.change(screen.getByLabelText('Klient (volitelné)'),{target:{value:partyA}});
  fireEvent.click(screen.getByRole('button',{name:'Nahrát dokument'}));await waitFor(()=>assert.equal(sent.length,1));assert.equal(sent[0].projectId,projectA);assert.equal(sent[0].unitId,unitA);assert.equal(sent[0].partyId,partyA);assert.equal(sent[0].typeCode,'other');assert.equal(sent[0].status,'draft');assert.equal(sent[0].file.name,'test.pdf');
  fireEvent.change(screen.getByLabelText('Projekt'),{target:{value:projectB}});assert.equal((screen.getByLabelText('Jednotka (volitelné)')as HTMLSelectElement).value,'');assert.equal((screen.getByLabelText('Klient (volitelné)')as HTMLSelectElement).value,'');assert.equal(screen.queryByRole('option',{name:'417'}),null);
  assert.equal(screen.queryByRole('option',{name:'Rezervační smlouva'}),null);assert.equal(screen.queryByRole('option',{name:'Kupní smlouva'}),null);
});
test('same failed upload retains the request key; an explicit form change starts a new intent',async()=>{
  const sent:DocumentFileUploadInput[]=[];render(<DocumentUploadModal projects={projects} close={()=>{}} save={async value=>{sent.push(value);throw new Error('Dočasná chyba.');}}/>);selectFile();
  for(let i=1;i<=2;i++){fireEvent.click(screen.getByRole('button',{name:'Nahrát dokument'}));await screen.findByRole('alert');await waitFor(()=>assert.equal(sent.length,i));}
  assert.equal(sent[0].idempotencyKey,sent[1].idempotencyKey);fireEvent.change(screen.getByLabelText('Poznámka (volitelné)'),{target:{value:'Nové zadání'}});fireEvent.click(screen.getByRole('button',{name:'Nahrát dokument'}));await waitFor(()=>assert.equal(sent.length,3));assert.notEqual(sent[1].idempotencyKey,sent[2].idempotencyKey);
});
test('in-flight save cannot be submitted twice, closed, or edited',async()=>{
  let resolve!:()=>void;let calls=0,closed=0;const pending=new Promise<void>(r=>{resolve=r;});
  render(<DocumentUploadModal projects={projects} close={()=>{closed++;}} save={async()=>{calls++;await pending;}}/>);selectFile();const button=screen.getByRole('button',{name:'Nahrát dokument'});fireEvent.click(button);fireEvent.click(button);await waitFor(()=>assert.equal(calls,1));
  for(const name of ['Zrušit','Zavřít dialog','Zavřít'])assert.equal((screen.getByRole('button',{name})as HTMLButtonElement).disabled,true);
  assert.equal((screen.getByLabelText('Soubor')as HTMLInputElement).closest('fieldset')?.disabled,true);resolve();await waitFor(()=>assert.equal((screen.getByRole('button',{name:'Nahrát dokument'})as HTMLButtonElement).disabled,false));assert.equal(closed,0);
});
test('version upload pins the existing document/project and does not manufacture a signed status',async()=>{
  const existing={id:docId,projectId:projectA,name:'Standardy',typeCode:'other',version:'v1',versions:[{label:'v1'}]}as DocumentRecord;let sent:DocumentFileUploadInput|undefined;
  render(<DocumentUploadModal projects={projects} existing={existing} close={()=>{}} save={async value=>{sent=value;}}/>);assert.equal((screen.getByLabelText('Projekt')as HTMLSelectElement).disabled,true);assert.equal((screen.getByLabelText('Název dokumentu')as HTMLInputElement).disabled,true);assert.equal((screen.getByLabelText('Označení verze')as HTMLInputElement).value,'v2');assert.equal(screen.queryByRole('option',{name:'Podepsáno'}),null);
  selectFile();fireEvent.change(screen.getByLabelText('Stav dokumentu'),{target:{value:'ready'}});fireEvent.click(screen.getByRole('button',{name:'Nahrát novou verzi'}));await waitFor(()=>assert.ok(sent));assert.equal(sent!.documentId,docId);assert.equal(sent!.projectId,projectA);assert.equal(sent!.status,'ready');assert.equal(sent!.versionLabel,'v2');
});
test('unavailable project does not silently select another project',()=>{render(<DocumentUploadModal projects={[projects[0]]} initialProjectId={projectB} close={()=>{}} save={async()=>{assert.fail('must not submit');}}/>);assert.ok(screen.getByRole('alert'));assert.equal((screen.getByRole('button',{name:'Nahrát dokument'})as HTMLButtonElement).disabled,true);assert.equal((screen.getByLabelText('Projekt')as HTMLSelectElement).value,'');});
test('file validation accepts exact limits and rejects MIME mismatch, traversal, empty and oversized files',()=>{
  assert.equal(validateDocumentFile({name:'S.pdf',type:'application/pdf',size:25*1024*1024}),'application/pdf');assert.equal(validateDocumentFile({name:'S.DOCX',type:'',size:4*1024*1024}),'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  for(const item of [{name:'S.pdf',type:'image/png',size:1},{name:'../S.pdf',type:'application/pdf',size:1},{name:'S.exe',type:'application/octet-stream',size:1},{name:'S.pdf',type:'application/pdf',size:0},{name:'S.pdf',type:'application/pdf',size:25*1024*1024+1},{name:'S.png',type:'image/png',size:4*1024*1024+1}])assert.throws(()=>validateDocumentFile(item));
});
test('project picker uses effective per-project upload permission and rejects display-code IDs',()=>{
  const workspace={tenantId:'tenant',tenantName:'T',roles:[],permissions:[],projectScopes:[{projectId:projectA,projectName:'A',permissions:['documents.create']},{projectId:projectB,projectName:'B',permissions:['documents.read']}]};assert.deepEqual(documentUploadProjects([...projects,{id:'DEJ',name:'invalid'}],workspace),[projects[0]]);assert.deepEqual(documentUploadProjects(projects,{...workspace,permissions:['documents.upload']}),projects);
});
test('repository sends actual bytes to the upload endpoint with no identity/Graph override and no global invalidation',async()=>{
  mock.method(entraAuth,'getAccessToken',async()=>null);let captured:Record<string,unknown>={};let mutations=0;const listener=()=>{mutations++;};window.addEventListener('develocrm:data-mutated',listener);
  mock.method(globalThis,'fetch',async(url:unknown,init?:RequestInit)=>{assert.equal(url,'/api/documents/sharepoint-upload');captured=JSON.parse(String(init?.body));return Response.json({upload:{documentId:docId,documentVersionId:versionId,replayed:false,webUrl:'https://sharepoint.example.test/file'}});});
  const input:DocumentFileUploadInput={projectId:projectA,typeCode:'other',documentName:'Test',versionLabel:'v1',status:'ready',note:'',file:file(),idempotencyKey:'same-request-key',unitId:unitA};
  const result=await documentRepository.uploadFile(input);assert.equal(result.documentId,docId);assert.equal(captured.unitId,unitA);assert.equal(captured.mimeType,'application/pdf');assert.ok(captured.contentBase64);for(const key of ['tenantId','userId','membershipId','driveId','siteId','graphUrl'])assert.equal(captured[key],undefined);assert.equal(mutations,0);window.removeEventListener('develocrm:data-mutated',listener);
  await assert.rejects(documentRepository.uploadFile({...input,typeCode:'reservation_contract'}),/obchodním procesu/);await assert.rejects(documentRepository.uploadFile({...input,unitId:'417'}),/není platná/);
});
test('technical error body is never shown and retry keeps the same idempotency key',async()=>{
  mock.method(entraAuth,'getAccessToken',async()=>null);let sentKey='';mock.method(globalThis,'fetch',async(_url:unknown,init?:RequestInit)=>{sentKey=JSON.parse(String(init?.body)).idempotencyKey;return Response.json({error:'SQL SECRET STACK TRACE'},{status:500,headers:{'x-correlation-id':'safe-correlation'}});});
  const input:DocumentFileUploadInput={projectId:projectA,typeCode:'other',documentName:'T',versionLabel:'v1',status:'draft',note:'',file:file(),idempotencyKey:'same-request-key'};await assert.rejects(documentRepository.uploadFile(input),error=>error instanceof Error&&error.message.includes('safe-correlation')&&!error.message.includes('SQL'));assert.equal(sentKey,input.idempotencyKey);
});
test('BFF streams to the fixed backend with configured tenant and correlation, never a client destination',async()=>{
  const previous={url:process.env.DEVELOCRM_API_URL,tenant:process.env.DEVELOCRM_TENANT_ID};process.env.DEVELOCRM_API_URL='https://api.example.test';process.env.DEVELOCRM_TENANT_ID='configured-tenant';
  try{mock.method(globalThis,'fetch',async(url:unknown,init?:RequestInit)=>{assert.equal(String(url),'https://api.example.test/v1/documents/sharepoint-upload');assert.equal(new Headers(init?.headers).get('x-tenant-id'),'configured-tenant');assert.equal(new Headers(init?.headers).get('authorization'),'Bearer test-token');assert.ok(init?.body instanceof ReadableStream);assert.equal((init as RequestInit&{duplex?:string}).duplex,'half');assert.equal((await new Response(init?.body).json()).projectId,projectA);return Response.json({upload:{documentId:docId}},{status:201});});
    const result=await POST(new Request('https://crm.test/api/documents/sharepoint-upload?url=https://evil.invalid',{method:'POST',headers:{authorization:'DeveloCRM test-token','x-tenant-id':'forged','content-type':'application/json','x-correlation-id':'upload-test'},body:JSON.stringify({projectId:projectA})}));assert.equal(result.status,201);assert.equal(result.headers.get('x-correlation-id'),'upload-test');
  }finally{if(previous.url===undefined)delete process.env.DEVELOCRM_API_URL;else process.env.DEVELOCRM_API_URL=previous.url;if(previous.tenant===undefined)delete process.env.DEVELOCRM_TENANT_ID;else process.env.DEVELOCRM_TENANT_ID=previous.tenant;}
});

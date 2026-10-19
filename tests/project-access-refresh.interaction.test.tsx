import assert from 'node:assert/strict';
import {afterEach,before,test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {createApiFetch} from '../app/lib/api-client';
import {DATA_MUTATED_EVENT,announceDataMutation} from '../app/lib/data-invalidation';
import {subscribeProjectAccessChanges} from '../app/lib/session-revalidation';

const cleanups:Array<()=>void>=[];
before(()=>{
  const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://develocrm.test/projects'});
  Object.assign(globalThis,{window:dom.window,CustomEvent:dom.window.CustomEvent});
});
afterEach(()=>{for(const cleanup of cleanups.splice(0))cleanup();});
function observe(){let calls=0;cleanups.push(subscribeProjectAccessChanges(()=>{calls++;}));return()=>calls;}

test('successful project creation revalidates server-resolved access exactly once',async()=>{
  const calls=observe();
  const request=createApiFetch({getAccessToken:async()=>null},async()=>Response.json({id:'new-project'},{status:201}),()=>false);
  await request('/api/catalog/projects',{method:'POST'});
  assert.equal(calls(),1);
});

test('rejected creation and reads do not refresh or invent permissions',async()=>{
  const calls=observe();
  const rejected=createApiFetch({getAccessToken:async()=>null},async()=>Response.json({error:'Forbidden'},{status:403}),()=>false);
  await rejected('/api/catalog/projects',{method:'POST'});
  const read=createApiFetch({getAccessToken:async()=>null},async()=>Response.json({projects:[]}),()=>false);
  await read('/api/catalog/projects');
  assert.equal(calls(),0);
});

test('ordinary unit, contract and payment mutations leave the identity request untouched',()=>{
  const calls=observe();
  for(const target of ['/api/catalog/projects/project-id/units','/api/commercial/contracts/contract-id/sign','/api/payments','/api/catalog/projects/project-id']){
    announceDataMutation({method:'POST',target});
  }
  announceDataMutation({method:'PATCH',target:'/api/catalog/projects'});
  assert.equal(calls(),0);
});

test('same-origin absolute URL, query and trailing slash are accepted without matching other origins',()=>{
  const calls=observe();
  announceDataMutation({method:'post',target:'https://develocrm.test/api/catalog/projects/?source=ui'});
  announceDataMutation({method:'POST',target:'https://other.test/api/catalog/projects'});
  assert.equal(calls(),1);
});

test('malformed events are ignored and cleanup removes the listener',()=>{
  let calls=0;const stop=subscribeProjectAccessChanges(()=>{calls++;});
  for(const detail of [undefined,null,{}, {method:'POST'}, {method:42,target:'/api/catalog/projects'}, {method:'POST',target:42}]){
    window.dispatchEvent(new CustomEvent(DATA_MUTATED_EVENT,{detail}));
  }
  assert.equal(calls,0);stop();
  announceDataMutation({method:'POST',target:'/api/catalog/projects'});
  assert.equal(calls,0);
});

test('the CRM subscribes to project scope changes and discards stale session responses',async()=>{
  const source=await readFile(new URL('../app/CRMApp.tsx',import.meta.url),'utf8');
  assert.match(source,/useEffect\(\(\)=>subscribeProjectAccessChanges\(\(\)=>setProjectAccessRevision/);
  assert.match(source,/\[connectionRetryKey,projectAccessRevision\]/);
  assert.match(source,/getSession\(controller.signal\)\.then\(session=>\{if\(controller.signal.aborted\)return;setIdentitySession/);
});

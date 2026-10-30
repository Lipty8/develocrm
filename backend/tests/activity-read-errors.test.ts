import assert from 'node:assert/strict';
import test from 'node:test';
import {buildApp} from '../src/app.js';
import {IamRepository} from '../src/iam/repository.js';
import {ActivityRepository} from '../src/activity/repository.js';

for(const kind of ['project','unit','workspace'] as const)test(`${kind} history distinguishes unexpected read failures from access denial`,async t=>{
 const identity={issuer:'https://identity.example.test',subject:'synthetic-subject',entraTenantId:'entra',email:'synthetic@example.test',displayName:'Technical Reader'};
 const user={id:'synthetic-user',email:identity.email,displayName:identity.displayName};
 t.mock.method(IamRepository.prototype,'resolveUser',async()=>user);
 t.mock.method(IamRepository.prototype,'getSession',async()=>({user,workspace:{tenantId:'tenant',tenantName:'Technical',tenantSlug:'test',membershipId:'member',roles:[],permissions:[]}}));
 let failure:Error|null=null;const calls:unknown[]=[];
 t.mock.method(ActivityRepository.prototype,'projectTimeline',async(input:Parameters<ActivityRepository['projectTimeline']>[0])=>{calls.push(input);if(failure)throw failure;return[];});
 t.mock.method(ActivityRepository.prototype,'unitTimeline',async(input:Parameters<ActivityRepository['unitTimeline']>[0])=>{calls.push(input);if(failure)throw failure;return[];});
 t.mock.method(ActivityRepository.prototype,'workspaceTimeline',async(input:Parameters<ActivityRepository['workspaceTimeline']>[0])=>{calls.push(input);if(failure)throw failure;return[];});
 const app=buildApp({database:{} as never,verifier:{verify:async(token?:string)=>{if(!token)throw new Error('missing token');return identity;}} as never});t.after(()=>app.close());
 const projectId='11111111-1111-4111-8111-111111111111';
 const url=kind==='project'?`/v1/projects/${projectId}/timeline`:kind==='unit'?`/v1/units/${projectId}/timeline`:'/v1/activity';
 const headers={authorization:'Bearer synthetic-test','x-tenant-id':'tenant'};
 assert.equal((await app.inject({method:'GET',url})).statusCode,401);assert.equal(calls.length,0);
 const ok=await app.inject({method:'GET',url,headers});assert.equal(ok.statusCode,200);assert.deepEqual(ok.json(),{events:[]});
 assert.deepEqual(calls[0],{tenantId:'tenant',userId:user.id,membershipId:'member',identityEmail:identity.email,...(kind==='project'?{projectId}:kind==='unit'?{unitId:projectId}:{})});
 for(const message of ['SELECT private_column FROM private_table','permission denied for relation private_table','connection reset by peer']){
  failure=new Error(message);const failed=await app.inject({method:'GET',url,headers});
  assert.equal(failed.statusCode,500);assert.equal(failed.json().correlationId,failed.headers['x-correlation-id']);
  assert.doesNotMatch(JSON.stringify(failed.json()),/private_|SELECT|\brelation\b|connection reset|oprávnění/);
 }
 for(const message of ['projects.read permission required','unit.read permission required','Uživatel nemá přístup do DeveloCRM']){
  failure=new Error(message);const denied=await app.inject({method:'GET',url,headers});assert.equal(denied.statusCode,403);
  assert.equal(denied.json().correlationId,denied.headers['x-correlation-id']);assert.doesNotMatch(JSON.stringify(denied.json()),/projects\.read|permission required/);
 }
 const before=calls.length;t.mock.method(IamRepository.prototype,'getSession',async()=>null);failure=null;
 assert.equal((await app.inject({method:'GET',url,headers})).statusCode,403);assert.equal(calls.length,before);
});

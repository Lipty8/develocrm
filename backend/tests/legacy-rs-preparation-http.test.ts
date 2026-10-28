import test from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../src/app.js';
import {IamRepository} from '../src/iam/repository.js';
import {LegacyRsPreparationRepository} from '../src/contracts/legacy-rs-preparation-repository.js';
import {LegacyRsPreparationError} from '../src/contracts/legacy-rs-preparation.js';

const contract='00000000-0000-4000-8000-000000000081';
const identity={issuer:'https://identity.test',subject:'technical-subject',entraTenantId:'entra',email:'technical@example.test',displayName:'Technical Preparation'};
const user={id:'actor-user',email:identity.email,displayName:identity.displayName};
test('legacy preparation HTTP uses session context, correct replay status and safe failure messages',async t=>{
 t.mock.method(IamRepository.prototype,'resolveUser',async()=>user);
 t.mock.method(IamRepository.prototype,'getSession',async()=>({user,workspace:{tenantId:'tenant',membershipId:'member',roles:[],permissions:[]}}));
 let failure:Error|null=null,replayed=false;const calls:unknown[]=[];
 t.mock.method(LegacyRsPreparationRepository.prototype,'preview',async(input:unknown)=>{calls.push(input);if(failure)throw failure;return{previewToken:'server-token'};});
 t.mock.method(LegacyRsPreparationRepository.prototype,'prepare',async(input:unknown,body:unknown)=>{calls.push([input,body]);if(failure)throw failure;return{versionId:'version',replayed};});
 const app=buildApp({database:{} as never,verifier:{verify:async(token?:string)=>{if(!token)throw new Error('missing token');return identity;}} as never});t.after(()=>app.close());
 const headers={authorization:'Bearer technical-test','x-tenant-id':'tenant'};
 const url=`/v1/contracts/${contract}/legacy-preparation`;
 const denied=await app.inject({method:'GET',url});assert.equal(denied.statusCode,401);assert.equal(calls.length,0);
 const malformed=await app.inject({method:'GET',url:'/v1/contracts/not-a-uuid/legacy-preparation',headers});assert.equal(malformed.statusCode,404);assert.equal(calls.length,0);
 const preview=await app.inject({method:'GET',url,headers});assert.equal(preview.statusCode,200);assert.deepEqual(preview.json(),{preview:{previewToken:'server-token'}});
 assert.deepEqual(calls[0],{tenantId:'tenant',userId:user.id,membershipId:'member',identityEmail:identity.email,contractId:contract});
 const body={explicit:'technical request'};
 const created=await app.inject({method:'POST',url,headers,payload:body});assert.equal(created.statusCode,201);
 assert.deepEqual(calls[1],[calls[0],body]);replayed=true;
 assert.equal((await app.inject({method:'POST',url,headers,payload:body})).statusCode,200);
 for(const [code,status] of [['not_found_or_forbidden',404],['stale_preview',409],['existing_evidence_requires_review',409],['idempotency_mismatch',409],['invalid_fee',422]] as const){
  failure=new LegacyRsPreparationError(code);
  const result=await app.inject({method:'POST',url,headers,payload:body});assert.equal(result.statusCode,status);
  assert.equal(result.json().correlationId,result.headers['x-correlation-id']);
  assert.doesNotMatch(result.json().message,/SELECT|INSERT|permission|snapshot|Graph|LegacyRs|stale_preview/);
 }
 failure=new Error('SELECT secret_internal_column FROM private_table; sensitive-placeholder');
 const unexpected=await app.inject({method:'POST',url,headers,payload:body});assert.equal(unexpected.statusCode,500);
 assert.doesNotMatch(JSON.stringify(unexpected.json()),/secret_internal|private_table|sensitive-placeholder|SELECT/);
 assert.equal(unexpected.json().correlationId,unexpected.headers['x-correlation-id']);
});

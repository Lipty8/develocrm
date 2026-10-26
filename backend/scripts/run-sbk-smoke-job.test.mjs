import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {smokeJobDefinition} from './run-sbk-smoke-job.mjs';

const uuid='11111111-1111-4111-8111-111111111111';
const deployed={ready:'healthy',latest:'healthy',image:`acrdevelocrmpilot9a4c6e.azurecr.io/develocrm-api@sha256:${'a'.repeat(64)}`};
const context={tenantId:uuid,membershipId:uuid,projectId:uuid,confirmSyntheticOnly:true};
const source=readFileSync(new URL('./smoke-sbk-business.mjs',import.meta.url),'utf8');
const file=path=>{const bytes=readFileSync(new URL(path,import.meta.url));return{base64:bytes.toString('base64'),sha256:createHash('sha256').update(bytes).digest('hex')};};
function original(){return{...context,mode:'prepare_rs',profile:'approved-original',templates:{
  rs:file('../templates/review/rs-dejvice-original-review.docx'),sbk:file('../templates/review/sbk-dejvice-original-delivery-review.docx')},
technicalAppendix:file('../templates/technical/TECH72-rs-synthetic-template.docx')};}

test('both actual approved originals fit independent Linux env entries, never the command argument',()=>{
  const input=original(),before=JSON.stringify(input),job=smokeJobDefinition({source,input,deployed});
  const container=job.containers[0];
  assert.equal(container.image,deployed.image);assert.equal(container.name,'job-develocrm-hold-expiry');
  assert.ok(Buffer.byteLength(container.command.at(-1))<2000);
  assert.ok(container.env.reduce((sum,e)=>sum+Buffer.byteLength(e.value??''),0)>131072);
  assert.ok(container.env.every(e=>Buffer.byteLength(e.name+'='+(e.value??''))<=110000));
  const values=Object.fromEntries(container.env.map(e=>[e.name,e.value]));
  assert.equal(JSON.parse(values.SMOKE_RS_SOURCE).sha256,input.templates.rs.sha256);
  assert.equal(JSON.parse(values.SMOKE_SBK_SOURCE).sha256,input.templates.sbk.sha256);
  assert.equal(JSON.parse(values.SMOKE_INPUT).templates,undefined);
  assert.match(values.SMOKE_OPERATOR,/from 'file:\/\/\/app\/backend\/dist\//);
  assert.equal(JSON.stringify(input),before);
});
test('runtime database uses only the existing secret reference, never a caller URL',()=>{
  const input={...context,mode:'verify_generated',profile:'approved-original',databaseUrl:'SECRET_SENTINEL'};
  const job=smokeJobDefinition({source,input,deployed});
  assert.deepEqual(job.containers[0].env[0],{name:'DATABASE_URL',secretRef:'database-url'});
  assert.doesNotMatch(JSON.stringify(job),/SECRET_SENTINEL/);
  assert.equal(job.containers[0].env.some(e=>e.name==='SMOKE_RS_SOURCE'),false);
});
test('unhealthy, mutable or wrong registry images fail before a job definition is emitted',()=>{
  for(const change of [{ready:'old'},{image:'acrdevelocrmpilot9a4c6e.azurecr.io/develocrm-api:latest'},
    {image:`other.azurecr.io/develocrm-api@sha256:${'a'.repeat(64)}`}])
    assert.throws(()=>smokeJobDefinition({source,input:{...context,mode:'verify'},deployed:{...deployed,...change}}),/IMMUTABLE_IMAGE_REQUIRED/);
});
test('approved profile rejects substituted sources, missing appendices and missing templates',()=>{
  const changed=original();changed.templates.rs=changed.templates.sbk;
  assert.throws(()=>smokeJobDefinition({source,input:changed,deployed}),/APPROVED_SOURCE_HASH/);
  const missing=original();delete missing.technicalAppendix;
  assert.throws(()=>smokeJobDefinition({source,input:missing,deployed}),/TECHNICAL_APPENDIX/);
  assert.throws(()=>smokeJobDefinition({source,input:{...context,mode:'prepare_rs'},deployed}),/TEMPLATE_INPUT/);
});
test('oversized operator source fails locally instead of starting a broken container',()=>{
  assert.throws(()=>smokeJobDefinition({source:'x'.repeat(110001),input:{...context,mode:'verify'},deployed}),/ENV_VALUE_TOO_LONG/);
});
test('default TECH72 profile keeps its separately validated nonlegal template inputs',()=>{
  const input={...context,mode:'prepare_sbk',templates:{rs:file('../templates/technical/TECH72-rs-synthetic-template.docx'),
    sbk:file('../templates/technical/TECH72-sbk-synthetic-template.docx')}};
  const env=smokeJobDefinition({source,input,deployed}).containers[0].env;
  assert.equal(env.some(e=>e.name==='SMOKE_APPENDIX_SOURCE'),false);
  input.templates.rs=original().templates.rs;
  assert.throws(()=>smokeJobDefinition({source,input,deployed}),/TEMPLATE_SCHEMA_INVALID|NOT_SYNTHETIC/);
});

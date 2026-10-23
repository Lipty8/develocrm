import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {assertSmokeInput,assertSmokeProject,assertSyntheticTemplate,smokeFailure,SMOKE_KEY} from './smoke-sbk-business.mjs';

const actor='11111111-1111-4111-8111-111111111111';
const project={code:'TECH72',name:'TECH SMOKE 0072 – synthetic RS SBK',archived_at:null};
const marker={smokeKey:SMOKE_KEY,actor};
const context={tenantId:actor,membershipId:actor};

test('mutating phases require explicit synthetic confirmation and exact context',()=>{
  assert.throws(()=>assertSmokeInput({...context,mode:'prepare_rs'}),/EXPLICIT_SYNTHETIC/);
  assert.doesNotThrow(()=>assertSmokeInput({...context,mode:'prepare_rs',confirmSyntheticOnly:true}));
  assert.throws(()=>assertSmokeInput({...context,mode:'prepare_sbk',confirmSyntheticOnly:true}),/PROJECT_ID_REQUIRED/);
  assert.throws(()=>assertSmokeInput({...context,mode:'verify',projectId:'417'}),/PROJECT_ID_INVALID/);
});
test('project name alone never authorizes adopting an existing fixture',()=>{
  assert.throws(()=>assertSmokeProject(project,null,actor,'prepare_rs'),/NOT_OWNED/);
  assert.throws(()=>assertSmokeProject({...project,code:'DEJ'},marker,actor,'verify'),/NOT_OWNED/);
  assert.throws(()=>assertSmokeProject(project,{...marker,actor:'other'},actor,'verify'),/NOT_OWNED/);
  assert.doesNotThrow(()=>assertSmokeProject(project,marker,actor,'prepare_rs'));
});
test('archived technical projects allow verification and idempotent cleanup only',()=>{
  const archived={...project,archived_at:'2026-10-23'};
  for(const mode of ['prepare_rs','prepare_sbk'])assert.throws(()=>assertSmokeProject(archived,marker,actor,mode),/NOT_OWNED/);
  for(const mode of ['verify','cleanup'])assert.doesNotThrow(()=>assertSmokeProject(archived,marker,actor,mode));
});
for(const kind of ['rs','sbk'])test(`${kind} synthetic fixture matches pinned hash and authoritative placeholder schema`,()=>{
  const bytes=readFileSync(new URL(`../templates/technical/TECH72-${kind}-synthetic-template.docx`,import.meta.url));
  const manifest=JSON.parse(readFileSync(new URL('../templates/technical/manifest.json',import.meta.url),'utf8'));
  assert.equal(manifest.syntheticOnly,true);assert.equal(manifest.legalContent,false);
  assert.doesNotThrow(()=>assertSyntheticTemplate(bytes,manifest.files[kind].sha256,kind));
  assert.throws(()=>assertSyntheticTemplate(bytes,'0'.repeat(64),kind),/HASH_MISMATCH/);
  const bad=Buffer.from('not a docx');
  assert.throws(()=>assertSyntheticTemplate(bad,createHash('sha256').update(bad).digest('hex'),kind));
  assert.throws(()=>assertSyntheticTemplate(bytes,manifest.files[kind].sha256,'ks'),/KIND_INVALID/);
});
test('failure output never exposes raw SQL, Graph URLs, secrets or stacks',()=>{
  const error=new Error('postgresql://password@host secret https://graph.microsoft.com/private');
  error.code='bad https://secret';error.query='SELECT sensitive';
  const output=JSON.stringify(smokeFailure(error,'prepare_rs',actor));
  assert.match(output,/SMOKE_OPERATION_FAILED/);
  assert.doesNotMatch(output,/password|https|sensitive|stack|postgresql/);
  assert.equal(smokeFailure({code:'23505'},'prepare_rs',actor).code,'23505');
});

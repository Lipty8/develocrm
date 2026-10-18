import assert from 'node:assert/strict';
import test from 'node:test';
import {InventoryRepository} from '../src/inventory/repository.js';
import {validateProjectContractSettings,type ProjectContractSettings} from '../src/shared/project-contract-settings.js';
const settings:ProjectContractSettings={name:'Technical seller',registrationNumber:'12345678',address:'Technical address',registryEntry:'Technical register',representative:'Technical representative',email:'seller@example.test',dataBox:'testbox',bankAccount:'000/0000',bankName:'Technical bank',reservationPeriodDays:30};
const input={tenantId:'10000000-0000-4000-8000-000000000001',userId:'10000000-0000-4000-8000-000000000002',membershipId:'10000000-0000-4000-8000-000000000003',projectId:'10000000-0000-4000-8000-000000000004',name:'Technical',lifecycleStatus:'active',contractSettings:settings};
function fixture(allowed:boolean){const calls:Array<{sql:string;params:unknown[]}>=[];const database={withContext:async(ctx:{tenantId:string;userId:string},work:(client:unknown)=>unknown)=>{assert.equal(ctx.tenantId,input.tenantId);assert.equal(ctx.userId,input.userId);return work({query:async(sql:string,params:unknown[])=>{calls.push({sql,params});return{rows:sql.includes('has_project_permission')?[{allowed}]:[{id:input.projectId}]};}});}};return{repo:new InventoryRepository(database as never),calls};}
test('prodávající se ukládá do existující projektové konfigurace s auditem a outbox',async()=>{
  const f=fixture(true);await f.repo.updateProject(input);
  const write=f.calls.find(c=>c.sql.includes('INSERT INTO project_contract_settings'));assert.ok(write);assert.equal(write.params[0],input.tenantId);assert.equal(write.params[1],input.projectId);
  assert.ok(f.calls.some(c=>c.sql.includes('INSERT INTO audit_log')));assert.ok(f.calls.some(c=>c.sql.includes('INSERT INTO outbox_events')));
  const permission=f.calls[0];assert.ok(permission.sql.includes("'contract.manage'"));assert.deepEqual(permission.params,[input.tenantId,input.membershipId,input.projectId]);
});
test('bez projektového contract.manage nelze uložit prodávajícího ani změnit projekt',async()=>{
  const f=fixture(false);await assert.rejects(f.repo.updateProject(input),/permission/);assert.equal(f.calls.length,1);
});
test('neúplná konfigurace se odmítne před zápisem a neobsahuje implicitního IMMO prodávajícího',async()=>{
  const f=fixture(true);await assert.rejects(f.repo.updateProject({...input,contractSettings:{...settings,bankAccount:''}}),/bankovní účet/);assert.equal(f.calls.length,0);
  assert.throws(()=>validateProjectContractSettings({...settings,reservationPeriodDays:0}),/1 až 180/);
});
test('originálové údaje se ukládají do stejného nastavení a starší klient je nesmaže',async()=>{
  const f=fixture(true);await f.repo.updateProject({...input,contractSettings:{...settings,signatureName:' Technical signer ',clientChangesBankAccount:' 111/0000 ',deliveryAddress:' Technical delivery '}});
  const write=f.calls.find(c=>c.sql.includes('INSERT INTO project_contract_settings'))!;
  assert.deepEqual(write.params.slice(13),['Technical signer','111/0000','Technical delivery']);
  assert.match(write.sql,/seller_signature_name=COALESCE\(EXCLUDED.seller_signature_name,project_contract_settings.seller_signature_name\)/);
  const old=fixture(true);await old.repo.updateProject(input);
  assert.deepEqual(old.calls.find(c=>c.sql.includes('INSERT INTO project_contract_settings'))!.params.slice(13),[null,null,null]);
});
test('neplatný typ nebo nadměrná délka nových údajů je odmítnutá před jakýmkoli zápisem',async()=>{
  for(const invalid of [{signatureName:123},{clientChangesBankAccount:null},{deliveryAddress:'a'.repeat(501)}]){
    const f=fixture(true);await assert.rejects(f.repo.updateProject({...input,contractSettings:{...settings,...invalid} as ProjectContractSettings}),/zkontrolujte údaj/);assert.equal(f.calls.length,0);
  }
  validateProjectContractSettings({...settings,signatureName:'',clientChangesBankAccount:'',deliveryAddress:''});
});

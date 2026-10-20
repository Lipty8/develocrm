import test from 'node:test';
import assert from 'node:assert/strict';
import {projectContractPaymentTimings,projectContractTemplateSelectionSql} from '../src/contracts/project-template-selection.js';
test('creation reuses the generation selection and scopes discovery to the authorized project',async()=>{
  let sql='',values:unknown[]=[];
  const client={query:async(q:string,p:unknown[])=>{sql=q;values=p;return{rows:[{contract_type:'rs',variant_key:'default',approved_count:1},{contract_type:'sbk',variant_key:'dejvice-original-dob-full-v1',approved_count:0}]};}};
  const context={tenantId:'tenant',projectId:'project',membershipId:'actor'};
  assert.deepEqual(await projectContractPaymentTimings(client as never,context),{rs:'fixed_date',sbk:'signature'});
  assert.ok(sql.includes(projectContractTemplateSelectionSql));assert.ok(sql.includes('app.has_project_permission'));assert.deepEqual(values,['tenant','project','actor']);
});
test('ambiguity blocks only its own contract type, while missing project access fails closed',async()=>{
  const client={query:async()=>({rows:[{contract_type:'rs',variant_key:'default',approved_count:2},{contract_type:'sbk',variant_key:'dejvice-original-dob-full-v1',approved_count:1}]})};
  assert.deepEqual(await projectContractPaymentTimings(client as never,{tenantId:'t',projectId:'p',membershipId:'m'}),{rs:null,sbk:'signature'});
  await assert.rejects(projectContractPaymentTimings({query:async()=>({rows:[]})} as never,{tenantId:'t',projectId:'other',membershipId:'m'}),/permission required/);
});
test('nová SBK varianta zachová podpisovou platební politiku bez nového finančního profilu',async()=>{
 const client={query:async()=>({rows:[{contract_type:'rs',variant_key:'default',approved_count:1},{contract_type:'sbk',variant_key:'dejvice-original-dob-delivery-v2',approved_count:0}]})};
 assert.deepEqual(await projectContractPaymentTimings(client as never,{tenantId:'t',projectId:'p',membershipId:'m'}),{rs:'fixed_date',sbk:'signature'});
});

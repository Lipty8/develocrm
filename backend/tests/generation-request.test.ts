import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {generationRequest,restoreGenerationRequest,type GenerationRequest} from '../src/documents/generation-request.js';
import {RsGenerationRepository} from '../src/contracts/rs-generation-repository.js';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
test('persisted request preserves the existing hash format and exact snapshot ordering',()=>{
  const input:GenerationRequest={projectId:'project',templateVersionId:'template',contractId:'contract',documentId:'document',documentName:'Original name',
    snapshot:{'z.last':'Original buyer','a.first':'Original price'},contractAppendices:{versionId:'working',items:[{number:1,documentId:'appendix',documentVersionId:'exact'}]}};
  const before={projectId:input.projectId,templateVersionId:input.templateVersionId,unitId:input.unitId??null,partyId:input.partyId??null,
    salesCaseId:input.salesCaseId??null,contractId:input.contractId??null,documentId:input.documentId??null,documentName:input.documentName??null,
    snapshot:input.snapshot??null,...(input.contractAppendices?{contractAppendices:input.contractAppendices}:{})};
  const stored=generationRequest(input);assert.equal(hash(stored),hash(before));assert.match(hash(stored),/^[a-f0-9]{64}$/);
  const restored=restoreGenerationRequest(JSON.parse(JSON.stringify(stored)));
  assert.equal(hash(generationRequest(restored)),hash(before));assert.deepEqual(restored.snapshot,input.snapshot);
  assert.deepEqual(restored.contractAppendices,input.contractAppendices);
});
test('request envelope does not persist credentials or actor context',()=>{
  const input={projectId:'p',templateVersionId:'t',userId:'never-store',membershipId:'never-store',accessToken:'never-store'};
  assert.equal(JSON.stringify(generationRequest(input)).includes('never-store'),false);
});
test('recovery lookup rejects hash/context mismatch and is explicitly scoped',async()=>{
  const input={tenantId:'tenant',membershipId:'actor',userId:'user',contractId:'contract'};
  const stored=generationRequest({projectId:'project',templateVersionId:'template',contractId:'contract',unitId:'unit',salesCaseId:'case',snapshot:{'buyer.name':'Original'}});
  const row={idempotency_key:'persisted-key',request_context:JSON.stringify(stored),request_hash:hash(stored),state:'reserved',
    contract_type:'rs',project_id:'project',unit_id:'unit',sales_case_id:'case',template_version_id:'template'};
  let sql='';let args:unknown[]=[];
  const database={withContext:async(_ctx:unknown,work:(client:unknown)=>Promise<unknown>)=>work({query:async(query:string,values:unknown[])=>{sql=query;args=values;return{rows:[row]};}})};
  const repo=new RsGenerationRepository(database as never);
  const recovered=await repo.pendingGeneration(input);assert.deepEqual(recovered?.request?.snapshot,stored.snapshot);
  for(const fragment of ['g.tenant_id=$1','g.contract_id=$3','g.project_id=c.project_id','g.created_by_membership_id=$2',"'contract.manage'","'documents.upload'","g.state='reserved'","g.state='completed'","s.status='active'","p.archived_at IS NULL"])
    assert.ok(sql.includes(fragment),fragment);
  assert.deepEqual(args,['tenant','actor','contract',null]);
  row.request_hash='0'.repeat(64);await assert.rejects(repo.pendingGeneration(input),/integrity mismatch/);
  row.request_context=JSON.stringify({...stored,projectId:'other-project'});row.request_hash=hash(JSON.parse(row.request_context));
  await assert.rejects(repo.pendingGeneration(input),/context mismatch/);
});

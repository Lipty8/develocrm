import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {assertSmokeInput,assertSmokeProject,assertSyntheticTemplate,assertSignedChainEvidence,loadSignedSmokePaymentTerms,smokeFailure,SMOKE_KEY} from './smoke-sbk-business.mjs';
import {getSalesProcessState} from '../dist/shared/next-contract-action.js';
import {originalPaymentPlan} from '../dist/contracts/original-payment-plan.js';

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
  assert.equal(smokeFailure(new Error('SINGLESECRET'),'prepare_rs',actor).code,'SMOKE_OPERATION_FAILED');
  assert.equal(smokeFailure({code:'contract_appendices_required'},'sbk.generate',actor).code,'contract_appendices_required');
});

function signedChain(){
  const contracts=['rs','sbk'].map(type=>({id:type,type,status:'signed',unitId:'unit',salesCaseId:'case',
    signedAt:'2026-10-23T21:00:00.000Z',lastRequiredSignatureAt:'2026-10-23T21:00:00.000Z',allRequiredSigned:true,
    versionStatus:'signed',versionSignedAt:'2026-10-23T21:00:00.000Z',versionId:`${type}-v1`,locked:true,
    documentVersionId:`${type}-doc-v1`,signatureAudits:1,signatureEvents:1,signatureOutbox:1,versionCount:1,generationCount:1}));
  const salesProcess=getSalesProcessState({hasActiveSalesCase:true,contracts:contracts.map(c=>({...c})),commercialStatus:'contracted',salesStage:'sbk'});
  return{contracts,unit:{id:'unit',salesCaseId:'case',caseStatus:'active',commercialStatus:'contracted',stage:'sbk'},
    next:{...salesProcess.nextContractAction,salesCaseId:'case',salesProcess},
    terms:{contractType:'sbk',precedingRsContractId:'rs',totalPrice:'5500000.00',reservationFee:'250000.00',paidReservationFee:'250000.00'},
    payments:[{schedule_key:'sbk_first',amount:'1100000.00',dueOn:'2026-11-02',contractVersionId:'sbk-v1',unitId:'unit',salesCaseId:'case'}]};
}
test('signed-chain verification uses central projection and Czech holiday-aware deadline',()=>{
  assert.doesNotThrow(()=>assertSignedChainEvidence(signedChain()));
  const early=signedChain();early.payments[0].dueOn='2026-10-30';
  assert.throws(()=>assertSignedChainEvidence(early),/PAYMENT_PLAN_INVALID/);
});
test('signed-chain verification rejects stale stage, free unit or repeated RS CTA',()=>{
  for(const mutate of [s=>{s.unit.commercialStatus='available';},s=>{s.unit.stage='rs';},s=>{s.next.contractType='rs';},
    s=>{s.next.salesProcess.steps.find(step=>step.code==='sbk').state='current';}]){
    const state=signedChain();mutate(state);assert.throws(()=>assertSignedChainEvidence(state),/WORKFLOW_INCONSISTENT/);
  }
});
test('signed-chain verification rejects incomplete signatures, unlocked files and duplicate audit/generation',()=>{
  for(const mutate of [s=>{s.contracts[1].allRequiredSigned=false;},s=>{s.contracts[1].locked=false;},
    s=>{s.contracts[1].documentVersionId=null;},s=>{s.contracts[1].signatureAudits=2;},
    s=>{s.contracts[1].signatureOutbox=0;},s=>{s.contracts[1].generationCount=2;},
    s=>{s.contracts[1].lastRequiredSignatureAt='2026-10-24T21:00:00.000Z';}]){
    const state=signedChain();mutate(state);assert.throws(()=>assertSignedChainEvidence(state),/SIGNATURE_EVIDENCE_INVALID/);
  }
});
test('signed-chain verification rejects mismatched business context and premature final installment',()=>{
  const wrongCase=signedChain();wrongCase.contracts[1].salesCaseId='other';
  assert.throws(()=>assertSignedChainEvidence(wrongCase),/BUSINESS_CONTEXT_MISMATCH/);
  for(const mutate of [s=>{s.payments[0].contractVersionId='old';},s=>{s.payments[0].salesCaseId='other';},
    s=>{s.payments.push({...s.payments[0],schedule_key:'sbk_final',amount:'4150000.00'});}]){
    const state=signedChain();mutate(state);assert.throws(()=>assertSignedChainEvidence(state),/PAYMENT_PLAN_INVALID/);
  }
});
test('post-signature verifier reads the exact locked signed version, not the draft preparation mapper',async()=>{
  const terms={version:1,profile:'dejvice-original-dob-full-v1',calendarPolicy:'cz-2026-v1',signatureAnchor:'last_required_signature',
    contractType:'sbk',totalPrice:'5500000.00',reservationFee:'250000.00',paidReservationFee:'250000.00',
    precedingRsContractId:actor,buyerPartyId:actor,variableSymbol:'72',
    rows:originalPaymentPlan({type:'sbk',totalPrice:'5500000.00',reservationFeeAmount:'250000.00',paidReservationFeeAmount:'250000.00'})};
  const target={tenantId:'tenant',projectId:'project',contractId:'contract',versionId:'version',membershipId:'membership'};
  const result=await loadSignedSmokePaymentTerms(async(query,values)=>{
    assert.match(query,/FROM contract_versions v/);assert.match(query,/c.current_status='signed'/);
    assert.match(query,/v.version_status='signed'/);assert.match(query,/v.locked_at IS NOT NULL/);
    assert.match(query,/app.has_project_permission/);assert.deepEqual(values,['tenant','project','contract','version','membership']);
    return{rows:[{payment_terms_snapshot:terms}]};
  },target);
  assert.equal(result,terms);
  for(const rows of [[],[{payment_terms_snapshot:null}],[{payment_terms_snapshot:{...terms,signatureAnchor:'planned_date'}}]])
    await assert.rejects(()=>loadSignedSmokePaymentTerms(async()=>({rows}),target),/PAYMENT_SNAPSHOT_INVALID/);
});

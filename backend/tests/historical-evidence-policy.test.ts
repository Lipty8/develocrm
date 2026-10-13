import {test} from 'node:test';
import assert from 'node:assert/strict';
import {historicalEvidenceIssues,type HistoricalEvidenceCandidate} from '../src/diagnostics/historical-evidence-policy.js';
const input:HistoricalEvidenceCandidate={actor:{systemManage:true,contractManage:true,documentsUpload:true},legacy:{reviewed:true,tenantId:'a',projectId:'p',contractId:'c',versionId:'v',signedAt:'2025-01-01T10:00:00Z'},
 document:{tenantId:'a',projectId:'p',contractId:'c',source:'external',state:'completed',exactVersionId:'1.0',hash:`sha256:${'a'.repeat(64)}`,physicalHashVerified:true},originalSignedAt:'2025-01-01T10:00:00Z'};
test('policy accepts only exact external historical evidence, without changing the original date',()=>{assert.deepEqual(historicalEvidenceIssues(input),[]);});
test('today generated replacement never counts as historical evidence',()=>{assert(historicalEvidenceIssues({...input,document:{...input.document,source:'generated'}}).includes('historical_original_required'));});
test('cross tenant/project/contract, absent hash, failed upload, changed date and weak rights are refused',()=>{
 for(const key of ['tenantId','projectId','contractId'] as const)assert(historicalEvidenceIssues({...input,document:{...input.document,[key]:'other'}}).includes('context_mismatch'));
 assert(historicalEvidenceIssues({...input,document:{...input.document,hash:null}}).includes('exact_evidence_required'));
 assert(historicalEvidenceIssues({...input,document:{...input.document,state:'failed'}}).includes('exact_evidence_required'));
 assert(historicalEvidenceIssues({...input,originalSignedAt:'2026-01-01T10:00:00Z'}).includes('signature_date_immutable'));
 assert(historicalEvidenceIssues({...input,actor:{...input.actor,systemManage:false}}).includes('permission_required'));
 assert(historicalEvidenceIssues({...input,legacy:{...input.legacy,reviewed:false}}).includes('unreviewed_legacy'));
});

/** Design contract only: no mutation endpoint or bypass of signed-version guards. */
export type HistoricalEvidenceCandidate={
 actor:{systemManage:boolean;contractManage:boolean;documentsUpload:boolean};
 legacy:{reviewed:boolean;tenantId:string;projectId:string;contractId:string;versionId:string;signedAt:string};
 document:{tenantId:string;projectId:string;contractId:string;source:'external'|'generated';state:string;exactVersionId:string|null;hash:string|null;physicalHashVerified:boolean};
 originalSignedAt:string;
};
export function historicalEvidenceIssues(c:HistoricalEvidenceCandidate):string[]{
 const issues:string[]=[];
 if(!c.actor.systemManage||!c.actor.contractManage||!c.actor.documentsUpload)issues.push('permission_required');
 if(!c.legacy.reviewed)issues.push('unreviewed_legacy');
 if(c.document.tenantId!==c.legacy.tenantId||c.document.projectId!==c.legacy.projectId||c.document.contractId!==c.legacy.contractId)issues.push('context_mismatch');
 if(c.document.source!=='external')issues.push('historical_original_required');
 if(c.document.state!=='completed'||!c.document.exactVersionId||!/^sha256:[a-f0-9]{64}$/.test(c.document.hash??'')||!c.document.physicalHashVerified)issues.push('exact_evidence_required');
 if(!Number.isFinite(Date.parse(c.originalSignedAt))||Date.parse(c.originalSignedAt)!==Date.parse(c.legacy.signedAt))issues.push('signature_date_immutable');
 return issues;
}

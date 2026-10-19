import {createHash} from "node:crypto";
import type {Database} from "../database.js";
import type {DocumentContext} from "../documents/repository.js";
import type {MicrosoftGraphAdapter} from "../documents/graph-adapter.js";
import type {SharePointDocumentUploadService} from "../documents/upload-service.js";
import {inspectDocxTemplate} from "../documents/docx-template.js";
import {signingPlanDay} from '../shared/contract-signing-plan.js';
import {czechSignatureDay} from './czech-working-days.js';
import type {SbkFinalNoticeContext} from '../shared/sbk-final-notice.js';

export class ContractDocumentError extends Error {
  constructor(readonly code:string){super("Smlouva nemá ověřený dokument připravený k podpisu.");}
}
type Evidence={contractId:string;versionId:string;documentVersionId:string;documentId:string;projectId:string;name:string;hash:string;driveId:string;itemId:string;externalVersionId:string;webUrl:string|null;signedAt:string|null};
type Context=DocumentContext&{contractId:string;versionId:string};

export class ContractDocumentEvidenceService {
  constructor(private readonly database:Database,private readonly graph:MicrosoftGraphAdapter,
    private readonly uploads:SharePointDocumentUploadService,private readonly identityClientId:string){}

  async evidence(input:Context):Promise<Evidence>{
    return this.database.withContext(input,async client=>{
      const e=(await client.query<Evidence>(`SELECT c.id "contractId",cv.id "versionId",cv.document_version_id "documentVersionId",cv.document_id "documentId",c.project_id "projectId",
        op.original_file_name name,v.content_hash hash,op.graph_drive_id "driveId",op.graph_item_id "itemId",v.external_version_id "externalVersionId",op.graph_web_url "webUrl",cv.signed_at "signedAt"
        FROM contracts c JOIN contract_versions cv ON cv.tenant_id=c.tenant_id AND cv.contract_id=c.id
        JOIN document_versions v ON v.tenant_id=cv.tenant_id AND v.id=cv.document_version_id
        JOIN document_upload_operations op ON op.tenant_id=v.tenant_id AND op.document_version_id=v.id AND op.state='completed'
        WHERE c.tenant_id=$1 AND c.id=$3 AND cv.id=$4 AND app.has_project_permission(c.tenant_id,$2,c.project_id,'contract.read')
          AND app.has_project_permission(c.tenant_id,$2,c.project_id,'documents.read')`,
        [input.tenantId,input.membershipId,input.contractId,input.versionId])).rows[0];
      if(!e)throw new ContractDocumentError("SIGNED_DOCUMENT_REQUIRED");
      await client.query("SELECT app.assert_contract_document($1,$2,$3,$4)",[input.tenantId,input.contractId,e.documentId,e.documentVersionId]);
      return e;
    });
  }

  async exactFile(input:Context){
    const evidence=await this.evidence(input);
    const connection=await this.database.withContext(input,async client=>(await client.query<{site_id:string;drive_id:string}>(`
      SELECT site_id,drive_id FROM sharepoint_connections WHERE tenant_id=$1 AND drive_id=$2
      AND authentication_mode='managed_identity' AND credential_reference=$3 AND archived_at IS NULL AND connection_status='connected'`,
      [input.tenantId,evidence.driveId,`managed-identity://${this.identityClientId}`])).rows[0]);
    if(!connection)throw new ContractDocumentError("connection_unavailable");
    const graphConnection={siteId:connection.site_id,driveId:connection.drive_id};
    const versions=await this.graph.getVersions(graphConnection,evidence.itemId);
    if(!versions.some(version=>version.id===evidence.externalVersionId))throw new ContractDocumentError("DOCUMENT_VERSION_UNAVAILABLE");
    const bytes=await this.graph.downloadFile(graphConnection,evidence.itemId,evidence.externalVersionId);
    if(`sha256:${createHash("sha256").update(bytes).digest("hex")}`!==evidence.hash)throw new ContractDocumentError("DOCUMENT_HASH_MISMATCH");
    return {evidence,bytes};
  }

  async uploadExternal(input:DocumentContext&{contractId:string;idempotencyKey:string;fileName:string;mimeType:string;bytes:Uint8Array}){
    validateFinalContractFile(input);
    const c=await this.database.withContext(input,async client=>(await client.query<{project_id:string;unit_id:string;sales_case_id:string;reference:string;document_type_code:string;document_id:string|null;mime_type:string|null}>(`
      SELECT c.project_id,c.unit_id,c.sales_case_id,c.reference,app.contract_document_type(c.contract_type) document_type_code,latest.document_id,d.mime_type FROM contracts c
        LEFT JOIN LATERAL(SELECT document_id FROM contract_versions WHERE tenant_id=c.tenant_id AND contract_id=c.id ORDER BY version_number DESC LIMIT 1) latest ON true
        LEFT JOIN documents d ON d.tenant_id=c.tenant_id AND d.id=latest.document_id
      WHERE c.tenant_id=$1 AND c.id=$3 AND c.current_status NOT IN ('signed','cancelled','terminated')
        AND NOT EXISTS(SELECT 1 FROM contract_parties cp WHERE cp.tenant_id=c.tenant_id AND cp.contract_id=c.id AND cp.signature_status='signed')
        AND app.has_project_permission(c.tenant_id,$2,c.project_id,'contract.manage')`,
      [input.tenantId,input.membershipId,input.contractId])).rows[0]);
    if(!c)throw new ContractDocumentError("contract_not_accessible");
    const uploaded=await this.uploads.upload({...input,projectId:c.project_id,unitId:c.unit_id,salesCaseId:c.sales_case_id,
      documentId:c.mime_type===input.mimeType?c.document_id??undefined:undefined,
      typeCode:c.document_type_code,documentName:`${c.reference} · finální dokument`,versionLabel:"externí finální dokument",status:"ready"});
    const result=await this.database.withContext(input,async client=>(await client.query<{versionId:string}>(`
      SELECT app.bind_external_contract_document($1,$2,$3,$4,$5) "versionId"`,[input.tenantId,input.contractId,uploaded.documentId,uploaded.documentVersionId,input.membershipId])).rows[0]);
    return {...uploaded,...result};
  }

  async recordFinalNotice(input:DocumentContext&{contractId:string;versionId:string;deliveredOn:string;idempotencyKey:string;fileName:string;mimeType:string;bytes:Uint8Array}){
    validateFinalContractFile(input);
    if(typeof input.idempotencyKey!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/.test(input.idempotencyKey))throw new Error('PAYMENT_TERMS_INVALID_REQUEST');
    const day=signingPlanDay(input.deliveredOn);
    const c=await this.database.withContext(input,async client=>(await client.query<{project_id:string;unit_id:string;sales_case_id:string;reference:string;context:SbkFinalNoticeContext|null}>(`
      SELECT c.project_id,c.unit_id,c.sales_case_id,c.reference,app.sbk_final_notice_context($1,c.id,$2) context
      FROM contracts c WHERE c.tenant_id=$1 AND c.id=$3 AND app.has_project_permission(c.tenant_id,$2,c.project_id,'contract.manage')`,
      [input.tenantId,input.membershipId,input.contractId])).rows[0]);
    if(!c?.context||!c.context.canRecord&&!c.context.notice)throw new Error('PAYMENT_TERMS_NOTICE_NOT_AVAILABLE');
    if(c.context.versionId!==input.versionId)throw new Error('PAYMENT_TERMS_CURRENT_VERSION_REQUIRED');
    if(!day||day<c.context.signedOn||day>czechSignatureDay(new Date().toISOString()))throw new Error('PAYMENT_TERMS_INVALID_DELIVERY_DATE');
    if(c.context.notice&&c.context.notice.deliveredOn!==day)throw new Error('PAYMENT_TERMS_DELIVERY_ALREADY_RECORDED');
    const uploaded=await this.uploads.upload({...input,projectId:c.project_id,unitId:c.unit_id,salesCaseId:c.sales_case_id,
      idempotencyKey:`notice:${createHash('sha256').update(input.idempotencyKey).digest('hex')}`,typeCode:'other',documentName:`${c.reference} · doklad doručení výzvy`,versionLabel:'Doklad doručení',status:'ready'});
    const result=await this.database.withContext(input,async client=>{
      await client.query('SELECT app.record_sbk_final_notice($1,$2,$3,$4::date,$5,$6,$7)',
        [input.tenantId,input.contractId,input.versionId,day,uploaded.documentVersionId,input.membershipId,input.idempotencyKey]);
      return(await client.query<{context:SbkFinalNoticeContext|null}>('SELECT app.sbk_final_notice_context($1,$2,$3) context',
        [input.tenantId,input.contractId,input.membershipId])).rows[0];
    });
    return{...result,documentId:uploaded.documentId,documentVersionId:uploaded.documentVersionId,replayed:uploaded.replayed};
  }
}

function validateFinalContractFile(input:{fileName:string;mimeType:string;bytes:Uint8Array}){
  if(typeof input.fileName!=='string'||typeof input.mimeType!=='string')throw new ContractDocumentError('invalid_file_type');
  const allowed:Record<string,string[]>={'application/pdf':['pdf'],'application/vnd.openxmlformats-officedocument.wordprocessingml.document':['docx']};
  const extension=input.fileName.split('.').at(-1)?.toLowerCase();
  if(!extension||!allowed[input.mimeType]?.includes(extension))throw new ContractDocumentError('invalid_file_type');
  if(extension==='pdf'&&Buffer.from(input.bytes.subarray(0,5)).toString()!=='%PDF-')throw new ContractDocumentError('invalid_file_type');
  if(extension==='docx'&&(input.bytes[0]!==0x50||input.bytes[1]!==0x4b))throw new ContractDocumentError('invalid_file_type');
  if(extension==='docx'){
    try{if(inspectDocxTemplate(input.bytes).tokens.length)throw new ContractDocumentError('unresolved_document_fields');}
    catch{throw new ContractDocumentError('invalid_final_docx');}
  }
}

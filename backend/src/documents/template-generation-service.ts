import { createHash } from "node:crypto";
import { inspectDocxTemplate, renderDocxTemplate, DocxTemplateError } from "./docx-template.js";
import type { MicrosoftGraphAdapter } from "./graph-adapter.js";
import type { DocumentContext, DocumentRepository } from "./repository.js";
import type { SharePointDocumentUploadService } from "./upload-service.js";
import { DocumentTemplateGenerationRepository, type PlaceholderSchema } from "./template-generation-repository.js";

export const TECHNICAL_PLACEHOLDERS=["project.name","project.code","unit.code","buyer.name","generation.date","unit.totalPrice"] as const;
export const RS_PLACEHOLDERS=["seller.name","seller.address","seller.registryEntry","seller.registrationNumber","seller.representative","seller.email","seller.dataBox","seller.bankAccount","buyer.salutation","buyer.name","buyer.address","buyer.birthDate","buyer.email","buyer.phone","buyer.dataBoxLine","project.name","project.completionYear","contract.reservationPeriodDays","unit.subjectClause","unit.balconyClause","unit.gardenClause","unit.outdoorParkingClause","unit.cellarClause","unit.garageClause","payment.reservationFeeClause","contract.totalPriceClause","contract.date"] as const;
const SUPPORTED_PLACEHOLDERS=new Set<string>([...TECHNICAL_PLACEHOLDERS,...RS_PLACEHOLDERS]);
export class DocumentGenerationError extends Error{constructor(readonly code:string){super("Dokument se nepodařilo vytvořit.");this.name="DocumentGenerationError";}}

export class DocumentTemplateGenerationService{
  constructor(private readonly repository:DocumentTemplateGenerationRepository,private readonly documents:DocumentRepository,
    private readonly uploads:SharePointDocumentUploadService,private readonly graph:MicrosoftGraphAdapter){}

  async register(input:DocumentContext&{projectId:string;code:string;name:string;outputTypeCode:string;versionLabel:string;
    sourceDocumentId:string;sourceDocumentVersionId:string;schema:PlaceholderSchema;contractType?:"rs"|"sbk"|"ks";approvalStatus?:"draft"|"approved"|"retired";effectiveFrom?:string}){
    validateSchema(input.schema);
    const source=await this.repository.sourceForRegistration(input);if(!source)throw new DocumentGenerationError("source_not_found");
    if(!source.externalVersionId)throw new DocumentGenerationError("template_source_version_unavailable");
    const connection=await this.documents.getConnectionForUpload(input);if(!connection||connection.driveId!==source.driveId)throw new DocumentGenerationError("source_drive_mismatch");
    const bytes=await this.graph.downloadFile({siteId:connection.siteId,driveId:connection.driveId},source.itemId,source.externalVersionId);
    // SharePoint may normalize Office packages during persistence. Pin the
    // immutable template hash to the bytes read back from its exact version,
    // rather than to the pre-upload transport payload stored on the document.
    const contentHash=`sha256:${hash(bytes)}`;
    const inspection=inspectDocxTemplate(bytes);const fields=Object.keys(input.schema.fields).sort();
    const unknown=inspection.tokens.filter(token=>!SUPPORTED_PLACEHOLDERS.has(token));
    if(unknown.length)throw new DocxTemplateError("unknown_template_token","Šablona obsahuje neschválená pole.",unknown);
    if(inspection.tokens.join("\0")!==fields.join("\0"))throw new DocumentGenerationError("schema_token_mismatch");
    return this.repository.register({...input,contentHash});
  }

  async generate(input:DocumentContext&{projectId:string;templateVersionId:string;idempotencyKey:string;unitId?:string;partyId?:string;
    salesCaseId?:string;contractId?:string;documentId?:string;documentName?:string;snapshot?:Record<string,string>}){
    if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/.test(input.idempotencyKey))throw new DocumentGenerationError("invalid_idempotency_key");
    const template=await this.repository.getTemplate(input);if(!template)throw new DocumentGenerationError("template_not_found");
    if(!template.externalVersionId)throw new DocumentGenerationError("template_source_version_unavailable");
    const requestHash=hash(JSON.stringify({projectId:input.projectId,templateVersionId:input.templateVersionId,unitId:input.unitId??null,
      partyId:input.partyId??null,salesCaseId:input.salesCaseId??null,contractId:input.contractId??null,documentId:input.documentId??null,documentName:input.documentName??null,snapshot:input.snapshot??null}));
    const operation=await this.repository.reserve({...input,template,requestHash});
    if(operation.state==="completed")return{operationId:operation.id,documentId:operation.outputDocumentId,documentVersionId:operation.outputDocumentVersionId,replayed:true};
    const connection=await this.documents.getConnectionForUpload(input);if(!connection||connection.driveId!==template.driveId)throw new DocumentGenerationError("template_drive_mismatch");
    const source=await this.graph.downloadFile({siteId:connection.siteId,driveId:connection.driveId},template.itemId,template.externalVersionId);
    if(`sha256:${hash(source)}`!==template.contentHash)throw new DocumentGenerationError("template_hash_mismatch");
    const required=Object.entries(template.schema.fields).filter(([,field])=>field.required).map(([token])=>token);
    const rendered=renderDocxTemplate(source,operation.snapshot,{allowedTokens:Object.keys(template.schema.fields),requiredTokens:required});
    const renderedHash=`sha256:${hash(rendered.bytes)}`;
    const stamp=operation.createdAt.replace(/[-:TZ.]/g,"").slice(0,14);const safeCode=template.templateCode.replace(/[^a-z0-9_-]/g,"-");
    const upload=await this.uploads.upload({...input,idempotencyKey:`generation:${operation.id}`,documentId:input.documentId,typeCode:template.outputTypeCode,
      documentName:input.documentName?.trim()||`${template.templateName} ${stamp}`,fileName:`${safeCode}-${stamp}.docx`,mimeType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      bytes:rendered.bytes,versionLabel:`${template.versionLabel}-${stamp}`,status:"draft",note:"Automaticky vytvořený technický dokument",
      unitId:operation.unitId??undefined,partyId:operation.partyId??undefined,salesCaseId:operation.salesCaseId??undefined,contractId:operation.contractId??undefined});
    await this.repository.complete({...input,operationId:operation.id,documentId:upload.documentId,documentVersionId:upload.documentVersionId,renderedContentHash:renderedHash});
    return{operationId:operation.id,documentId:upload.documentId,documentVersionId:upload.documentVersionId,replayed:upload.replayed};
  }
}

function validateSchema(schema:PlaceholderSchema):void{
  if(!schema||typeof schema!=="object"||!schema.fields||typeof schema.fields!=="object"||Array.isArray(schema.fields))throw new DocumentGenerationError("invalid_schema");
  const fields=Object.keys(schema.fields);if(!fields.length)throw new DocumentGenerationError("invalid_schema");
  for(const token of fields){if(!SUPPORTED_PLACEHOLDERS.has(token)||typeof schema.fields[token]?.required!=="boolean")throw new DocumentGenerationError("invalid_schema");}
}
function hash(value:Uint8Array|string):string{return createHash("sha256").update(value).digest("hex");}

import {createHash} from "node:crypto";
import type {MicrosoftGraphAdapter} from "./graph-adapter.js";
import {DocxTemplateError,inspectDocxTemplate,renderDocxTemplate} from "./docx-template.js";
import type {DocumentContext,DocumentRepository} from "./repository.js";
import {templateCatalog} from "./template-catalog.js";
import type {DocumentTemplateGenerationRepository,PlaceholderSchema} from "./template-generation-repository.js";
import type {SharePointDocumentUploadService} from "./upload-service.js";
import {DocumentTemplateManagementRepository,type TemplateValidationReport} from "./template-management-repository.js";

const DOCX_MIME="application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export class TemplateManagementError extends Error{constructor(readonly code:string,readonly details:string[]=[]){super("Správu šablony se nepodařilo dokončit.");this.name="TemplateManagementError";}}

export class DocumentTemplateManagementService{
  constructor(private readonly repository:DocumentTemplateManagementRepository,private readonly generationRepository:DocumentTemplateGenerationRepository,
    private readonly documents:DocumentRepository,private readonly uploads:SharePointDocumentUploadService,private readonly graph:MicrosoftGraphAdapter){}

  list(input:DocumentContext&{projectId?:string;outputTypeCode?:string;templateId?:string}){return this.repository.list(input);}

  async upload(input:DocumentContext&{projectId:string;code:string;name:string;outputTypeCode:string;variantKey?:string;versionLabel:string;effectiveFrom?:string;
    fileName:string;mimeType:string;bytes:Uint8Array;correlationId?:string}){
    const catalog=templateCatalog(input.outputTypeCode);if(!catalog)throw new TemplateManagementError("unsupported_template_type");
    validateUpload(input);
    await this.repository.assertUploadAllowed({...input,contractType:catalog.contractType,variantKey:input.variantKey??"default"});
    try{preflight(input.bytes,Object.keys(catalog.fields));}
    catch(error){await this.repository.auditFailure({...input,action:"document_template.validation_failed",details:{fileName:input.fileName,errorCode:error instanceof DocxTemplateError?error.code:"invalid_docx"}});throw error;}
    const stableKey=`template:${hash(`${input.projectId}:${input.code}:${input.versionLabel}`).slice(0,48)}`;
    const uploaded=await this.uploads.upload({...input,idempotencyKey:stableKey,typeCode:catalog.outputTypeCode,documentName:`Zdroj šablony ${input.name} ${input.versionLabel}`,
      versionLabel:input.versionLabel,status:"draft",note:"Zdrojová verze dokumentové šablony",bytes:input.bytes});
    const source=await this.generationRepository.sourceForRegistration({...input,sourceDocumentId:uploaded.documentId,sourceDocumentVersionId:uploaded.documentVersionId});
    if(!source?.externalVersionId)throw new TemplateManagementError("template_source_version_unavailable");
    const connection=await this.documents.getConnectionForUpload(input);if(!connection||connection.driveId!==source.driveId)throw new TemplateManagementError("source_drive_mismatch");
    const persisted=await this.graph.downloadFile({siteId:connection.siteId,driveId:connection.driveId},source.itemId,source.externalVersionId);
    const persistedValidation=preflight(persisted,Object.keys(catalog.fields));
    const schema:PlaceholderSchema={fields:Object.fromEntries(Object.entries(catalog.fields).map(([token,field])=>[token,{required:field.required}]))};
    const registered=await this.repository.createDraft({...input,contractType:catalog.contractType,variantKey:input.variantKey??"default",sourceDocumentId:uploaded.documentId,
      sourceDocumentVersionId:uploaded.documentVersionId,contentHash:`sha256:${hash(persisted)}`,schema,effectiveFrom:input.effectiveFrom??new Date().toISOString().slice(0,10),validation:persistedValidation});
    return{...registered,validation:persistedValidation};
  }

  async validate(input:DocumentContext&{templateId:string;versionId:string;correlationId?:string}){const loaded=await this.load(input,"documents.upload");
    const catalog=templateCatalog(loaded.template.outputTypeCode);if(!catalog)throw new TemplateManagementError("unsupported_template_type");
    const bytes=await this.download({...input,projectId:loaded.template.projectId},loaded.version);let validation:TemplateValidationReport;
    try{validation=preflight(bytes,Object.keys(catalog.fields));if(`sha256:${hash(bytes)}`!==loaded.version.contentHash)validation={...validation,valid:false,errors:[...validation.errors,"content_hash_mismatch"]};}
    catch(error){validation=failedValidation(error);}
    await this.repository.recordValidation({...input,contentHash:loaded.version.contentHash,validation});return validation;}

  async preview(input:DocumentContext&{templateId:string;versionId:string}){const loaded=await this.load(input,"documents.upload");const catalog=templateCatalog(loaded.template.outputTypeCode);
    if(!catalog)throw new TemplateManagementError("unsupported_template_type");const bytes=await this.download({...input,projectId:loaded.template.projectId},loaded.version);const validation=preflight(bytes,Object.keys(catalog.fields));
    if(!validation.valid)throw new TemplateManagementError("template_not_valid",validation.errors);const values=Object.fromEntries(Object.entries(catalog.fields).map(([token,field])=>[token,field.sample]));
    return renderDocxTemplate(bytes,values,{allowedTokens:Object.keys(catalog.fields),requiredTokens:Object.entries(catalog.fields).filter(([,field])=>field.required).map(([token])=>token)}).bytes;}

  async source(input:DocumentContext&{templateId:string;versionId:string}){const loaded=await this.load(input,"documents.view");return{bytes:await this.download({...input,projectId:loaded.template.projectId},loaded.version),fileName:loaded.version.sourceFileName};}
  approve(input:DocumentContext&{templateId:string;versionId:string;correlationId?:string}){return this.repository.approve(input);}
  retire(input:DocumentContext&{templateId:string;versionId:string;correlationId?:string}){return this.repository.retire(input);}

  private async load(input:DocumentContext&{templateId:string;versionId:string},permission:"documents.view"|"documents.upload"){
    const templates=await this.repository.list({...input,templateId:input.templateId});const template=templates[0];if(!template)throw new TemplateManagementError("template_not_found");
    if(permission==="documents.upload"&&!template.canManage)throw new TemplateManagementError("permission_required");const version=template.versions.find(item=>item.id===input.versionId);
    if(!version)throw new TemplateManagementError("template_version_not_found");return{template,version};}
  private async download(input:DocumentContext&{projectId:string},version:{driveId:string;itemId:string;externalVersionId:string|null}){if(!version.externalVersionId)throw new TemplateManagementError("template_source_version_unavailable");
    const connection=await this.documents.getConnectionForUpload(input);if(!connection||connection.driveId!==version.driveId)throw new TemplateManagementError("source_drive_mismatch");
    return this.graph.downloadFile({siteId:connection.siteId,driveId:connection.driveId},version.itemId,version.externalVersionId);}
}

function preflight(bytes:Uint8Array,expected:string[]):TemplateValidationReport{const inspection=inspectDocxTemplate(bytes);const found=new Set(inspection.tokens);
  const unknownTokens=inspection.tokens.filter(token=>!expected.includes(token));const missingTokens=expected.filter(token=>!found.has(token));const errors:string[]=[];
  if(inspection.legacyMarkers.length)errors.push("legacy_placeholders");if(inspection.malformedTokens.length)errors.push("malformed_placeholders");if(unknownTokens.length)errors.push("unknown_placeholders");if(missingTokens.length)errors.push("missing_placeholders");if(!inspection.tokens.length)errors.push("no_placeholders");
  return{valid:errors.length===0,tokens:inspection.tokens,unknownTokens,missingTokens,malformedTokens:inspection.malformedTokens,legacyMarkers:inspection.legacyMarkers,errors};}
function failedValidation(error:unknown):TemplateValidationReport{return{valid:false,tokens:[],unknownTokens:[],missingTokens:[],malformedTokens:error instanceof DocxTemplateError?error.details:[],legacyMarkers:[],errors:[error instanceof DocxTemplateError?error.code:"invalid_docx"]};}
function validateUpload(input:{fileName:string;mimeType:string;bytes:Uint8Array;code:string;name:string;versionLabel:string;variantKey?:string}){if(!input.fileName.toLowerCase().endsWith(".docx")||input.mimeType!==DOCX_MIME)throw new TemplateManagementError("invalid_file_type");
  if(input.bytes.byteLength<1||input.bytes.byteLength>4*1024*1024)throw new TemplateManagementError("invalid_file_size");if(!/^[a-z0-9][a-z0-9_-]{2,79}$/.test(input.code)||!input.name.trim()||!input.versionLabel.trim())throw new TemplateManagementError("invalid_metadata");
  if(input.variantKey&&!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(input.variantKey))throw new TemplateManagementError("invalid_variant");}
function hash(value:Uint8Array|string){return createHash("sha256").update(value).digest("hex");}

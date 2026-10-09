import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { Database } from "../database.js";
import { EntraMicrosoftGraphAdapter } from "./graph-adapter.js";
import { ManagedIdentityGraphTokenProvider } from "./managed-identity-token-provider.js";
import { DocumentRepository, type DocumentContext } from "./repository.js";
import { SharePointDocumentUploadService } from "./upload-service.js";
import { DocumentTemplateGenerationRepository } from "./template-generation-repository.js";
import { DocumentTemplateGenerationService } from "./template-generation-service.js";
import { inspectDocxTemplate } from "./docx-template.js";

const databaseUrl=required("DATABASE_URL"),clientId=required("SHAREPOINT_MANAGED_IDENTITY_CLIENT_ID");
const context:DocumentContext={tenantId:required("DOCX_SMOKE_TENANT_ID"),userId:required("DOCX_SMOKE_USER_ID"),membershipId:required("DOCX_SMOKE_MEMBERSHIP_ID")};
const projectId=required("DOCX_SMOKE_PROJECT_ID"),release=required("DOCX_SMOKE_RELEASE");
const database=new Database(databaseUrl),graph=new EntraMicrosoftGraphAdapter(new ManagedIdentityGraphTokenProvider(clientId));
const documents=new DocumentRepository(database),uploads=new SharePointDocumentUploadService(documents,graph,clientId);
const templates=new DocumentTemplateGenerationRepository(database),generation=new DocumentTemplateGenerationService(templates,documents,uploads,graph);

try{
  const business=await database.withContext({tenantId:context.tenantId,userId:context.userId},async client=>(await client.query<{unit_id:string;party_id:string}>(`
    SELECT u.id unit_id,p.id party_id FROM units u
    JOIN party_project_links link ON link.tenant_id=u.tenant_id AND link.project_id=u.project_id AND link.valid_to IS NULL
    JOIN parties p ON p.tenant_id=link.tenant_id AND p.id=link.party_id AND p.archived_at IS NULL
    WHERE u.tenant_id=$1 AND u.project_id=$2 AND u.archived_at IS NULL ORDER BY u.code,p.display_name LIMIT 1`,[context.tenantId,projectId])).rows[0]);
  if(!business)throw new Error("smoke business context unavailable");
  const sourceBytes=technicalTemplate();const source=await uploads.upload({...context,projectId,idempotencyKey:`docx-smoke-source-${release}`,typeCode:"other",
    documentName:`TECHNICKÁ DOCX ŠABLONA ${release}`,fileName:`technical-docx-template-${release}.docx`,mimeType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    bytes:sourceBytes,versionLabel:"template-v1",status:"draft",note:"Technický smoke-test artefakt",unitId:business.unit_id,partyId:business.party_id});
  const registered=await generation.register({...context,projectId,code:`technical-${release}`,name:"Technické ověření generování",outputTypeCode:"other",versionLabel:"v1",
    sourceDocumentId:source.documentId,sourceDocumentVersionId:source.documentVersionId,schema:{fields:{"project.name":{required:true},"project.code":{required:true},
      "unit.code":{required:true},"buyer.name":{required:true},"generation.date":{required:true},"unit.totalPrice":{required:true}}},approvalStatus:"approved"});
  const request={...context,projectId,templateVersionId:registered.templateVersionId,idempotencyKey:`docx-smoke-generation-${release}`,unitId:business.unit_id,partyId:business.party_id,documentName:`TECHNICKÝ GENEROVANÝ DOCX ${release}`};
  const first=await generation.generate(request),second=await generation.generate(request);
  if(first.documentId!==second.documentId||first.documentVersionId!==second.documentVersionId||!second.replayed)throw new Error("generation retry created a duplicate");
  const detail=await documents.getById({...context,documentId:first.documentId!});if(!detail?.externalDriveId||!detail.externalItemId)throw new Error("generated SharePoint binding missing");
  const connection=await documents.getConnectionForUpload({...context,projectId});if(!connection)throw new Error("SharePoint connection missing");
  const generatedBytes=await graph.downloadFile({siteId:connection.siteId,driveId:connection.driveId},detail.externalItemId,detail.versions[0]?.externalVersionId??undefined);
  const archive=unzipSync(generatedBytes),inspection=inspectDocxTemplate(generatedBytes),xml=strFromU8(archive["word/document.xml"]??new Uint8Array());
  if(inspection.tokens.length||!archive["[Content_Types].xml"]||!archive["_rels/.rels"]||!xml.includes("Hrdlička")&&!xml.includes("Rezidence"))throw new Error("generated DOCX validation failed");
  console.log(JSON.stringify({ok:true,sourceStored:Boolean(source.itemId),templateHashStored:true,snapshotStored:true,generatedStored:Boolean(detail.externalItemId),
    noUnresolvedPlaceholders:inspection.tokens.length===0,idempotentReplay:second.replayed,sameDocument:first.documentId===second.documentId,sameVersion:first.documentVersionId===second.documentVersionId,
    docxParts:Object.keys(archive).length,contentBytes:generatedBytes.byteLength}));
}finally{await database.close();}

function technicalTemplate():Uint8Array{
  const contentTypes=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
  const rels=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  const lines=[["Projekt","{{project.name}}"],["Kód projektu","{{project.code}}"],["Jednotka","{{unit.code}}"],["Klient","{{buyer.name}}"],["Datum generování","{{generation.date}}"],["Aktuální cena","{{unit.totalPrice}}"]];
  const paragraphs=lines.map(([label,value])=>`<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>${label}: </w:t></w:r><w:r><w:t>${value}</w:t></w:r></w:p>`).join("");
  const document=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:b/><w:sz w:val="32"/></w:rPr><w:t>Technické ověření generování dokumentu</w:t></w:r></w:p>${paragraphs}<w:p><w:r><w:t>Nejde o smlouvu ani jiný právní dokument.</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1224" w:right="1296" w:bottom="1224" w:left="1296"/></w:sectPr></w:body></w:document>`;
  return zipSync({"[Content_Types].xml":strToU8(contentTypes),"_rels/.rels":strToU8(rels),"word/document.xml":strToU8(document)},{level:6});
}
function required(name:string):string{const value=process.env[name]?.trim();if(!value)throw new Error(`missing ${name}`);return value;}

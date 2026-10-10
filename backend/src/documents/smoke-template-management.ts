import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { Database } from "../database.js";
import { inspectDocxTemplate } from "./docx-template.js";
import { EntraMicrosoftGraphAdapter } from "./graph-adapter.js";
import { ManagedIdentityGraphTokenProvider } from "./managed-identity-token-provider.js";
import { DocumentRepository, type DocumentContext } from "./repository.js";
import { DocumentTemplateGenerationRepository } from "./template-generation-repository.js";
import { DocumentTemplateManagementRepository } from "./template-management-repository.js";
import { DocumentTemplateManagementService } from "./template-management-service.js";
import { SharePointDocumentUploadService } from "./upload-service.js";

const databaseUrl = required("DATABASE_URL");
const clientId = required("SHAREPOINT_MANAGED_IDENTITY_CLIENT_ID");
const context: DocumentContext = {
  tenantId: required("TEMPLATE_SMOKE_TENANT_ID"),
  userId: required("TEMPLATE_SMOKE_USER_ID"),
  membershipId: required("TEMPLATE_SMOKE_MEMBERSHIP_ID"),
};
const projectId = required("TEMPLATE_SMOKE_PROJECT_ID");
const release = safeRelease(required("TEMPLATE_SMOKE_RELEASE"));
const correlationId = `template-management-smoke-${release}`;
const database = new Database(databaseUrl);
const graph = new EntraMicrosoftGraphAdapter(new ManagedIdentityGraphTokenProvider(clientId));
const documents = new DocumentRepository(database);
const uploads = new SharePointDocumentUploadService(documents, graph, clientId);
const management = new DocumentTemplateManagementService(
  new DocumentTemplateManagementRepository(database),
  new DocumentTemplateGenerationRepository(database),
  documents,
  uploads,
  graph,
);

try {
  const request = {
    ...context,
    correlationId,
    projectId,
    code: "technical-template-management-smoke",
    name: "TECHNICKÁ KONTROLA SPRÁVY ŠABLON",
    outputTypeCode: "other",
    variantKey: "smoke",
    versionLabel: release,
    effectiveFrom: new Date().toISOString().slice(0, 10),
    fileName: `technical-template-management-${release}.docx`,
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    bytes: technicalTemplate(),
  };
  const first = await management.upload(request);
  const replay = await management.upload(request);
  if (!replay.replayed || replay.templateVersionId !== first.templateVersionId) throw new Error("template upload replay created a duplicate version");

  const validation = await management.validate({ ...context, correlationId, templateId: first.templateId, versionId: first.templateVersionId });
  if (!validation.valid) throw new Error(`template validation failed: ${validation.errors.join(",")}`);
  await management.validate({ ...context, correlationId, templateId: first.templateId, versionId: first.templateVersionId });

  const preview = await management.preview({ ...context, templateId: first.templateId, versionId: first.templateVersionId });
  const archive = unzipSync(preview);
  const xml = strFromU8(archive["word/document.xml"] ?? new Uint8Array());
  if (inspectDocxTemplate(preview).tokens.length || !xml.includes("Technický test projektu") || !xml.includes("Petr Testovací")) throw new Error("synthetic preview validation failed");

  await management.approve({ ...context, correlationId, templateId: first.templateId, versionId: first.templateVersionId });
  await management.approve({ ...context, correlationId, templateId: first.templateId, versionId: first.templateVersionId });
  const approved = (await management.list({ ...context, templateId: first.templateId }))[0]?.versions.find((version) => version.id === first.templateVersionId);
  if (approved?.status !== "approved") throw new Error("template version was not approved");

  await management.retire({ ...context, correlationId, templateId: first.templateId, versionId: first.templateVersionId });
  await management.retire({ ...context, correlationId, templateId: first.templateId, versionId: first.templateVersionId });
  const retired = (await management.list({ ...context, templateId: first.templateId }))[0]?.versions.find((version) => version.id === first.templateVersionId);
  if (retired?.status !== "retired") throw new Error("template version was not retired");
  await documents.archive({ ...context, documentId: retired.sourceDocumentId, reason: "Úklid technického smoke-test artefaktu správy šablon" });

  console.log(JSON.stringify({
    ok: true,
    uploadedToSharePoint: Boolean(retired.itemId),
    idempotentUpload: replay.replayed,
    validated: validation.valid,
    syntheticPreview: true,
    approved: approved.status === "approved",
    retired: retired.status === "retired",
    sourceArchivedInCrm: true,
    unresolvedPlaceholders: inspectDocxTemplate(preview).tokens.length,
  }));
} finally {
  await database.close();
}

function technicalTemplate(): Uint8Array {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  const tokens = ["project.name", "project.code", "unit.code", "buyer.name", "generation.date", "unit.totalPrice"];
  const paragraphs = tokens.map((token) => `<w:p><w:r><w:t>{{${token}}}</w:t></w:r></w:p>`).join("");
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>TECHNICKÝ TEST SPRÁVY ŠABLON</w:t></w:r></w:p>${paragraphs}<w:p><w:r><w:t>Nejde o smlouvu ani jiný právní dokument.</w:t></w:r></w:p></w:body></w:document>`;
  return zipSync({ "[Content_Types].xml": strToU8(contentTypes), "_rels/.rels": strToU8(rels), "word/document.xml": strToU8(document) }, { level: 6 });
}

function safeRelease(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!normalized || normalized.length > 64) throw new Error("invalid TEMPLATE_SMOKE_RELEASE");
  return normalized;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

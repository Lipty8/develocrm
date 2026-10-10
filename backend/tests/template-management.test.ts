import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { PGlite } from "@electric-sql/pglite";
import { inspectDocxTemplate } from "../src/documents/docx-template.js";
import { TECHNICAL_PLACEHOLDERS } from "../src/documents/template-catalog.js";
import { DocumentTemplateManagementService, TemplateManagementError } from "../src/documents/template-management-service.js";
import type { TemplateValidationReport, TemplateView } from "../src/documents/template-management-repository.js";

const context = {
  tenantId: "10000000-0000-4000-8000-000000000001",
  userId: "20000000-0000-4000-8000-000000000001",
  membershipId: "30000000-0000-4000-8000-000000000001",
};
const projectId = "40000000-0000-4000-8000-000000000001";
const templateId = "50000000-0000-4000-8000-000000000001";
const versionId = "60000000-0000-4000-8000-000000000001";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function docx(tokens: readonly string[] = TECHNICAL_PLACEHOLDERS): Uint8Array {
  const text = tokens.map((token) => `{{${token}}}`).join(" | ");
  return zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "word/document.xml": strToU8(`<w:document xmlns:w="x"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`),
  });
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function template(source: Uint8Array, status: "draft" | "validated" | "approved" | "retired" = "draft"): TemplateView {
  const validation: TemplateValidationReport = {
    valid: true,
    tokens: [...TECHNICAL_PLACEHOLDERS].sort(),
    unknownTokens: [],
    missingTokens: [],
    malformedTokens: [],
    legacyMarkers: [],
    errors: [],
  };
  return {
    id: templateId,
    projectId,
    projectName: "Technický projekt",
    code: "technical-template",
    name: "Technická šablona",
    outputTypeCode: "other",
    contractType: null,
    variantKey: "default",
    status: "active",
    canManage: true,
    canApprove: true,
    versions: [{
      id: versionId,
      versionLabel: "v1",
      contentHash: sha256(source),
      schema: { fields: Object.fromEntries(TECHNICAL_PLACEHOLDERS.map((token) => [token, { required: true }])) },
      status,
      effectiveFrom: "2026-10-10",
      validation,
      createdAt: "2026-10-10T10:00:00.000Z",
      validatedAt: status === "draft" ? null : "2026-10-10T10:01:00.000Z",
      approvedAt: status === "approved" ? "2026-10-10T10:02:00.000Z" : null,
      retiredAt: status === "retired" ? "2026-10-10T10:03:00.000Z" : null,
      actor: "Tester",
      sourceDocumentId: "70000000-0000-4000-8000-000000000001",
      sourceDocumentVersionId: "70000000-0000-4000-8000-000000000002",
      sourceWebUrl: "https://example.test/template.docx",
      sourceFileName: "template.docx",
      externalVersionId: "1.0",
      driveId: "drive",
      itemId: "item",
    }],
  };
}

function harness(source = docx()) {
  let uploadCalls = 0;
  const idempotencyKeys: string[] = [];
  const validations: TemplateValidationReport[] = [];
  const created: Array<Record<string, unknown>> = [];
  const repository = {
    list: async () => [template(source)],
    assertUploadAllowed: async () => undefined,
    createDraft: async (input: Record<string, unknown>) => {
      created.push(input);
      return { templateId, templateVersionId: versionId, replayed: false };
    },
    auditFailure: async () => undefined,
    recordValidation: async (input: { validation: TemplateValidationReport }) => { validations.push(input.validation); },
    approve: async () => undefined,
    retire: async () => undefined,
  };
  const generationRepository = {
    sourceForRegistration: async () => ({
      projectId,
      driveId: "drive",
      itemId: "item",
      externalVersionId: "1.0",
      contentHash: sha256(source),
    }),
  };
  const documents = { getConnectionForUpload: async () => ({ siteId: "site", driveId: "drive" }) };
  const uploads = {
    upload: async (input: { idempotencyKey: string }) => {
      uploadCalls += 1;
      idempotencyKeys.push(input.idempotencyKey);
      return {
        documentId: "70000000-0000-4000-8000-000000000001",
        documentVersionId: "70000000-0000-4000-8000-000000000002",
        replayed: uploadCalls > 1,
      };
    },
  };
  const graph = { downloadFile: async () => source };
  const service = new DocumentTemplateManagementService(repository as never, generationRepository as never, documents as never, uploads as never, graph as never);
  return {
    service,
    repository,
    graph,
    get uploadCalls() { return uploadCalls; },
    idempotencyKeys,
    validations,
    created,
  };
}

function uploadInput(bytes = docx()) {
  return {
    ...context,
    projectId,
    code: "technical-template",
    name: "Technická šablona",
    outputTypeCode: "other",
    variantKey: "default",
    versionLabel: "v1",
    effectiveFrom: "2026-10-10",
    fileName: "template.docx",
    mimeType: DOCX_MIME,
    bytes,
  };
}

test("upload používá existující dokumentový upload, uložený hash a stabilní idempotency key", async () => {
  const h = harness();
  const first = await h.service.upload(uploadInput());
  const second = await h.service.upload(uploadInput());
  assert.equal(first.validation.valid, true);
  assert.equal(second.validation.valid, true);
  assert.equal(h.uploadCalls, 2);
  assert.equal(h.idempotencyKeys[0], h.idempotencyKeys[1]);
  assert.equal(h.created.length, 2);
  assert.equal(h.created[0].contentHash, sha256(docx()));
});

test("upload bezpečně odmítne poškozený DOCX ještě před zápisem do SharePointu", async () => {
  const h = harness();
  await assert.rejects(h.service.upload(uploadInput(strToU8("not-a-docx"))));
  assert.equal(h.uploadCalls, 0);
});

test("validace vrátí chybějící a neznámá pole a nepovolí schválení přes preview", async () => {
  const source = docx(["project.name", "unknown.value"]);
  const h = harness(source);
  await h.service.validate({ ...context, templateId, versionId });
  const report = h.validations[0];
  assert.equal(report.valid, false);
  assert.deepEqual(report.unknownTokens, ["unknown.value"]);
  assert.ok(report.missingTokens.includes("unit.code"));
  await assert.rejects(
    h.service.preview({ ...context, templateId, versionId }),
    (error: unknown) => error instanceof TemplateManagementError && error.code === "template_not_valid",
  );
});

test("syntetický náhled doplní všechna pole bez vzniku business dokumentu", async () => {
  const source = docx();
  const h = harness(source);
  const preview = await h.service.preview({ ...context, templateId, versionId });
  assert.deepEqual(inspectDocxTemplate(preview).tokens, []);
  const xml = strFromU8(unzipSync(preview)["word/document.xml"]);
  assert.match(xml, /Technický test projektu/);
  assert.match(xml, /T-101/);
  assert.match(xml, /Petr Testovací/);
  assert.equal(h.uploadCalls, 0);
  assert.equal(h.created.length, 0);
});

test("změna bajtů zdrojové verze je odhalena hashem při nové validaci", async () => {
  const original = docx();
  const h = harness(original);
  h.repository.list = async () => [template(original)];
  h.graph.downloadFile = async () => docx([...TECHNICAL_PLACEHOLDERS].reverse());
  await h.service.validate({ ...context, templateId, versionId });
  assert.equal(h.validations[0].valid, false);
  assert.ok(h.validations[0].errors.includes("content_hash_mismatch"));
});

test("repository a migrace vynucují projektová oprávnění, lifecycle a neměnnost", async () => {
  const repository = await readFile(new URL("../src/documents/template-management-repository.ts", import.meta.url), "utf8");
  const migration = await readFile(new URL("../migrations/0054_document_template_management.sql", import.meta.url), "utf8");
  assert.match(repository, /documents\.view/);
  assert.match(repository, /documents\.upload/);
  assert.match(repository, /documents\.review/);
  assert.match(repository, /correlationId:input\.correlationId/);
  assert.match(repository, /document_template\.created/);
  assert.match(repository, /existing\.output_type_code=EXCLUDED\.output_type_code/);
  assert.match(repository, /existing\.contract_type IS NOT DISTINCT FROM EXCLUDED\.contract_type/);
  assert.match(repository, /t\.tenant_id=\$1/);
  assert.match(repository, /t\.project_id=\$3/);
  assert.match(migration, /draft','validated','approved','retired/);
  assert.match(migration, /document_template_versions_one_approved_uq/);
  assert.match(migration, /document template version content is immutable/);
  assert.match(migration, /invalid document template lifecycle transition/);
  assert.match(migration, /validated_by_membership_id/);
  assert.match(migration, /retired_by_membership_id/);
});

test("databáze dovolí pouze řízený lifecycle a schválený obsah zůstane neměnný", async () => {
  const db = new PGlite();
  const migrations = (await readdir(new URL("../migrations/", import.meta.url))).filter((name) => name.endsWith(".sql")).sort();
  for (const name of migrations) await db.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  const tenant = "81000000-0000-4000-8000-000000000001";
  const user = "82000000-0000-4000-8000-000000000001";
  const membership = "83000000-0000-4000-8000-000000000001";
  const project = "84000000-0000-4000-8000-000000000001";
  const document = "85000000-0000-4000-8000-000000000001";
  const documentVersion = "86000000-0000-4000-8000-000000000001";
  const template = "87000000-0000-4000-8000-000000000001";
  const templateVersion = "88000000-0000-4000-8000-000000000001";
  await db.query("INSERT INTO tenants(id,name,slug,status) VALUES($1,'Template lifecycle','template-lifecycle','active')", [tenant]);
  await db.query("INSERT INTO users(id,entra_issuer,entra_subject,email,display_name) VALUES($1,'test','template-user','template@example.test','Template User')", [user]);
  await db.query("INSERT INTO tenant_memberships(id,tenant_id,user_id,status,accepted_at) VALUES($1,$2,$3,'active',now())", [membership, tenant, user]);
  await db.query("INSERT INTO projects(id,tenant_id,code,name,slug,lifecycle_status) VALUES($1,$2,'TPL','Template projekt','template-project','active')", [project, tenant]);
  await db.query(`INSERT INTO documents(id,tenant_id,project_id,name,category,mime_type,storage_provider,external_drive_id,external_item_id,created_by_membership_id,document_type_id)
    SELECT $1,$2,$3,'Zdroj šablony','other',$4,'sharepoint','drive','item',$5,id FROM document_types WHERE tenant_id=$2 AND code='other'`, [document, tenant, project, DOCX_MIME, membership]);
  await db.query(`INSERT INTO document_versions(id,tenant_id,project_id,document_id,version_identifier,external_version_id,version_label,created_by_membership_id)
    VALUES($1,$2,$3,$4,'source-v1','1.0','v1',$5)`, [documentVersion, tenant, project, document, membership]);
  await db.query(`INSERT INTO document_templates(id,tenant_id,project_id,code,name,output_type_code,variant_key,created_by_membership_id)
    VALUES($1,$2,$3,'technical-lifecycle','Technická šablona','other','default',$4)`, [template, tenant, project, membership]);
  await db.query(`INSERT INTO document_template_versions(id,tenant_id,project_id,template_id,source_document_id,source_document_version_id,version_label,content_hash,placeholder_schema,approval_status,effective_from,created_by_membership_id)
    VALUES($1,$2,$3,$4,$5,$6,'v1',$7,'{"fields":{"project.name":{"required":true}}}','draft',CURRENT_DATE,$8)`, [templateVersion, tenant, project, template, document, documentVersion, `sha256:${"a".repeat(64)}`, membership]);
  const validation = { valid: true, tokens: ["project.name"], unknownTokens: [], missingTokens: [], malformedTokens: [], legacyMarkers: [], errors: [] };
  await db.query("UPDATE document_template_versions SET validation_result=$1,approval_status='validated',validated_at=now(),validated_by_membership_id=$2 WHERE id=$3", [validation, membership, templateVersion]);
  await db.query("UPDATE document_template_versions SET approval_status='approved',approved_at=now(),approved_by_membership_id=$1 WHERE id=$2", [membership, templateVersion]);
  await assert.rejects(db.query("UPDATE document_template_versions SET content_hash=$1 WHERE id=$2", [`sha256:${"b".repeat(64)}`, templateVersion]), /content is immutable/);
  await db.query("UPDATE document_template_versions SET approval_status='retired',retired_at=now(),retired_by_membership_id=$1 WHERE id=$2", [membership, templateVersion]);
  await assert.rejects(db.query("UPDATE document_template_versions SET approval_status='approved',retired_at=NULL,retired_by_membership_id=NULL WHERE id=$1", [templateVersion]), /invalid document template lifecycle transition/);
  await db.close();
});

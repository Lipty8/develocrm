import assert from "node:assert/strict";
import test from "node:test";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { DocxTemplateError, inspectDocxTemplate, renderDocxTemplate } from "../src/documents/docx-template.js";

function docx(body: string, header = ""): Uint8Array {
  return zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "word/document.xml": strToU8(`<w:document xmlns:w="x"><w:body>${body}</w:body></w:document>`),
    ...(header ? { "word/header1.xml": strToU8(`<w:hdr xmlns:w="x">${header}</w:hdr>`) } : {}),
  });
}

function text(bytes: Uint8Array, part = "word/document.xml"): string {
  return strFromU8(unzipSync(bytes)[part]);
}

test("inspekce najde token rozdělený mezi Word runs i token v hlavičce", () => {
  const template = docx(
    "<w:p><w:r><w:t>{{project.</w:t></w:r><w:r><w:t>name}}</w:t></w:r></w:p>",
    "<w:p><w:r><w:t>{{contract.reference}}</w:t></w:r></w:p>",
  );
  assert.deepEqual(inspectDocxTemplate(template).tokens, ["contract.reference", "project.name"]);
});

test("renderer nahradí split tokeny, escapuje XML a zachová DOCX části", () => {
  const template = docx(
    "<w:p><w:r><w:t>Projekt {{project.</w:t></w:r><w:r><w:t>name}} / {{unit.code}}</w:t></w:r></w:p>",
    "<w:p><w:r><w:t>Smlouva {{contract.reference}}</w:t></w:r></w:p>",
  );
  const result = renderDocxTemplate(template, {
    "project.name": "Dům A & B",
    "unit.code": "417",
    "contract.reference": "RS-2026-001",
  }, {
    requiredTokens: ["project.name", "unit.code", "contract.reference"],
    allowedTokens: ["project.name", "unit.code", "contract.reference"],
  });

  assert.match(text(result.bytes), /Dům A &amp; B/);
  assert.match(text(result.bytes), /417/);
  assert.match(text(result.bytes, "word/header1.xml"), /RS-2026-001/);
  assert.deepEqual(inspectDocxTemplate(result.bytes).tokens, []);
  assert.deepEqual(result.usedTokens, ["contract.reference", "project.name", "unit.code"]);
});

test("renderer odmítne prázdnou hodnotu a uvede chybějící pole", () => {
  const template = docx("<w:p><w:r><w:t>{{buyer.name}}</w:t></w:r></w:p>");
  assert.throws(
    () => renderDocxTemplate(template, { "buyer.name": " " }),
    (error: unknown) => error instanceof DocxTemplateError
      && error.code === "template_value_missing"
      && error.details[0] === "buyer.name",
  );
});

test("renderer odmítne neschválený token", () => {
  const template = docx("<w:p><w:r><w:t>{{internal.secret}}</w:t></w:r></w:p>");
  assert.throws(
    () => renderDocxTemplate(template, { "internal.secret": "x" }, { allowedTokens: ["project.name"] }),
    (error: unknown) => error instanceof DocxTemplateError && error.code === "unknown_template_token",
  );
});

test("renderer odmítne staré ruční značky i neparametrizovanou šablonu", () => {
  const legacy = docx("<w:p><w:r><w:t>{{project.name}} [•]</w:t></w:r></w:p>");
  assert.throws(
    () => renderDocxTemplate(legacy, { "project.name": "Hrdlička" }),
    (error: unknown) => error instanceof DocxTemplateError && error.code === "legacy_placeholders_present",
  );
  const plain = docx("<w:p><w:r><w:t>Bez polí</w:t></w:r></w:p>");
  assert.throws(
    () => renderDocxTemplate(plain, {}),
    (error: unknown) => error instanceof DocxTemplateError && error.code === "template_not_parameterized",
  );
});

test("renderer ověří, že šablona obsahuje všechna povinná pole", () => {
  const template = docx("<w:p><w:r><w:t>{{project.name}}</w:t></w:r></w:p>");
  assert.throws(
    () => renderDocxTemplate(template, { "project.name": "Hrdlička" }, { requiredTokens: ["project.name", "seller.companyId"] }),
    (error: unknown) => error instanceof DocxTemplateError
      && error.code === "required_token_missing_from_template"
      && error.details[0] === "seller.companyId",
  );
});

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

const mailOptions = { allowedTokens: ['seller.email'], mailToTokens: ['seller.email'] };
const mailbox = { 'seller.email': 'novy.prodavajici+rs@example.test' };
const mailLink = '<w:hyperlink r:id="rIdMail"><w:r><w:t>{{seller.</w:t></w:r><w:r><w:t>email}}</w:t></w:r></w:hyperlink>';
const relsPath = 'word/_rels/document.xml.rels';
function linkedDocx(body = mailLink, target = 'mailto:old@example.test'): Uint8Array {
  const archive = unzipSync(docx(`<w:p>${body}</w:p>`));
  archive[relsPath] = strToU8(`<Relationships><Relationship Id="rIdMail" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" TargetMode="External" Target="${target}"/><Relationship Id="rIdOther" Type="other" Target="styles.xml"/></Relationships>`);
  return zipSync(archive);
}
function emailField(instruction = 'HYPERLINK &quot;mailto:old@example.test&quot;', nested = ''): string {
  return `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>${instruction}</w:instrText></w:r>`
    + `<w:r><w:fldChar w:fldCharType="separate"/></w:r>${nested}<w:r><w:t>{{seller.email}}</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;
}

test('mailbox rendering is opt-in; default renderer still leaves relationships untouched', () => {
  const source = linkedDocx();
  const plain = renderDocxTemplate(source, mailbox).bytes;
  assert.equal(text(plain, relsPath), text(source, relsPath));
  const result = renderDocxTemplate(source, mailbox, mailOptions).bytes;
  assert.match(text(result), /novy.prodavajici\+rs@example.test/);
  assert.equal(text(result, relsPath), text(source, relsPath).replace('mailto:old@example.test', 'mailto:novy.prodavajici+rs@example.test'));
  // Input bytes are never mutated, and identical inputs produce identical output.
  assert.match(text(source, relsPath), /mailto:old@example.test/);
  assert.deepEqual(result, renderDocxTemplate(source, mailbox, mailOptions).bytes);
});

test('identical snapshot and source yield identical DOCX bytes across retry clocks', context => {
  const source = linkedDocx();
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-21T00:00:00Z') });
  const first = renderDocxTemplate(source, mailbox, mailOptions).bytes;
  context.mock.timers.tick(27 * 60 * 60 * 1000);
  const retried = renderDocxTemplate(source, mailbox, mailOptions).bytes;
  assert.deepEqual(retried, first);
  assert.equal(text(retried, relsPath), text(first, relsPath));
  assert.notDeepEqual(renderDocxTemplate(source, { 'seller.email': 'changed@example.test' }, mailOptions).bytes, first);
});

test('Word complex and simple email fields update only the instruction target and display text', () => {
  for (const body of [emailField(), '<w:fldSimple w:instr="HYPERLINK &quot;mailto:old@example.test&quot;"><w:r><w:t>{{seller.email}}</w:t></w:r></w:fldSimple>']) {
    const source = docx(`<w:p>${body}</w:p><w:p><w:r><w:instrText>PAGE</w:instrText></w:r><w:r><w:t>1</w:t></w:r></w:p>`);
    const result = renderDocxTemplate(source, mailbox, mailOptions).bytes;
    assert.doesNotMatch(text(result), /old@example.test/);
    assert.equal(text(result).split('novy.prodavajici+rs@example.test').length - 1, 2);
    assert.match(text(result), /<w:instrText>PAGE<\/w:instrText>/);
    assert.deepEqual(inspectDocxTemplate(result).tokens, []);
  }
});

test('split Word instructions and split visible tokens remain supported', () => {
  const body = emailField().replace('HYPERLINK &quot;mailto:old@example.test&quot;', 'HYPER</w:instrText></w:r><w:r><w:instrText>LINK &quot;mailto:old@example.test&quot;')
    .replace('{{seller.email}}', '{{seller.</w:t></w:r><w:r><w:t>email}}');
  const result = renderDocxTemplate(docx(`<w:p>${body}</w:p>`), mailbox, mailOptions).bytes;
  assert.match(text(result), /HYPERLINK &quot;mailto:novy.prodavajici\+rs@example.test&quot;/);
  assert.doesNotMatch(text(result), /old@example.test/);
});

test('unsafe mailboxes, URL injection and ambiguous links fail without leaking addresses', () => {
  for (const value of ['https://example.test', 'a@example.test?bcc=other@example.test', 'a%0D%0ABcc@evil.test', 'a\r\n@evil.test', 'a@example.test" \\t "x', 'a@example.test,b@example.test']) {
    assert.throws(() => renderDocxTemplate(linkedDocx(), { 'seller.email': value }, mailOptions),
      (error: unknown) => error instanceof DocxTemplateError && error.code === 'unsafe_template_link'
        && error.details.join() === 'seller.email' && !error.message.includes(value));
  }
  const unsafe = [
    linkedDocx(mailLink, 'https://example.test'),
    linkedDocx(mailLink + '<w:hyperlink r:id="rIdMail"><w:r><w:t>Other</w:t></w:r></w:hyperlink>'),
    linkedDocx(mailLink.replace('</w:hyperlink>', '<w:r><w:t> suffix</w:t></w:r></w:hyperlink>')),
    docx(`<w:p>${mailLink}</w:p>`),
    docx(`<w:p>${emailField('INCLUDETEXT &quot;file:///secret&quot;')}</w:p>`),
    docx(`<w:p>${emailField('HYPERLINK &quot;mailto:old@example.test&quot; \\t &quot;x&quot;')}</w:p>`),
    docx(`<w:p>${emailField(undefined, '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>')}</w:p>`),
  ];
  for (const source of unsafe) assert.throws(() => renderDocxTemplate(source, mailbox, mailOptions),
    (error: unknown) => error instanceof DocxTemplateError && error.code === 'unsafe_template_link');
});

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

test("inspekce odmítne nebezpečnou ZIP cestu", () => {
  const unsafe = zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "word/document.xml": strToU8('<w:document xmlns:w="x"><w:body/></w:document>'),
    "../outside.xml": strToU8("unsafe"),
  });
  assert.throws(
    () => inspectDocxTemplate(unsafe),
    (error: unknown) => error instanceof DocxTemplateError && error.code === "unsafe_docx_archive",
  );
});

test("inspekce rozliší poškozený zápis pole od platného tokenu", () => {
  const template = docx("<w:p><w:r><w:t>{{project.name}} {{buyer.name}</w:t></w:r></w:p>");
  const inspection = inspectDocxTemplate(template);
  assert.deepEqual(inspection.tokens, ["project.name"]);
  assert.deepEqual(inspection.malformedTokens, ["{{buyer.name"]);
  assert.throws(
    () => renderDocxTemplate(template, { "project.name": "Hrdlička" }),
    (error: unknown) => error instanceof DocxTemplateError && error.code === "malformed_template_token",
  );
});

test("inspekce odmítne neúplnou DOCX strukturu", () => {
  const incomplete = zipSync({ "word/document.xml": strToU8("<w:document/>") });
  assert.throws(
    () => inspectDocxTemplate(incomplete),
    (error: unknown) => error instanceof DocxTemplateError && error.code === "invalid_docx",
  );
});

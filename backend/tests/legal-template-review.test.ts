import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {strFromU8, unzipSync} from 'fflate';
import {DocxTemplateError, inspectDocxTemplate, renderDocxTemplate} from '../src/documents/docx-template.js';

type Manifest = {
  contractType: string; status: string; activationAllowed: boolean; sampleIsSynthetic: boolean;
  sourceSha256: string; templateSha256: string;
  sourceStructureSha256: string; sourceParagraphTextSha256: string[];
  preserveOnlyParts: Record<string, string>;
  schema: {fields: Record<string, {required: boolean}>}; sampleValues: Record<string, string>;
  slots: {paragraph: number; original: string; replacement: string; key: string | null}[];
  scope: {staticProjectLegalFactsPinnedToSource: boolean; buyerIdentifier: string; accessoryVariant: string}; knownGates: string[];
};
const expectedSources = {
  rs: 'b57cfd799b64e79641c6cc78684cbfd053f14439102447d09e08d83e3af721bd',
  sbk: 'bc79743f8c9561a51f015a02a8a083416a3b12d32918875f2a974bce2a22c160',
};
const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const decode = (text: string) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const paragraphs = (xml: string) => [...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)]
  .map(p => [...p[0].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(t => decode(t[1])).join(''));
const structure = (xml: string) => xml.replace(/(<w:t(?:\s[^>]*)?>)[\s\S]*?(<\/w:t>)/g, '$1$2');

for (const kind of ['rs', 'sbk'] as const) {
  const base = new URL('../templates/review/', import.meta.url);
  const load = async () => ({
    manifest: JSON.parse(await readFile(new URL(`${kind}-review-manifest.json`, base), 'utf8')) as Manifest,
    bytes: await readFile(new URL(`${kind}-dejvice-original-review.docx`, base)),
  });

  test(`${kind}: původ, přesné schema a neaktivní stav návrhu`, async () => {
    const {manifest: m, bytes} = await load();
    assert.equal(m.sourceSha256, expectedSources[kind]);
    assert.equal(digest(bytes), m.templateSha256);
    assert.equal(m.status, 'draft');
    assert.equal(m.activationAllowed, false);
    assert.equal(m.sampleIsSynthetic, true);
    assert.equal(m.scope.staticProjectLegalFactsPinnedToSource, true);
    assert.equal(m.scope.buyerIdentifier, 'date_of_birth');
    assert.equal(m.scope.accessoryVariant, 'all_source_accessories_present');
    assert.ok(!m.knownGates.includes('birth_number_policy'));
    assert.equal(m.schema.fields['buyer.birthNumber'], undefined);
    assert.equal(m.schema.fields['buyer.birthDate']?.required, true);
    assert.ok(m.knownGates.includes('runtime_field_mapping'));
    assert.ok(m.knownGates.includes('content_review'));
    const inspection = inspectDocxTemplate(bytes);
    assert.deepEqual(inspection.tokens, Object.keys(m.schema.fields).sort());
    assert.deepEqual(inspection.malformedTokens, []);
    assert.deepEqual(inspection.legacyMarkers, []);
    assert.equal(inspection.tokens.length, kind === 'rs' ? 32 : 37);
  });

  test(`${kind}: nezměněné styly, vztahy, obrázky, číslování a všechny ostatní části`, async () => {
    const {manifest: m, bytes} = await load();
    const archive = unzipSync(bytes);
    assert.deepEqual(Object.keys(archive).sort(), Object.keys(m.preserveOnlyParts).sort());
    for (const [name, hash] of Object.entries(m.preserveOnlyParts)) {
      if (name !== 'word/document.xml') assert.equal(digest(archive[name]), hash, name);
    }
    assert.equal(digest(structure(strFromU8(archive['word/document.xml']))), m.sourceStructureSha256);
  });

  test(`${kind}: po vrácení přesných polí je každý odstavec totožný s originálem`, async () => {
    const {manifest: m, bytes} = await load();
    const texts = paragraphs(strFromU8(unzipSync(bytes)['word/document.xml']));
    assert.equal(texts.length, m.sourceParagraphTextSha256.length);
    for (let i = 0; i < texts.length; i++) {
      let restored = texts[i];
      for (const slot of m.slots.filter(s => s.paragraph === i)) {
        assert.equal(restored.split(slot.replacement).length, 2, `unique review slot ${i}`);
        restored = restored.replace(slot.replacement, slot.original);
      }
      assert.equal(digest(restored), m.sourceParagraphTextSha256[i], `source paragraph ${i}`);
    }
    assert.deepEqual(m.slots.filter(s => s.key === null).map(s => [s.original, s.replacement]), [['RČ', 'Datum narození']]);
  });

  test(`${kind}: existující renderer doplní všechna pole bez změny ostatního textu`, async () => {
    const {manifest: m, bytes} = await load();
    const fields = Object.keys(m.schema.fields);
    const rendered = renderDocxTemplate(bytes, m.sampleValues, {allowedTokens: fields, requiredTokens: fields});
    assert.deepEqual(inspectDocxTemplate(rendered.bytes).tokens, []);
    const before = strFromU8(unzipSync(bytes)['word/document.xml']);
    const after = strFromU8(unzipSync(rendered.bytes)['word/document.xml']);
    assert.deepEqual(paragraphs(after), paragraphs(before).map(p => p.replace(/{{([A-Za-z][A-Za-z0-9_.-]*)}}/g, (_, key: string) => m.sampleValues[key])));
    assert.equal(structure(after), structure(before));
    assert.match(paragraphs(after).join('\n'), /Datum narození1\. 1\. 1990/);
    assert.doesNotMatch(paragraphs(after).join('\n'), /TEST NENÍ RČ|buyer\.birthNumber/);
  });

  test(`${kind}: chybějící hodnota ani nepovolené pole nesmějí projít`, async () => {
    const {manifest: m, bytes} = await load();
    const fields = Object.keys(m.schema.fields);
    assert.throws(() => renderDocxTemplate(bytes, {...m.sampleValues, 'buyer.name': ''}, {allowedTokens: fields, requiredTokens: fields}),
      (error: unknown) => error instanceof DocxTemplateError && error.code === 'template_value_missing');
    assert.throws(() => renderDocxTemplate(bytes, m.sampleValues, {allowedTokens: fields.filter(f => f !== 'buyer.name')}),
      (error: unknown) => error instanceof DocxTemplateError && error.code === 'unknown_template_token');
  });

  test(`${kind}: původní právní lhůty a garážový podíl nejsou nahrazené novým textem`, async () => {
    const {bytes} = await load();
    const text = paragraphs(strFromU8(unzipSync(bytes)['word/document.xml'])).join('\n').replace(/\u00a0/g, ' ');
    assert.match(text, /spoluvlastnick(?:ý|ého) podíl(?:u)?/);
    assert.match(text, /439 174|seller.registryEntry/);
    if (kind === 'rs') {
      assert.match(text, /3 pracovních dnů od podpisu/);
      assert.match(text, /30/);
    } else {
      assert.match(text, /20 % Kupní ceny/);
      assert.match(text, /80 % Kupní ceny/);
      assert.match(text, /pěti \(5\) pracovních dnů ode dne podpisu/);
      assert.match(text, /do 30 dnů od doručení této Výzvy/);
      assert.match(text, /rezervační poplatek před podpisem/);
    }
  });
}

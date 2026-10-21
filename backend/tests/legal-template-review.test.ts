import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {strFromU8, unzipSync} from 'fflate';
import {DocxTemplateError, inspectDocxTemplate, renderDocxTemplate} from '../src/documents/docx-template.js';
import {templateCatalog, ORIGINAL_DOB_FULL_VARIANT, SBK_DOB_DELIVERY_VARIANT} from '../src/documents/template-catalog.js';

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

test('original RS and both SBK profiles synchronize seller email without rewriting source versions', async () => {
  for (const [kind, file, variant] of [
    ['rs', 'rs-dejvice-original-review.docx', ORIGINAL_DOB_FULL_VARIANT],
    ['sbk', 'sbk-dejvice-original-review.docx', ORIGINAL_DOB_FULL_VARIANT],
    ['sbk', 'sbk-dejvice-original-delivery-review.docx', SBK_DOB_DELIVERY_VARIANT],
  ]) {
    const catalog = templateCatalog(kind === 'rs' ? 'reservation_contract' : 'future_purchase_contract', variant)!;
    assert.equal(catalog.generationSupported, false);
    const source = await readFile(new URL(`../templates/review/${file}`, import.meta.url));
    const beforeHash = digest(source);
    const values = Object.fromEntries(Object.entries(catalog.fields).map(([key, field]) => [key, field.sample]));
    values['seller.email'] = 'novy.prodavajici@example.test';
    const result = renderDocxTemplate(source, values, {allowedTokens: Object.keys(catalog.fields),
      requiredTokens: Object.keys(catalog.fields), mailToTokens: catalog.mailToTokens}).bytes;
    const a = unzipSync(source), b = unzipSync(result);
    const before = strFromU8(a['word/document.xml']), after = strFromU8(b['word/document.xml']);
    assert.deepEqual(paragraphs(after), paragraphs(before).map(p => p.replace(/{{([A-Za-z][A-Za-z0-9_.-]*)}}/g, (_, key: string) => values[key])));
    const fields = (xml: string) => structure(xml).replace(/(<w:instrText\b[^>]*>)[\s\S]*?(<\/w:instrText>)/g, '$1$2');
    assert.equal(fields(after), fields(before));
    const rels = 'word/_rels/document.xml.rels';
    if (kind === 'rs') {
      assert.equal(strFromU8(b[rels]), strFromU8(a[rels]).replace('mailto:jaroslav.zahourek@immobuilding.cz', 'mailto:novy.prodavajici@example.test'));
    } else {
      assert.match(after, /HYPERLINK &quot;mailto:novy.prodavajici@example.test&quot;/);
      assert.doesNotMatch(after, /mailto:jaroslav.zahourek/);
    }
    for (const part of Object.keys(a)) if (part !== 'word/document.xml' && !(kind === 'rs' && part === rels)) assert.equal(digest(a[part]), digest(b[part]), part);
    assert.equal(digest(source), beforeHash);
    assert.deepEqual(inspectDocxTemplate(result).tokens, []);
  }
});

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
      // A source field may repeat within one paragraph (e.g. seller identity).
      // Restore occurrences in source order and verify the whole source hash.
      for (const slot of m.slots.filter(s => s.paragraph === i)) {
        assert.ok(restored.includes(slot.replacement), `review slot ${i}`);
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

  test(`${kind}: opakované platební údaje pocházejí ze stejného pole`, async () => {
    const {manifest: m, bytes} = await load();
    const values: Record<string, string> = {...m.sampleValues, 'seller.name': 'TECHNICKÝ PRODÁVAJÍCÍ',
      'seller.address': 'TECHNICKÉ SÍDLO', 'seller.registrationNumber': '00000000',
      'seller.bankAccount': 'TEST HLAVNÍ ÚČET', 'seller.clientChangesBankAccount': 'TEST ÚČET ZMĚN',
      'seller.bankName': 'TESTOVACÍ BANKA'};
    const fields = Object.keys(m.schema.fields);
    // Pass only schema fields; the strict renderer must not gain extra data.
    const snapshot = Object.fromEntries(fields.map(key => [key, values[key]]));
    const rendered = renderDocxTemplate(bytes, snapshot, {allowedTokens: fields, requiredTokens: fields});
    const texts = paragraphs(strFromU8(unzipSync(rendered.bytes)['word/document.xml']));
    if (kind === 'rs') {
      assert.match(texts[74], /TEST HLAVNÍ ÚČET/);
      assert.match(texts[74], /TESTOVACÍ BANKA/);
    } else {
      assert.equal(texts[73].split('TECHNICKÝ PRODÁVAJÍCÍ').length - 1, 2);
      assert.equal(texts[73].split('TECHNICKÉ SÍDLO').length - 1, 2);
      assert.equal(texts[73].split('00000000').length - 1, 2);
      for (const i of [73, 117, 118, 124]) {
        assert.match(texts[i], /TEST HLAVNÍ ÚČET/);
        assert.doesNotMatch(texts[i], /178[\s\u00a0]*412/);
      }
      assert.match(texts[97], /TEST ÚČET ZMĚN/);
      // The legal identity of the receivables assignee remains untouched.
      assert.match(texts[73], /postoupeny na UniCredit Bank Czech Republic and Slovakia, a\.s\./);
      assert.match(texts[67], /ve prospěch UniCredit Bank Czech Republic and Slovakia a\.s\./);
    }
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

test('SBK delivery-v2 mění pouze datové místo doručovací adresy a zachová originál i v1',async()=>{
 const base=new URL('../templates/review/',import.meta.url);
 const old=unzipSync(await readFile(new URL('sbk-dejvice-original-review.docx',base)));
 const bytes=await readFile(new URL('sbk-dejvice-original-delivery-review.docx',base));
 const m=JSON.parse(await readFile(new URL('sbk-delivery-review-manifest.json',base),'utf8')) as Manifest&{profileKey:string};
 assert.equal(m.profileKey,'dejvice-original-dob-delivery-v2');assert.equal(m.sourceSha256,expectedSources.sbk);
 assert.equal(m.status,'draft');assert.equal(m.activationAllowed,false);assert.equal(m.sampleIsSynthetic,true);
 assert.equal(digest(bytes),m.templateSha256);assert.equal(Object.keys(m.schema.fields).length,38);
 const next=unzipSync(bytes),oldText=paragraphs(strFromU8(old['word/document.xml'])),nextText=paragraphs(strFromU8(next['word/document.xml']));
 assert.equal(nextText.length,261);assert.deepEqual(Object.keys(next).sort(),Object.keys(old).sort());
 for(const key of Object.keys(next))if(key!=='word/document.xml'){
  assert.equal(digest(next[key]),digest(old[key]),key);assert.equal(digest(next[key]),m.preserveOnlyParts[key],key);
 }
 assert.equal(structure(strFromU8(next['word/document.xml'])),structure(strFromU8(old['word/document.xml'])));
 for(let i=0;i<oldText.length;i++)assert.equal(nextText[i],i===217?'{{seller.deliveryAddress}}':oldText[i],`only slot 217 changes: ${i}`);
 for(let i=0;i<nextText.length;i++){
  let restored=nextText[i];for(const slot of m.slots.filter(s=>s.paragraph===i))restored=restored.replace(slot.replacement,slot.original);
  assert.equal(digest(restored),m.sourceParagraphTextSha256[i],`original paragraph ${i}`);
 }
 const fields=Object.keys(m.schema.fields);assert.deepEqual(inspectDocxTemplate(bytes).tokens,fields.sort());
 const values={...m.sampleValues,'seller.deliveryAddress':'TECHNICKÁ NOVÁ DORUČOVACÍ ADRESA'};
 const output=renderDocxTemplate(bytes,values,{allowedTokens:fields,requiredTokens:fields}).bytes;
 assert.deepEqual(inspectDocxTemplate(output).tokens,[]);
 const text=paragraphs(strFromU8(unzipSync(output)['word/document.xml']));assert.equal(text[217],values['seller.deliveryAddress']);
 assert.ok(!text[217].includes('Rustonka'));assert.match(text[118],/80 % Kupní ceny/);
 assert.throws(()=>renderDocxTemplate(bytes,{...values,'seller.deliveryAddress':''},{allowedTokens:fields,requiredTokens:fields}),DocxTemplateError);
});

import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {strFromU8,unzipSync} from 'fflate';
import {inspectDocxTemplate,renderDocxTemplate} from '../src/documents/docx-template.js';
import {ORIGINAL_DOB_FULL_VARIANT,templateCatalog} from '../src/documents/template-catalog.js';

// Read-only comparison of a browser-downloaded backend preview with the pinned
// local review source. Never registers, approves, uploads or changes a contract.
const [kind,path]=process.argv.slice(2);
if(!['rs','sbk'].includes(kind)||!path)throw new Error('Usage: verify-runtime-contract-preview.ts rs|sbk /absolute/download.docx');
const catalog=templateCatalog(kind==='rs'?'reservation_contract':'future_purchase_contract',ORIGINAL_DOB_FULL_VARIANT)!;
const source=await readFile(resolve(`backend/templates/review/${kind}-dejvice-original-review.docx`));
const actual=await readFile(resolve(path));
const fields=Object.keys(catalog.fields);
const expected=renderDocxTemplate(source,Object.fromEntries(Object.entries(catalog.fields).map(([key,field])=>[key,field.sample])),{allowedTokens:fields,requiredTokens:fields});
const inspection=inspectDocxTemplate(actual);
assert.deepEqual(inspection.tokens,[],'unresolved fields');
assert.deepEqual(inspection.malformedTokens,[],'malformed fields');
assert.deepEqual(inspection.legacyMarkers,[],'legacy fields');
const decode=(text:string)=>text.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
const paragraphs=(bytes:Uint8Array)=>[...strFromU8(unzipSync(bytes)['word/document.xml']).matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)]
  .map(p=>[...p[0].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(t=>decode(t[1])).join(''));
const wanted=paragraphs(expected.bytes),found=paragraphs(actual);
assert.equal(found.length,wanted.length,'Runtime paragraph count differs');
for(let index=0;index<wanted.length;index++){
  // Do not dump legal/personal paragraph contents into CI or diagnostic logs.
  const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
  assert.equal(digest(found[index]),digest(wanted[index]),`Runtime paragraph ${index} differs beyond explicit scalar replacements`);
}
console.log(JSON.stringify({kind,fields:fields.length,paragraphs:found.length,exactParagraphText:true,unresolved:0,sha256:createHash('sha256').update(actual).digest('hex'),activation:false}));

import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
const css=await readFile(new URL('../app/globals.css',import.meta.url),'utf8');
test('shared modal labels can shrink around long select choices',()=>{
  assert.ok(/\.modal-form label\s*\{[^}]*min-width:\s*0/.test(css),'shared labels need min-width:0');
});
test('document metadata adapts to its container rather than only viewport width',()=>{
  assert.ok(/\.document-metadata-list\s*\{[^}]*container-type:\s*inline-size/.test(css),'document list needs an inline-size container');
  assert.ok(/@container[^{}]*max-width:\s*720px[^{}]*\{\s*\.document-metadata-list>article\s*\{[^}]*minmax\(0,1fr\)/.test(css),'compact columns need container sizing');
  assert.ok(css.indexOf('@container (max-width:720px)')>css.indexOf('@media(max-width:900px){.document-metadata-list>article'),'container rules must follow the older viewport layout in the cascade');
});

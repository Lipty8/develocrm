import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const crm=await readFile(new URL("../app/CRMApp.tsx",import.meta.url),"utf8");
const css=await readFile(new URL("../app/globals.css",import.meta.url),"utf8");

test("projektové seznamy mají čistý toolbar bez vysvětlujících hlaviček",()=>{
  assert.match(crm,/function ProjectModuleFrame[\s\S]*?list-action-toolbar/);
  for(const copy of ["Klienti a zájemci filtrovaní pouze pro tento projekt","Projektový inventář a aktuální přiřazení","Zobrazeny jsou pouze jednotky tohoto projektu","Pracujete uvnitř konkrétního projektu"])
    assert.doesNotMatch(crm,new RegExp(copy));
});

test("sklepy a parkování nemají search ani vlastní svislý scroll",()=>{
  assert.doesNotMatch(crm,/accessory-inventory-search|accessory-inventory-scroll|Hledat v seznamu/);
  assert.doesNotMatch(css,/\.accessory-inventory-scroll/);
  assert.match(crm,/<TableColumnFilter label="Označení" sortDirection=/);
});

test("klienti se načítají automaticky podle viewportu a stránka nese svislý scroll",()=>{
  assert.match(crm,/IntersectionObserver[\s\S]*?root:null,rootMargin:"360px"/);
  assert.match(crm,/window\.scrollY/);
  assert.doesNotMatch(crm,/clientScrollRef|onScroll=\{event=>sessionStorage/);
  assert.match(css,/\.client-infinite-table\{overflow-x:auto;overflow-y:visible/);
  assert.doesNotMatch(css,/\.client-infinite-table\{[^}]*max-height/);
});

test("jednotky a smlouvy nemají klasické stránkování ani tabulkovou patičku",()=>{
  assert.doesNotMatch(crm,/compact-pagination|className="table-footer"/);
  assert.doesNotMatch(css,/\.table-footer/);
});

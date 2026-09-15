import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const root=new URL("../",import.meta.url);
const read=path=>readFile(new URL(path,root),"utf8");

test("unit preview and unit tasks do not expose synthetic pilot data",async()=>{
  const app=await read("app/CRMApp.tsx");
  assert.doesNotMatch(app,/Ruční i automatické úkoly navázané na A203/);
  assert.doesNotMatch(app,/Doplnit číslo účtu klienta/);
  assert.doesNotMatch(app,/Zapracovat připomínky klienta/);
  assert.doesNotMatch(app,/Obývací pokoj \+ kk/);
  assert.doesNotMatch(app,/Lodžie 8,2 m²/);
  assert.doesNotMatch(app,/Doporučený další krok/);
  assert.match(app,/taskRepository\.list\("all",owner/);
  assert.match(app,/task\.objectType==="unit"/);
});

test("obsolete duplicate document form stays removed and contract notes use the governed flow",async()=>{
  const app=await read("app/CRMApp.tsx");
  assert.doesNotMatch(app,/function DocumentCreateModal\(/);
  assert.doesNotMatch(app,/Ceník se připravuje/);
  assert.doesNotMatch(app,/notify\("Nová smlouva/);
  assert.match(app,/function ContractNoteModal\(/);
  assert.match(app,/commercialRepository\.addContractNote/);
  assert.match(app,/function StandaloneDocumentCreateModal\(/);
});

test("shared popovers recalculate their position without stale closures",async()=>{
  const [rowMenu,columnConfig]=await Promise.all([
    read("app/components/row-action-menu.tsx"),
    read("app/components/table-column-config.tsx"),
  ]);
  for(const source of [rowMenu,columnConfig]){
    assert.match(source,/useCallback/);
    assert.match(source,/addEventListener\("resize"/);
    assert.match(source,/addEventListener\("scroll"/);
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const root=new URL("../",import.meta.url);

test("jednotka, projekt i globální modul používají jeden formulář plánování předání",async()=>{
  const source=await readFile(new URL("app/CRMApp.tsx",root),"utf8");
  assert.match(source,/setNewHandoverContext\(\{unit:unitDetail/);
  assert.match(source,/setNewHandoverContext\(\{project:selectedProject\}\)/);
  assert.match(source,/page==="handovers"\?setNewHandoverContext\(\{\}\)/);
  assert.match(source,/defaultUnit=\{newHandoverContext\.unit\}/);
});

test("plánovací a editační formulář podporuje místo, poznámku, dokončení i zrušení",async()=>{
  const source=await readFile(new URL("app/CRMApp.tsx",root),"utf8");
  for(const value of ["Místo","Poznámka","Skutečné datum a čas předání","Dokončeno","Zrušeno","Pro tuto jednotku již existuje naplánované předání."])assert.ok(source.includes(value)||value.startsWith("Pro tuto"));
  assert.match(source,/handoverRepository\.update/);
  assert.match(source,/onHandoverChanged/);
  assert.match(source,/currentHandoverLabel/);
  assert.doesNotMatch(source,/PŘEDÁNÍ<\/small><strong><KeyRound size=\{16\} \/> \{unit\.handover\}/);
});

test("BFF předává obecný PATCH předání do backendu",async()=>{
  const route=await readFile(new URL("app/api/handovers/[handoverId]/route.ts",root),"utf8");
  assert.match(route,/method:"PATCH"/);
  assert.match(route,/\/v1\/handovers\/\$\{encodeURIComponent\(handoverId\)\}/);
});

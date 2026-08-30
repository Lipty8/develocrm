import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const crm=await readFile(new URL("../app/CRMApp.tsx",import.meta.url),"utf8");
const css=await readFile(new URL("../app/globals.css",import.meta.url),"utf8");
const migration=await readFile(new URL("../backend/migrations/0032_accessory_lifecycle.sql",import.meta.url),"utf8");
const backend=await readFile(new URL("../backend/src/app.ts",import.meta.url),"utf8");
const catalog=await readFile(new URL("../app/repositories/catalog-repository.ts",import.meta.url),"utf8");

test("sklepy a parking mají CTA přímo v KPI řádku",()=>{
  assert.match(crm,/accessory-inventory-summary[\s\S]*accessory-summary-metrics[\s\S]*Přidat sklep[\s\S]*Přidat parkovací místo/);
  assert.doesNotMatch(crm,/canManage&&<div className="list-action-toolbar"><button[^>]*>[\s\S]*Nový sklep/);
  assert.match(css,/\.accessory-inventory-summary\{display:flex/);
});

test("detail příslušenství nabízí úpravu, přiřazení a bezpečné odstranění",()=>{
  for(const label of ["Upravit","Přiřadit","Uvolnit","Smazat sklep","Smazat parkovací místo","Archivované"])
    assert.match(crm,new RegExp(label));
  assert.match(crm,/Položka je aktuálně přiřazená/);
  assert.match(crm,/Nejprve ji uvolněte z jednotky/);
});

test("doménová operace blokuje aktivní přiřazení a volí delete nebo archive",()=>{
  assert.match(migration,/CREATE OR REPLACE FUNCTION app\.remove_or_archive_accessory/);
  assert.match(migration,/accessory is currently assigned/);
  assert.match(migration,/result_mode:='archive'/);
  assert.match(migration,/result_mode:='delete'/);
  assert.match(migration,/accessory\.archived/);
  assert.match(migration,/accessory\.deleted/);
  assert.match(migration,/INSERT INTO audit_log/);
  assert.match(migration,/INSERT INTO outbox_events/);
  assert.match(backend,/\/v1\/accessories\/:accessoryId/);
});

test("archivované položky jsou skryté standardně a preview adapter zachová stav",()=>{
  assert.match(crm,/states\.length\?states\.includes\(state\):!row\.archived/);
  assert.match(crm,/options=\{\["Volné","Přiřazené","Archivované"\]\}/);
  assert.match(catalog,/develocrm\.archived\.accessories/);
  assert.match(catalog,/removeOrArchiveAccessory/);
});

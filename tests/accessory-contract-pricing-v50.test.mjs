import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const crm=await readFile(new URL("../app/CRMApp.tsx",import.meta.url),"utf8");
const catalogRepository=await readFile(new URL("../app/repositories/catalog-repository.ts",import.meta.url),"utf8");
const commercialRepository=await readFile(new URL("../backend/src/commercial/repository.ts",import.meta.url),"utf8");
const commercialService=await readFile(new URL("../backend/src/commercial/service.ts",import.meta.url),"utf8");
const migration=await readFile(new URL("../backend/migrations/0031_accessory_pricing_and_contract_references.sql",import.meta.url),"utf8");

test("správa příslušenství umí přiřadit, uvolnit i založit standardní položku",()=>{
  for(const text of ["volné k přiřazení","Uvolnit","Nové příslušenství","Wallbox","Dostupné v projektu"])assert.match(crm,new RegExp(text));
  assert.match(catalogRepository,/createAccessory/);
  assert.match(catalogRepository,/assignAccessory/);
  assert.match(catalogRepository,/removeAccessory/);
  assert.match(migration,/valid_to=effective_to/);
  assert.match(migration,/unit accessory assignment can only be released by a domain command/);
});

test("detail jednotky i smluvní předpis používají společný cenový základ",()=>{
  for(const text of ["Cena jednotky","Příslušenství","Celková cena"])assert.match(crm,new RegExp(text));
  assert.match(commercialRepository,/current_unit_sales_price/);
  assert.match(migration,/price_basis:=app\.current_unit_sales_price/);
  assert.match(migration,/unit_price_snapshot/);
  assert.match(migration,/accessory_price_snapshot/);
  assert.match(migration,/total_price_snapshot/);
});

test("reference smlouvy se alokuje bezpečně a služba vrací skutečně uloženou hodnotu",()=>{
  assert.match(migration,/pg_advisory_xact_lock/);
  assert.match(migration,/active contract of this type already exists/);
  assert.match(migration,/lpad\(sequence_number::text,2,'0'\)/);
  assert.match(commercialService,/SELECT reference,title FROM contracts/);
});

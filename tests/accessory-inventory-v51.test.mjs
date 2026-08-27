import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {parseCrmRoute,projectRoute} from "../app/crm-routing.mjs";

const crm=await readFile(new URL("../app/CRMApp.tsx",import.meta.url),"utf8");
const catalog=await readFile(new URL("../backend/src/inventory/repository.ts",import.meta.url),"utf8");
const proxy=await readFile(new URL("../app/lib/backend-proxy.ts",import.meta.url),"utf8");
const importSeed=await readFile(new URL("../backend/seeds/0004_pilot_rezidence_dejvice.sql",import.meta.url),"utf8");

test("projekt má samostatně routovatelné sklepy a parkovací místa se sdílenými akcemi",()=>{
  assert.equal(projectRoute("project-1","cellars"),"/projects/project-1/cellars");
  assert.equal(projectRoute("project-1","parking"),"/projects/project-1/parking");
  assert.equal(parseCrmRoute("/projects/project-1/cellars").projectTab,"cellars");
  assert.equal(parseCrmRoute("/projects/project-1/parking").projectTab,"parking");
  assert.equal(parseCrmRoute("/projects/project-1/accessories").projectTab,"parking");
  for(const text of ["Sklepy","Parkovací místa","Přiřazená jednotka","Klient / obchodní stav","Historie přiřazení","ProjectAccessoryInventory","onAssignAccessory","onReleaseAccessory"])
    assert.match(crm,new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")));
});

test("oba inventáře mají skutečné souhrny, hledání, filtry a wallbox vazbu",()=>{
  for(const text of ["accessory-inventory-summary","Hledat v seznamu","Výměra","Filtrovat typ parkování","Filtrovat wallbox","Wallbox","accessory-inventory-scroll"])
    assert.match(crm,new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")));
  assert.match(crm,/item\.category === "cellar"/);
  assert.match(crm,/item\.category === "parking"/);
});

test("inventář je backendová projekce aktivního přiřazení, kupujícího, wallboxu a historie",()=>{
  for(const token of ["active_assignment","assigned_unit_code","assigned_client","assignment_history"])
    assert.match(catalog,new RegExp(token));
  assert.match(catalog,/string_agg\(DISTINCT party\.display_name/);
  assert.match(catalog,/link\.target_accessory_id=accessory\.id/);
  assert.match(catalog,/app\.has_project_permission\(accessory\.tenant_id,\$2,accessory\.project_id,'accessory\.read'\)/);
});

test("prázdný DELETE se neposílá jako JSON a import používá explicitní vazby",()=>{
  assert.match(proxy,/options\.method === "DELETE" \? null/);
  assert.match(proxy,/body: options\.method === "DELETE" \? undefined : body/);
  assert.match(importSeed,/JOIN dej_unit_map unit ON unit\.code=accessory\.unit/);
  assert.match(importSeed,/NOT EXISTS\(SELECT 1 FROM unit_accessory_assignments/);
  assert.match(importSeed,/ON CONFLICT \(tenant_id,project_id,\(lower\(code\)\)\)/);
  assert.equal((importSeed.match(/"code":"P\d+"/g)??[]).length,29);
  assert.equal((importSeed.match(/"code":"S\d+"/g)??[]).length,19);
  assert.equal((importSeed.match(/"code":"W\d+"/g)??[]).length,0);
});

import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const app=await readFile(new URL("../app/CRMApp.tsx",import.meta.url),"utf8");
const inventory=await readFile(new URL("../backend/src/inventory/repository.ts",import.meta.url),"utf8");
const commercial=await readFile(new URL("../backend/src/commercial/repository.ts",import.meta.url),"utf8");
const sales=await readFile(new URL("../backend/src/sales/repository.ts",import.meta.url),"utf8");

test("projektové záložky filtrují platby i inventář UUID projektu",()=>{
  assert.match(app,/filters=\{\{projectId:project\.backendId\}\}/);
  assert.match(app,/item\.projectBackendId===project\.backendId/);
  assert.match(app,/clientBelongsToProject\(client,project\)/);
  assert.match(app,/contractBelongsToProject\(contract,project\)/);
  assert.match(app,/taskBelongsToProject\(task,project\)/);
  assert.match(inventory,/\$3::uuid IS NULL OR unit\.project_id=\$3/);
  assert.match(inventory,/\$3::uuid IS NULL OR accessory\.project_id=\$3/);
  assert.match(commercial,/\$3::uuid IS NULL OR contract\.project_id=\$3/);
  assert.match(sales,/!input\.projectId\|\|item\.projectIds\.includes\(input\.projectId\)/);
});

test("jednotky, sklepy a parkování mají ruční i XLSX importní akce",()=>{
  for(const label of ["Přidat jednotku","Importovat jednotky","Přidat sklep","Přidat parkovací místo","Importovat {mode===\"cellar\"?\"sklepy\":\"parkovací místa\"}"])assert.ok(app.includes(label),label);
  assert.match(app,/accept="\.xlsx,application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet"/);
});

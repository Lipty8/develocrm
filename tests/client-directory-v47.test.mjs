import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const crm=await readFile(new URL("../app/CRMApp.tsx",import.meta.url),"utf8");
const repository=await readFile(new URL("../backend/src/sales/repository.ts",import.meta.url),"utf8");
const migration=await readFile(new URL("../backend/migrations/0025_client_directory_integrity.sql",import.meta.url),"utf8");

test("projektový a globální seznam používají stejné klikatelné chips jednotek",()=>{
  assert.match(crm,/function ClientUnitChips/);
  assert.match(crm,/ProjectClients[\s\S]*?<ClientUnitChips client=\{client\} project=\{project\}/);
  assert.match(crm,/ClientRelationColumn[\s\S]*?<ClientUnitChips client=\{client\}/);
});

test("smluvní stav klienta vychází ze skutečných smluv v pořadí KS SBK RS",()=>{
  assert.match(repository,/FROM contracts contract/);
  assert.match(repository,/WHEN 'ks' THEN 3 WHEN 'sbk' THEN 2 WHEN 'rs' THEN 1/);
  assert.doesNotMatch(repository,/contractStatus:\s*stageLabel/);
});

test("seznam klientů používá automatické dávkové načítání a sticky hlavičku",()=>{
  assert.match(crm,/IntersectionObserver/);
  assert.match(crm,/clientSentinelRef/);
  assert.doesNotMatch(crm,/setClientPage\(currentPage/);
});

test("kontrola duplicit i archivace jsou backendové a auditované",()=>{
  assert.match(migration,/party duplicate confirmation required/);
  assert.match(migration,/duplicateWarningOverridden/);
  assert.match(migration,/CREATE OR REPLACE FUNCTION app\.archive_party/);
  assert.match(migration,/party\.archived\.v1/);
  assert.match(crm,/Použít existujícího klienta/);
  assert.match(crm,/Přesto vytvořit nového/);
});

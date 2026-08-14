import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const crm=await readFile(new URL("../app/CRMApp.tsx",import.meta.url),"utf8");
const repository=await readFile(new URL("../backend/src/sales/repository.ts",import.meta.url),"utf8");
const migration=await readFile(new URL("../backend/migrations/0025_client_directory_integrity.sql",import.meta.url),"utf8");
const migration26=await readFile(new URL("../backend/migrations/0026_party_removal_and_duplicate_check.sql",import.meta.url),"utf8");
const clientRepository=await readFile(new URL("../app/repositories/client-repository.ts",import.meta.url),"utf8");
const formatter=await readFile(new URL("../app/lib/date-time.ts",import.meta.url),"utf8");

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

test("duplicate check používá projektové clients.create a technická chyba zůstává blokující",()=>{
  assert.match(clientRepository,/findDuplicates\(input:Omit<NewPartyInput,"duplicateOverride">\)/);
  assert.match(crm,/findDuplicates\(\{projectId,\.\.\.draft\(\)\}\)/);
  assert.match(repository,/has_project_permission\(\$1,\$2,\$3,'clients\.create'\)/);
  assert.match(clientRepository,/Kontrolu duplicit se nepodařilo provést\. Zkuste to prosím znovu\./);
  assert.match(clientRepository,/clients\.duplicate_check\.failed/);
});

test("klient bez historie se smaže a klient s historií se archivuje",()=>{
  assert.match(migration26,/removalMode/);
  assert.match(migration26,/party\.deleted/);
  assert.match(migration26,/party\.archived/);
  assert.match(crm,/Klient bude trvale smazán/);
  assert.match(crm,/Klient bude bezpečně archivován/);
});

test("uživatelské timestampy používají český formatter nejvýše na sekundy",()=>{
  assert.match(formatter,/second: "2-digit"/);
  assert.match(crm,/<time>\{formatPragueDateTime\(item\.date\)\}<\/time>/);
  assert.doesNotMatch(crm,/<time>\{item\.date\}<\/time>/);
});

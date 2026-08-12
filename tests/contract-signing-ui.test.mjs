import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

test("detail smlouvy nabízí řízené označení aktuální verze jako podepsané",async()=>{
  const app=await readFile(new URL("../app/CRMApp.tsx",import.meta.url),"utf8");
  const repository=await readFile(new URL("../app/repositories/commercial-repository.ts",import.meta.url),"utf8");
  const nextAction=await readFile(new URL("../backend/src/shared/next-contract-action.ts",import.meta.url),"utf8");
  const proxy=await readFile(new URL("../app/api/commercial/contracts/[contractId]/sign/route.ts",import.meta.url),"utf8");
  assert.match(app,/Označit jako podepsané/);
  assert.match(app,/Datum podpisu/);
  assert.match(app,/Poznámka \(volitelné\)/);
  assert.match(app,/contract\.versions\?\.\[0\]/);
  assert.match(repository,/signContract/);
  assert.match(proxy,/forwardBackendMutation/);
  assert.match(app,/refreshCommercial\(\);refreshCatalog\(\);refreshClients\(\)/);
  assert.match(nextAction,/Čeká na úhradu rezervačního poplatku/);
  assert.match(app,/Smlouva byla podepsána a jednotka rezervována/);
});

test("rezervace jednotky je v UI oddělená od smluvní etapy RS",async()=>{
  const app=await readFile(new URL("../app/CRMApp.tsx",import.meta.url),"utf8");
  const statuses=await readFile(new URL("../app/lib/unit-commercial-status.ts",import.meta.url),"utf8");
  assert.match(statuses,/reserved: \{ label: "Rezervovaná"/);
  assert.match(app,/\["Zájem", "Předrezervace", "Rezervace", "RS", "SBK", "KS", "Předání"\]/);
  assert.match(app,/reservation:2,rs:3,sbk:4,ks:5,handover:6/);
  assert.doesNotMatch(app,/<Badge>\{unit\.status\}<\/Badge> Ve vyjednávání/);
});

test("smlouvy používají filtry v hlavičkách a jedinou sjednocenou historii",async()=>{
  const app=await readFile(new URL("../app/CRMApp.tsx",import.meta.url),"utf8");
  assert.match(app,/contract-table-head[\s\S]+ListColumnFilter label="Smlouva a kontext"/);
  assert.doesNotMatch(app,/contract-filter-bar[^\n]+MultiSelectFilter/);
  assert.doesNotMatch(app,/<span>Doporučená akce<\/span>/);
  assert.doesNotMatch(app,/contract-next-action/);
  assert.doesNotMatch(app,/\["activity","Aktivita",Activity\]/);
  assert.match(app,/Stavy, logické verze, podpisy a relevantní auditní události/);
});

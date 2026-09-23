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
  assert.match(app,/refreshUnitWorkflow\(\)/);
  assert.match(nextAction,/return\{kind:"create_contract",contractType,allowedContractTypes,label:"Vytvořit smlouvu"\}/);
  assert.doesNotMatch(nextAction,/Čeká na úhradu rezervačního poplatku/);
  assert.match(app,/Smlouva byla označena jako podepsaná a obchodní proces byl aktualizován/);
  assert.doesNotMatch(app,/ContractSignatureModal/);
});

test("vizuální prodejní proces používá smlouvy a nemá duplicitní krok rezervace",async()=>{
  const app=await readFile(new URL("../app/CRMApp.tsx",import.meta.url),"utf8");
  const statuses=await readFile(new URL("../app/lib/unit-commercial-status.ts",import.meta.url),"utf8");
  const workflow=await readFile(new URL("../app/lib/unit-sales-workflow.ts",import.meta.url),"utf8");
  assert.match(statuses,/reserved: \{ label: "Rezervovaná"/);
  assert.match(workflow,/\["Zájem", "V jednání", "RS", "SBK", "KS", "Předání"\]/);
  assert.doesNotMatch(workflow,/"V jednání", "Rezervace"/);
  assert.match(workflow,/getSalesProcessState/);
  assert.match(workflow,/contract\.salesCaseId===input\.context\.salesCaseId/);
  assert.match(app,/projectUnitSalesWorkflow/);
  assert.match(app,/nextContractAction\?\.salesProcess\?\?projectUnitSalesWorkflow/);
  assert.doesNotMatch(app,/<Badge>\{unit\.status\}<\/Badge> Ve vyjednávání/);
});

test("timeline a hlavní smluvní CTA používají stejnou projekci aktivního obchodního případu",async()=>{
  const app=await readFile(new URL("../app/CRMApp.tsx",import.meta.url),"utf8");
  const service=await readFile(new URL("../backend/src/commercial/service.ts",import.meta.url),"utf8");
  assert.match(service,/getSalesProcessState\(\{hasActiveSalesCase:Boolean\(unit\.sales_case_id\),contracts,commercialStatus:unit\.commercial_status,salesStage:unit\.sales_stage,holdType:unit\.hold_type,hasInterest:unit\.has_interest,handoverCompleted:unit\.handover_completed\}\)/);
  assert.match(service,/sales_case_id=\$2 AND contract_type IN \('rs','sbk','ks'\)/);
  assert.match(service,/getNextContractAction\(\{hasActiveSalesCase:true,contracts,salesStage:unit\.sales_stage\}\)/);
  assert.match(app,/workflow=\{salesProcess\}/);
  assert.match(app,/<Badge>\{salesProcess\.commercialStatusLabel\}<\/Badge>/);
  assert.match(app,/nextContractAction=\{nextContractAction\}/);
  assert.match(app,/action\?\.kind==="create_contract"/);
  assert.match(app,/Vytvořit dokument/);
  assert.doesNotMatch(app,/> Otevřít smlouvy</);
  assert.match(app,/const refreshUnitWorkflow = \(\) => \{ refreshCommercial\(\); refreshCatalog\(\); refreshClients\(\);/);
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

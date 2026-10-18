import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const app=await readFile(new URL("../app/CRMApp.tsx",import.meta.url),"utf8");
const panel=await readFile(new URL("../app/components/rs-generation-panel.tsx",import.meta.url),"utf8");
const repository=await readFile(new URL("../app/repositories/commercial-repository.ts",import.meta.url),"utf8");
const readinessRoute=await readFile(new URL("../app/api/commercial/contracts/[contractId]/rs-readiness/route.ts",import.meta.url),"utf8");
const preparationRoute=await readFile(new URL("../app/api/commercial/contracts/[contractId]/preparation-readiness/route.ts",import.meta.url),"utf8");
const generationRoute=await readFile(new URL("../app/api/commercial/contracts/[contractId]/generate-rs/route.ts",import.meta.url),"utf8");

test("detail RS ukazuje připravenost, chyby a jedinou generovací akci",()=>{
  assert.match(panel,/function RsGenerationPanel/);
  assert.match(panel,/const type=contractType==='sbk'\?'SBK':'RS'/);
  assert.match(panel,/Vygenerovat \$\{type\}/);
  assert.match(panel,/Vytvořit novou verzi \$\{type\}/);
  assert.match(panel,/Otevřít dokument/);
  assert.match(panel,/readiness\.issues\.map/);
  assert.match(app,/contract\.typeCode==="rs"/);
  assert.match(app,/contract\.typeCode==="sbk"/);
});

test("frontend používá BFF a neposílá vlastní placeholder hodnoty",()=>{
  assert.match(repository,/getRsReadiness\(contractId/);
  assert.match(repository,/generateRs\(contractId:string,idempotencyKey:string\)/);
  assert.match(repository,/generate-rs[^\n]+body:JSON\.stringify\(\{idempotencyKey\}\)/);
  assert.match(readinessRoute,/\/v1\/contracts\/\$\{encodeURIComponent\(contractId\)\}\/rs-readiness/);
  assert.match(preparationRoute,/\/v1\/contracts\/\$\{encodeURIComponent\(contractId\)\}\/preparation-readiness/);
  assert.match(repository,/\/preparation-readiness/);
  assert.match(generationRoute,/generate-rs/);
  assert.match(generationRoute,/forwardBackendMutation/);
});

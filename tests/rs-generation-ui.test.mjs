import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const app=await readFile(new URL("../app/CRMApp.tsx",import.meta.url),"utf8");
const repository=await readFile(new URL("../app/repositories/commercial-repository.ts",import.meta.url),"utf8");
const readinessRoute=await readFile(new URL("../app/api/commercial/contracts/[contractId]/rs-readiness/route.ts",import.meta.url),"utf8");
const generationRoute=await readFile(new URL("../app/api/commercial/contracts/[contractId]/generate-rs/route.ts",import.meta.url),"utf8");

test("detail RS ukazuje připravenost, chyby a jedinou generovací akci",()=>{
  assert.match(app,/function RsGenerationPanel/);
  assert.match(app,/Vygenerovat rezervační smlouvu/);
  assert.match(app,/Vytvořit novou verzi/);
  assert.match(app,/Otevřít v SharePointu/);
  assert.match(app,/readiness\.issues\.map/);
  assert.match(app,/contract\.typeCode==="rs"/);
});

test("frontend používá BFF a neposílá vlastní placeholder hodnoty",()=>{
  assert.match(repository,/getRsReadiness\(contractId/);
  assert.match(repository,/generateRs\(contractId:string,idempotencyKey:string\)/);
  assert.match(repository,/generate-rs[^\n]+body:JSON\.stringify\(\{idempotencyKey\}\)/);
  assert.match(readinessRoute,/\/v1\/contracts\/\$\{encodeURIComponent\(contractId\)\}\/rs-readiness/);
  assert.match(generationRoute,/generate-rs/);
  assert.match(generationRoute,/forwardBackendMutation/);
});

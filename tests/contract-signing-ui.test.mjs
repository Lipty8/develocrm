import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

test("detail smlouvy nabízí řízené označení aktuální verze jako podepsané",async()=>{
  const app=await readFile(new URL("../app/CRMApp.tsx",import.meta.url),"utf8");
  const repository=await readFile(new URL("../app/repositories/commercial-repository.ts",import.meta.url),"utf8");
  const proxy=await readFile(new URL("../app/api/commercial/contracts/[contractId]/sign/route.ts",import.meta.url),"utf8");
  assert.match(app,/Označit jako podepsané/);
  assert.match(app,/Datum podpisu/);
  assert.match(app,/Poznámka \(volitelné\)/);
  assert.match(app,/contract\.versions\?\.\[0\]/);
  assert.match(repository,/signContract/);
  assert.match(proxy,/forwardBackendMutation/);
});

import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

test("pilotní režim nemá implicitní browser fallback",async()=>{
  const mode=await readFile(new URL("../app/lib/data-mode.ts",import.meta.url),"utf8");
  const session=await readFile(new URL("../app/api/identity/session/route.ts",import.meta.url),"utf8");
  const catalog=await readFile(new URL("../app/api/catalog/route.ts",import.meta.url),"utf8");
  assert.match(mode,/DEVELOCRM_DATA_MODE === "browser"/);
  assert.match(mode,/"browser" : "api"/);
  assert.match(session,/serverDataMode\(\) !== "browser"/);
  assert.match(catalog,/serverDataMode\(\) !== "browser"/);
});

test("nový projekt používá samostatné oprávnění a skutečný repository kontrakt",async()=>{
  const ui=await readFile(new URL("../app/CRMApp.tsx",import.meta.url),"utf8");
  const repository=await readFile(new URL("../app/repositories/catalog-repository.ts",import.meta.url),"utf8");
  assert.match(ui,/can\("projects\.create"\)/);
  assert.match(ui,/NewProjectModal/);
  assert.match(repository,/createProject\(input:ProjectCreate\)/);
  assert.match(repository,/\/api\/catalog\/projects/);
});

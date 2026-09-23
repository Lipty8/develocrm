import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const apiClient=await readFile(new URL("../app/lib/api-client.ts",import.meta.url),"utf8");
const crm=await readFile(new URL("../app/CRMApp.tsx",import.meta.url),"utf8");

test("každá úspěšná mutace publikuje jednotnou invalidaci dat",()=>{
  assert.match(apiClient,/mutation&&response\.ok\)announceDataMutation/);
  assert.match(crm,/window\.addEventListener\(DATA_MUTATED_EVENT,refresh\)/);
  for(const setter of ["setCatalogReloadKey","setClientReloadKey","setCommercialReloadKey","setActivityReloadKey","setDocumentReloadKey","setHandoverReloadKey","setTaskReloadKey"]){
    assert.match(crm,new RegExp(`${setter}\\(key=>key\\+1\\)`));
  }
  assert.match(crm,/main className="main-content" key=\{dataMutationVersion\}/);
});

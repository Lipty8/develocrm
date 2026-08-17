import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

test("návrat do aplikace obnoví session, data i metadata obrázků",async()=>{
  const boundary=await readFile(new URL("../app/components/EntraAuthBoundary.tsx",import.meta.url),"utf8");
  const app=await readFile(new URL("../app/CRMApp.tsx",import.meta.url),"utf8");
  assert.match(boundary,/visibilitychange/);
  assert.match(boundary,/refreshAccessToken/);
  assert.match(boundary,/Obnovuji data/);
  assert.match(boundary,/develocrm:session-restored/);
  assert.match(boundary,/develocrm\.build-version/);
  assert.match(boundary,/window\.location\.reload/);
  assert.match(app,/setCatalogReloadKey/);
  assert.match(app,/setCommercialReloadKey/);
  assert.match(app,/setClientReloadKey/);
  assert.match(app,/setUrl\(null\)/);
});

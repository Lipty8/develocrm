import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const crm = await readFile(new URL("../app/CRMApp.tsx", import.meta.url), "utf8");
const catalog = await readFile(new URL("../app/api/catalog/route.ts", import.meta.url), "utf8");
const backend = await readFile(new URL("../backend/src/app.ts", import.meta.url), "utf8");
const catalogMutation = await readFile(new URL("../app/api/catalog/mutation.ts", import.meta.url), "utf8");

test("dashboard i detail používají stejný sdílený výpočet prodejního výkonu", () => {
  assert.match(crm, /projectSalesPerformanceCount\(project\)} z \{project\.units\}/);
  assert.match(crm, /projectSalesPerformancePercent\(project\)/);
  assert.doesNotMatch(crm, /project\.sold\/project\.units/);
  assert.doesNotMatch(crm, /z \{project\.units\} prodáno/);
  assert.match(catalog, /projectSalesPerformancePercent\(\{units:unitCount,reserved,sold,handedOver\}\)/);
});

test("katalog přenáší skutečný kód fáze a český měsíc dokončení", () => {
  assert.match(catalog, /stageCode:project\.constructionStatus/);
  assert.match(catalog, /projectCompletionLabel\(project\.plannedHandoverFrom\?\?project\.plannedHandoverTo\)/);
  assert.match(crm, /type="month" value=\{completionMonth\}/);
  assert.doesNotMatch(crm, /Plánované dokončení od/);
  assert.doesNotMatch(crm, /Plánované dokončení do/);
});

test("okamžitá změna fáze používá čas backendu", () => {
  assert.match(backend, /effectiveAt:new Date\(\)\.toISOString\(\)/);
  assert.match(catalogMutation, /effectiveAt:new Date\(\)\.toISOString\(\)/);
  assert.doesNotMatch(crm, /effectiveAt:new Date\(\)\.toISOString\(\)/);
});

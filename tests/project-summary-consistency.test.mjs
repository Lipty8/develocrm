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
  assert.match(catalog, /projectSalesPerformancePercent\(\{units:unitCount,available,preReserved,reserved,sold,handedOver\}\)/);
});

test("rezervace se vykazuje jako prodaná, předrezervace nikoliv",()=>{
  assert.match(crm,/title="Prodané včetně rezervovaných"/);
  assert.match(crm,/je prodaných včetně rezervovaných/);
  assert.match(crm,/isUnitCommerciallyAvailable\(unit\.status\)/);
});

test("katalog přenáší skutečný kód fáze a český měsíc dokončení", () => {
  assert.match(catalog, /stageCode:project\.constructionStatus/);
  assert.match(catalog, /projectCompletionLabel\(project\.plannedHandoverFrom\?\?project\.plannedHandoverTo\)/);
  assert.match(crm, /Měsíc plánovaného dokončení/);
  assert.match(crm, /Rok plánovaného dokončení/);
  assert.doesNotMatch(crm, /type="month"/);
  assert.doesNotMatch(crm, /Plánované dokončení od/);
  assert.doesNotMatch(crm, /Plánované dokončení do/);
});

test("detail projektu nemá redundantní kód ani tlačítko jednotek",()=>{
  assert.doesNotMatch(crm,/project-detail-mark[^\n]+project\.code/);
  assert.doesNotMatch(crm,/> Otevřít jednotky<\/button>/);
});

test("barvy obchodních stavů používají jednu sémantickou mapu",async()=>{
  const styles=await readFile(new URL("../app/globals.css",import.meta.url),"utf8");
  assert.match(styles,/--status-available: #bd3e3e/);
  assert.match(styles,/--status-pre-reserved: #c96f17/);
  assert.match(styles,/--status-reserved: #1469c8/);
  assert.match(styles,/--status-sold: #247453/);
  assert.match(styles,/project-distribution-bar \.available[^\n]+var\(--status-available\)/);
});

test("graf a legenda používají tři sdílené agregované stavy",()=>{
  assert.match(crm,/const salesAggregation = projectSalesAggregation\(project\)/);
  assert.match(crm,/const unitDistribution = \[\s*\{ label: "Prodané"[^\n]+\n\s*\{ label: "Předrezervace"[^\n]+\n\s*\{ label: "Volné"/);
  assert.match(crm,/project-distribution-bar[^\n]+unitDistribution\.map/);
  assert.match(crm,/project-distribution-legend[^\n]+unitDistribution\.map/);
});

test("okamžitá změna fáze používá čas backendu", () => {
  assert.match(backend, /effectiveAt:new Date\(\)\.toISOString\(\)/);
  assert.match(catalogMutation, /effectiveAt:new Date\(\)\.toISOString\(\)/);
  assert.doesNotMatch(crm, /effectiveAt:new Date\(\)\.toISOString\(\)/);
});

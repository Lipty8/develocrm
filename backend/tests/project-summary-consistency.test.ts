import assert from "node:assert/strict";
import test from "node:test";
import { projectCompletionLabel, projectCompletionMonthValue, projectCompletionStorageDate } from "../../app/lib/project-completion.js";
import { projectConstructionLabel, projectConstructionStepIndex } from "../../app/lib/project-construction.js";
import { projectSalesPerformanceCount, projectSalesPerformancePercent } from "../../app/lib/project-sales-performance.js";

test("projektové souhrny používají jednotnou definici prodejního výkonu", () => {
  const dejvice = { units: 19, reserved: 2, sold: 0, handedOver: 0 };
  assert.equal(projectSalesPerformanceCount(dejvice), 2);
  assert.equal(projectSalesPerformancePercent(dejvice), 11);
});

test("stavební fáze používá uložený kód, nikoliv odhad z textu", () => {
  assert.equal(projectConstructionLabel("construction"), "Ve výstavbě");
  assert.equal(projectConstructionStepIndex("construction"), 2);
  assert.equal(projectConstructionStepIndex("fit_out"), 5);
});

test("plánované dokončení se ukládá jako první den měsíce a zobrazuje česky", () => {
  assert.equal(projectCompletionStorageDate("2026-12"), "2026-12-01");
  assert.equal(projectCompletionMonthValue("2026-12-19"), "2026-12");
  assert.equal(projectCompletionLabel("2026-12-01"), "prosinec 2026");
});

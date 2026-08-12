import assert from "node:assert/strict";
import test from "node:test";
import { projectCompletionLabel, projectCompletionMonthValue, projectCompletionStorageDate } from "../../app/lib/project-completion.js";
import { projectConstructionLabel, projectConstructionStepIndex } from "../../app/lib/project-construction.js";
import { projectSalesAggregation, projectSalesPerformanceCount, projectSalesPerformancePercent } from "../../app/lib/project-sales-performance.js";
import { getCommercialSalesBucket, isUnitCommerciallyAvailable } from "../../app/lib/unit-commercial-status.js";

test("projektové souhrny používají jednotnou definici prodejního výkonu", () => {
  const dejvice = { units: 19, available: 16, preReserved: 1, reserved: 2, sold: 0, handedOver: 0 };
  assert.deepEqual(projectSalesAggregation(dejvice),{available:16,preReservation:1,sold:2,performance:2});
  assert.equal(projectSalesPerformanceCount(dejvice), 2);
  assert.equal(projectSalesPerformancePercent(dejvice), 11);
});

test("rezervovaná jednotka je obchodně prodaná a není dostupná", () => {
  assert.equal(getCommercialSalesBucket("Volný"),"available");
  assert.equal(getCommercialSalesBucket("Předrezervovaná"),"preReservation");
  assert.equal(getCommercialSalesBucket("Rezervovaná"),"sold");
  assert.equal(getCommercialSalesBucket("Prodaná"),"sold");
  assert.equal(getCommercialSalesBucket("Předaná"),"sold");
  assert.equal(isUnitCommerciallyAvailable("Volný"),true);
  for(const status of ["Předrezervovaná","Rezervovaná","Prodaná","Předaná"]) assert.equal(isUnitCommerciallyAvailable(status),false);
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

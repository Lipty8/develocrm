import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { nextSortDirection, stableSort } from "../app/lib/sorting.ts";
import { activeTableFilterCount, filterTableRows, matchesTableFilter, retainHiddenColumnFilter } from "../app/lib/table-filtering.mjs";

test("řazení používá jednotný cyklus vzestupně, sestupně, bez řazení", () => {
  assert.equal(nextSortDirection(undefined), "asc");
  assert.equal(nextSortDirection("asc"), "desc");
  assert.equal(nextSortDirection("desc"), "none");
  const rows = [{ id: "b", value: 2 }, { id: "a", value: 1 }];
  assert.deepEqual(stableSort(rows, row => row.value, "asc", row => row.id).map(row => row.id), ["a", "b"]);
  assert.deepEqual(stableSort(rows, row => row.value, "desc", row => row.id).map(row => row.id), ["b", "a"]);
  assert.deepEqual(stableSort(rows, row => row.value, "none", row => row.id), rows);
});

test("sdílené filtry pokrývají text, enum, rozsah, datum, vazbu a boolean", () => {
  assert.equal(matchesTableFilter("Rezidence Dejvice", { type: "text", value: "dej", operator: "contains" }), true);
  assert.equal(matchesTableFilter("Rezervovaná", { type: "enum", value: ["Volná", "Rezervovaná"] }), true);
  assert.equal(matchesTableFilter(12_500_000, { type: "number-range", from: 10_000_000, to: 15_000_000 }), true);
  assert.equal(matchesTableFilter("2026-09-10", { type: "date-range", from: "2026-09-01", to: "2026-09-30" }), true);
  assert.equal(matchesTableFilter("Adam Lipták", { type: "relation", value: ["Adam Lipták"] }), true);
  assert.equal(matchesTableFilter(true, { type: "boolean", value: true }), true);
});

test("více filtrů se kombinuje pomocí AND a lze je společně resetovat", () => {
  const rows = [{ id: 1, layout: "3+kk", price: 14_000_000, state: "Volná" }, { id: 2, layout: "3+kk", price: 16_000_000, state: "Volná" }];
  const filters = { layout: { type: "enum", value: ["3+kk"] }, price: { type: "number-range", to: 15_000_000 }, state: { type: "enum", value: ["Volná"] } };
  assert.deepEqual(filterTableRows(rows, filters, { layout: row => row.layout, price: row => row.price, state: row => row.state }).map(row => row.id), [1]);
  assert.equal(activeTableFilterCount(filters), 3);
  assert.deepEqual(retainHiddenColumnFilter(filters), filters);
});

test("hlavičky a metadata jsou sdílené napříč hlavními tabulkami", async () => {
  const [filters, columns, crm] = await Promise.all([
    readFile(new URL("../app/components/table-column-filter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/table-column-config.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/CRMApp.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(filters, /nextSortDirection/);
  assert.match(filters, /Bez řazení/);
  for (const property of ["sortable", "filterable", "filterType", "accessor", "formatter"]) assert.match(columns, new RegExp(property));
  for (const tableId of ["units-table", "clients-table", "cellars-table", "parking-table", "contracts-table", "payments-table", "handovers-table", "tasks-table", "documents-table"]) assert.match(crm, new RegExp(tableId));
});

test("projektové seznamy načítají data s projectId scope", async () => {
  const crm = await readFile(new URL("../app/CRMApp.tsx", import.meta.url), "utf8");
  assert.match(crm, /clientRepository\.getPage\(\{page:1,pageSize:100,projectId\}/);
  assert.match(crm, /paymentRepository\.list\(\{projectId\}/);
  assert.match(crm, /handoverRepository\.list\(\{projectId\}/);
});

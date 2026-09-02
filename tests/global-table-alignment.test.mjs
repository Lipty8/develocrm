import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const crm = fs.readFileSync(new URL("../app/CRMApp.tsx", import.meta.url), "utf8");
const columns = fs.readFileSync(new URL("../app/components/table-column-config.tsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("sdílená tabulka centruje hlavičky i hodnoty jako výchozí pravidlo", () => {
  assert.match(styles, /\.data-table \{[^}]*text-align: center/);
  assert.match(styles, /\.data-table th \{[^}]*text-align: center/);
  assert.match(styles, /\.data-table td \{[^}]*text-align: center/);
  assert.doesNotMatch(styles, /\.data-table td:last-child \{ text-align: right/);
  assert.match(columns, /align\?: "center" \| "action"/);
  assert.match(columns, /\?\.align \?\? "center"/);
});

test("všechny konfigurovatelné CRM sloupce mají centrované zarovnání", () => {
  assert.doesNotMatch(crm, /align:"start"/);
  for (const tableId of ["units-table", "clients-table", "contracts-table", "payments-table", "tasks-table", "handovers-table", "documents-table"]) {
    assert.match(crm, new RegExp(`useTableColumns\\(\\"${tableId}\\"`));
  }
  assert.match(crm, /mode==="cellar"\?"cellars-table":"parking-table"/);
});

test("tabulkově vykreslené seznamy používají stejnou centrovací vrstvu", () => {
  assert.match(styles, /\.data-list-grid\{text-align:center\}/);
  assert.match(styles, /\.data-list-grid>\*\{justify-self:center;text-align:center\}/);
  for (const className of ["handover-future-head data-list-grid", "task-list-head data-list-grid", "document-table-head data-list-grid"]) {
    assert.ok(crm.includes(className));
  }
  assert.match(styles, /\.change-documents \{[^}]*align-items: center/);
  assert.match(styles, /\.client-name-cell \{[^}]*justify-content: center/);
});

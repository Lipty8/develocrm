import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  defaultVisibleColumns,
  normalizeVisibleColumns,
  tableColumnStorageKey,
  toggleVisibleColumn,
} from "../app/lib/table-column-preferences.mjs";

const columns = [
  { id: "name", label: "Název", required: true, defaultVisible: true },
  { id: "price", label: "Cena", defaultVisible: true },
  { id: "status", label: "Stav" },
];

test("viditelné sloupce lze skrýt, znovu zobrazit a povinný sloupec zůstane", () => {
  assert.deepEqual(defaultVisibleColumns(columns), ["name", "price"]);
  const hidden = toggleVisibleColumn(columns, ["name", "price"], "price");
  assert.deepEqual(hidden, ["name"]);
  assert.deepEqual(toggleVisibleColumn(columns, hidden, "price"), ["name", "price"]);
  assert.deepEqual(toggleVisibleColumn(columns, ["name"], "name"), ["name"]);
});

test("uložená preference se bezpečně normalizuje a reset používá výchozí sadu", () => {
  assert.deepEqual(normalizeVisibleColumns(columns, ["status", "unknown"]), ["name", "status"]);
  assert.deepEqual(normalizeVisibleColumns(columns, null), ["name", "price"]);
});

test("preference jsou oddělené podle uživatele a typu tabulky", () => {
  assert.notEqual(tableColumnStorageKey("user-a", "units-table"), tableColumnStorageKey("user-b", "units-table"));
  assert.notEqual(tableColumnStorageKey("user-a", "units-table"), tableColumnStorageKey("user-a", "clients-table"));
});

test("hlavní CRM tabulky používají sdílené nastavení sloupců", () => {
  const source = fs.readFileSync(new URL("../app/CRMApp.tsx", import.meta.url), "utf8");
  for (const tableId of ["units-table", "clients-table", "cellars-table", "parking-table", "contracts-table", "payments-table", "tasks-table", "handovers-table", "documents-table"]) {
    assert.match(source, new RegExp(`\\"${tableId}\\"`));
  }
  assert.match(source, /Obnovit výchozí sloupce|TableColumnMenu/);
});

test("široké tabulky zachovají horizontální scroll a identifikační sloupec", () => {
  const css = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.configurable-table\{min-width:max-content\}/);
  assert.match(css, /\.column-primary\{position:sticky;left:0/);
});

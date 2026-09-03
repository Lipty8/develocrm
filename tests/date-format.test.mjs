import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const {
  formatPragueDate,
  formatPragueDateTime,
  formatPragueMonthYear,
} = await import("../app/lib/date-format.ts");

const crm = await readFile(new URL("../app/CRMApp.tsx", import.meta.url), "utf8");

test("UTC čas se v zimě převede do Europe/Prague bez sekund", () => {
  assert.equal(formatPragueDateTime("2026-01-15T10:30:45.123Z"), "15. 1. 2026 11:30");
});

test("UTC čas se v létě převede do Europe/Prague bez sekund", () => {
  assert.equal(formatPragueDateTime("2026-07-15T10:30:45.123Z"), "15. 7. 2026 12:30");
});

test("samotné datum a měsíc s rokem mají český formát", () => {
  assert.equal(formatPragueDate("2026-08-18T10:30:05.975Z"), "18. 8. 2026");
  assert.equal(formatPragueMonthYear("2026-12-01T00:00:00.000Z"), "prosinec 2026");
});

test("prázdná a neplatná hodnota se zobrazí jako pomlčka", () => {
  assert.equal(formatPragueDateTime(null), "—");
  assert.equal(formatPragueDate(undefined), "—");
  assert.equal(formatPragueMonthYear("not-a-date"), "—");
});

test("uživatelská zobrazení neobcházejí formatter raw hodnotou smlouvy", () => {
  assert.equal(crm.includes(">{contract.updated}</"), false);
  assert.match(crm, /formatPragueDateTime\(contract\.updatedAt\?\?contract\.updated\)/);
  assert.match(crm, /documentDateTime\(document\.updatedAt\)/);
});

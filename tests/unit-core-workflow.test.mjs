import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const crm=await readFile(new URL("../app/CRMApp.tsx",import.meta.url),"utf8");
const service=await readFile(new URL("../backend/src/commercial/service.ts",import.meta.url),"utf8");
const paymentMigration=await readFile(new URL("../backend/migrations/0024_unit_payment_and_contract_workflow.sql",import.meta.url),"utf8");

test("detail jednotky používá dynamickou smluvní akci a nemá duplicitní doporučený blok",()=>{
  assert.match(crm,/getNextContractAction\(unitId/);
  assert.doesNotMatch(crm,/Vygenerovat SBK/);
  assert.doesNotMatch(crm,/DOPORUČENÝ DALŠÍ KROK/);
});

test("kontextová smlouva je předvyplněná a backend určuje typ i identitu",()=>{
  assert.match(service,/getNextContractAction/);
  assert.match(service,/contextualContractIdentity/);
  assert.match(crm,/Jednotka, klient, projekt i obchodní proces se doplní automaticky/);
});

test("úhrada na jednotce používá transakce a oprávnění payments.record",()=>{
  assert.match(crm,/canRecordPayment/);
  assert.match(crm,/Zaplacená částka/);
  assert.match(crm,/Variabilní symbol/);
  assert.match(paymentMigration,/INSERT INTO payment_transactions/);
  assert.match(paymentMigration,/INSERT INTO payment_allocations/);
  assert.match(paymentMigration,/payments\.record/);
  assert.match(paymentMigration,/payment\.recorded\.v1/);
});

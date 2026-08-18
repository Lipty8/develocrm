import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const crm=await readFile(new URL("../app/CRMApp.tsx",import.meta.url),"utf8");
const clientRepository=await readFile(new URL("../app/repositories/client-repository.ts",import.meta.url),"utf8");
const migration=await readFile(new URL("../backend/migrations/0029_contract_party_assignments.sql",import.meta.url),"utf8");

test("postoupení používá jednu idempotentní operaci a podporuje více kupujících",()=>{
  assert.match(clientRepository,/buyers:Array<\{partyId:string;role:"buyer"\|"co_buyer";isPrimary:boolean/);
  assert.match(clientRepository,/idempotencyKey:string/);
  assert.match(crm,/Aktuální kupující po změně/);
  assert.match(crm,/type="checkbox" checked=\{selected\.includes\(client\.id\)\}/);
  assert.match(crm,/type="radio" name="primary-buyer"/);
  assert.match(migration,/CREATE OR REPLACE FUNCTION app\.assign_sales_case_buyers/);
  assert.match(migration,/buyer_assignment\.transferred\.v1/);
});

test("smlouva zůstává oddělená od aktuálního kupujícího a ukazuje historické strany",()=>{
  assert.match(migration,/ADD COLUMN effective_from/);
  assert.match(migration,/ADD COLUMN effective_to/);
  assert.match(migration,/contracts_one_live_core_type_uq/);
  assert.match(crm,/Aktuální smluvní strany/);
  assert.match(crm,/Historické smluvní strany/);
  assert.match(crm,/Historie kupujících/);
  assert.match(crm,/Postoupení smlouvy/);
});

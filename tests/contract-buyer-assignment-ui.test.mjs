import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const crm=await readFile(new URL("../app/CRMApp.tsx",import.meta.url),"utf8");
const commercialRepository=await readFile(new URL("../app/repositories/commercial-repository.ts",import.meta.url),"utf8");
const migration=await readFile(new URL("../backend/migrations/0030_contract_assignment_workflow.sql",import.meta.url),"utf8");
const assignmentRoute=await readFile(new URL("../app/api/commercial/units/[unitId]/contract-assignment/route.ts",import.meta.url),"utf8");

test("postoupení vytváří samostatný idempotentní dokument a podporuje více kupujících",()=>{
  assert.match(commercialRepository,/createContractAssignment/);
  assert.match(commercialRepository,/buyers\?:Array<\{partyId:string;role:"buyer"\|"co_buyer";isPrimary:boolean/);
  assert.match(commercialRepository,/idempotencyKey:string/);
  assert.match(assignmentRoute,/contract-assignment/);
  assert.match(crm,/Vytvořit dokument o postoupení/);
  assert.match(crm,/type="checkbox" checked=\{selected\.includes\(client\.id\)\}/);
  assert.match(crm,/type="radio" name="primary-buyer"/);
  assert.match(migration,/CREATE OR REPLACE FUNCTION app\.create_contract_assignment/);
  assert.match(migration,/CREATE OR REPLACE FUNCTION app\.complete_contract_assignment/);
  assert.match(migration,/contract\.assignment_completed\.v1/);
});

test("původní smlouva zůstává oddělená od postoupení a UI ukazuje právní řetězec",()=>{
  assert.match(migration,/assignment_rs/);
  assert.match(migration,/assignment_sbk/);
  assert.match(migration,/parent_contract_id/);
  assert.match(migration,/participant_role.*assignor.*assignee/s);
  assert.match(crm,/Aktuální smluvní strany/);
  assert.match(crm,/Postupitelé/);
  assert.match(crm,/Navazuje na/);
  assert.match(crm,/Historie kupujících/);
  assert.match(crm,/Kupující se v jednotce a obchodním procesu přepne teprve po označení dokumentu o postoupení jako podepsaného/);
});

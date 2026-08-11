import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const crm=await readFile(new URL("../app/CRMApp.tsx",import.meta.url),"utf8");
const migration=await readFile(new URL("../backend/migrations/0020_core_sales_workflow.sql",import.meta.url),"utf8");

test("zájem a předrezervace mají volitelnou poznámku a přednastavenou platnost",()=>{assert.doesNotMatch(crm,/Doplňte důvod operace/);assert.match(crm,/Poznámka \(volitelné\)/);for(const label of ["24 hodin","48 hodin","3 dny","5 dní","7 dní","14 dní","Vlastní termín"])assert.match(crm,new RegExp(label));assert.doesNotMatch(crm,/Operace atomicky aktualizuje/);});
test("celá historie otevírá záložku jednotky a kontext používá české názvy",()=>{assert.match(crm,/action="Celá historie" onAction=\{\(\) => openTab\("history"\)\}/);assert.match(crm,/Aktivní proces/);assert.match(crm,/DOPORUČENÝ DALŠÍ KROK/);assert.doesNotMatch(crm,/>\{commercial\?\.stage\?\?/);});
test("smlouva zakládá logickou verzi a platební povinnost v jedné doménové operaci",()=>{assert.match(migration,/CREATE OR REPLACE FUNCTION app\.create_contract_with_payment/);assert.match(migration,/INSERT INTO contract_versions/);assert.match(migration,/INSERT INTO payment_obligations/);assert.match(migration,/contracts_idempotency_uq/);assert.match(crm,/Procento z aktuální ceny/);assert.match(crm,/Pevná částka v Kč/);});

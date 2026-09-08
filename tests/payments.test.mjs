import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
const read=path=>readFile(new URL(`../${path}`,import.meta.url),"utf8");

test("platební UI používá jeden repository pro globální i kontextové pohledy",async()=>{
  const [app,repository,api]=await Promise.all([read("app/CRMApp.tsx"),read("app/repositories/payment-repository.ts"),read("app/api/payments/route.ts")]);
  assert.match(app,/function PaymentsPage/);assert.match(app,/function PaymentContextTable/);assert.match(app,/PaymentDetailModal/);
  assert.match(app,/filters=\{\{partyId:selectedClient\.id\}\}/);assert.match(app,/filters=\{\{contractId:selectedContract\.id\}\}/);
  assert.match(repository,/interface PaymentRepository/);assert.match(repository,/previewCsv/);assert.match(repository,/confirmImport/);
  assert.match(repository,/localStorage\.setItem\(STORAGE_KEY/);assert.match(repository,/duplicate/);assert.match(api,/\/v1\/payments/);
});

test("projektová platební povinnost umožní bezpečnou částečnou úhradu",async()=>{
  const [app,repository,migration,backend]=await Promise.all([read("app/CRMApp.tsx"),read("app/repositories/payment-repository.ts"),read("backend/migrations/0035_manual_payment_recording.sql"),read("backend/src/app.ts")]);
  assert.match(app,/canRecordPayment=\{can\("payments\.record"\)\|\|can\("payments\.manage"\)\}/);
  assert.match(app,/Uhradit platbu/);assert.match(app,/max=\{remaining\}/);assert.match(app,/idempotencyKey/);
  assert.match(repository,/partially_paid:"Částečně uhrazeno"/);assert.match(app,/Historie úhrad/);assert.match(app,/Ruční úhrada/);
  assert.match(repository,/input\.amount>remaining/);assert.match(repository,/pending:"Neuhrazeno"/);
  assert.match(migration,/payment amount exceeds remaining obligation amount/);assert.match(migration,/payment_transaction_idempotency_uq/);assert.match(migration,/source_type/);
  assert.match(backend,/Částka úhrady nesmí být vyšší než zbývající částka/);
});

test("modal úhrady používá vzdušný responzivní layout a čitelný peněžní vstup",async()=>{
  const [app,styles]=await Promise.all([read("app/CRMApp.tsx"),read("app/globals.css")]);
  assert.match(app,/modal form-modal payment-record-modal/);
  assert.match(app,/modal-form payment-record-body/);
  assert.match(app,/payment-record-primary-fields/);
  assert.match(app,/className="money-input"/);
  assert.match(app,/toLocaleString\("cs-CZ"\)/);
  assert.match(app,/inputMode="decimal"/);
  assert.match(app,/rows=\{3\}/);
  assert.match(app,/className="modal-foot"/);
  assert.match(styles,/\.payment-record-primary-fields\{display:grid;grid-template-columns:minmax\(0,3fr\) minmax\(0,2fr\)/);
  assert.match(styles,/\.payment-record-modal>\.modal-foot\{padding:16px 24px\}/);
  assert.match(styles,/@media\(max-width:700px\).*\.payment-record-primary-fields\{grid-template-columns:1fr\}/s);
});

test("import výpisu je náhled s potvrzením, nikoli falešně hotové tlačítko",async()=>{
  const app=await read("app/CRMApp.tsx");
  assert.match(app,/Import CSV · nejdřív náhled/);assert.match(app,/Žádná transakce nebude spárována bez vašeho potvrzení/);
  assert.match(app,/Duplicita/);assert.match(app,/Potvrdit \$\{ready\} transakcí/);
});

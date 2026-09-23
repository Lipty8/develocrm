import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {PGlite} from "@electric-sql/pglite";
import {PaymentRepository} from "../src/payments/repository.js";

const tenant="d0000000-0000-4000-8000-000000000001";
const user="d1000000-0000-4000-8000-000000000001";
const member="d3000000-0000-4000-8000-000000000001";
const salesCase="c6000000-0000-4000-8000-000000000003";
const source=(path:string)=>readFile(new URL(path,import.meta.url),"utf8");

async function database(){
  const db=new PGlite();
  for(const name of ["0001_block_a_identity.sql","0002_block_b_inventory.sql","0003_block_c_sales.sql","0004_block_d_pricing_contracts.sql"])await db.exec(await source(`../migrations/${name}`));
  for(const name of ["0001_preview_block_b.sql","0002_preview_block_c.sql","0003_preview_block_d.sql"])await db.exec(await source(`../seeds/${name}`));
  for(const name of [
    "0007_practical_editing_rbac.sql","0011_v31_workflow_and_administration.sql","0012_v32_granular_rbac_profiles_and_price_approval.sql","0013_v32_scope_enforcement.sql",
    "0014_payments_and_reservation_activation.sql","0020_core_sales_workflow.sql","0021_contract_external_signature.sql","0022_rs_signature_reservation.sql","0023_atomic_party_prereservation.sql",
    "0024_unit_payment_and_contract_workflow.sql","0028_contract_workflow_and_buyer_assignment.sql","0029_contract_party_assignments.sql","0030_contract_assignment_workflow.sql",
    "0031_accessory_pricing_and_contract_references.sql","0035_manual_payment_recording.sql","0038_contract_addenda_notes_and_refunds.sql","0039_payment_refund_availability.sql","0043_phase1_business_rules.sql",
  ])await db.exec(await source(`../migrations/${name}`));
  await db.exec(`INSERT INTO role_assignments(tenant_id,membership_id,role_id,assigned_by_user_id) VALUES('${tenant}','${member}','d4000000-0000-4000-8000-000000000001','${user}') ON CONFLICT DO NOTHING`);
  await db.exec(`SET ROLE develocrm_app;SELECT set_config('app.user_id','${user}',false);SELECT set_config('app.tenant_id','${tenant}',false);`);
  return db;
}

async function paidSignedRs(db:PGlite,key:string){
  const due=new Date(Date.now()+7*86_400_000).toISOString();
  const created=(await db.query<{contract_id:string;version_id:string;payment_obligation_id:string}>("SELECT * FROM app.create_contract_with_payment($1,$2,'rs',$3,$4,$5,NULL,$6,'fixed',250000,$7)",[tenant,salesCase,`PHASE1-${key}`,`RS ${key}`,member,key,due])).rows[0];
  for(const status of ["sent","approved"])await db.query("SELECT app.transition_contract_status($1,$2,$3,'Test workflow',$4)",[tenant,created.contract_id,status,member]);
  await db.query("SELECT * FROM app.sign_contract_externally($1,$2,$3,now(),$4,'Test podpis')",[tenant,created.contract_id,created.version_id,member]);
  const transaction=(await db.query<{id:string}>("SELECT app.record_payment($1,$2,100000,now(),NULL,NULL,NULL,'Přijatá platba',$3,$4) id",[tenant,created.payment_obligation_id,`${key}-payment`,member])).rows[0].id;
  return{...created,transaction};
}

test("ukončení smlouvy vyžaduje explicitní rozhodnutí a vratka respektuje rozhodnutou částku",async()=>{
  const db=await database();const paid=await paidSignedRs(db,"refund-decision");
  await assert.rejects(db.query("SELECT app.transition_contract_status_with_refund_decisions($1,$2,'cancelled','Klient odstoupil','[]'::jsonb,$3,$4)",[tenant,paid.contract_id,"cancel-no-decision",member]),/explicit refund decision/i);
  const decisions=JSON.stringify([{obligationId:paid.payment_obligation_id,decision:"partial",amount:40000}]);
  const first=(await db.query<{id:string}>("SELECT app.transition_contract_status_with_refund_decisions($1,$2,'cancelled','Klient odstoupil',$3::jsonb,$4,$5) id",[tenant,paid.contract_id,decisions,"cancel-with-decision",member])).rows[0].id;
  const retry=(await db.query<{id:string}>("SELECT app.transition_contract_status_with_refund_decisions($1,$2,'cancelled','Klient odstoupil',$3::jsonb,$4,$5) id",[tenant,paid.contract_id,decisions,"cancel-with-decision",member])).rows[0].id;
  assert.equal(retry,first);
  assert.equal((await db.query<{count:number}>("SELECT count(*)::int count FROM payment_refund_decisions WHERE obligation_id=$1",[paid.payment_obligation_id])).rows[0].count,1);
  await db.query("SELECT app.create_payment_refund($1,$2,$3,10000,now(),'První část vratky',$4,$5)",[tenant,paid.payment_obligation_id,paid.transaction,"phase1-refund-part-1",member]);
  const repository=new PaymentRepository({withContext:async(_context:{tenantId:string;userId:string},operation:(client:PGlite)=>Promise<unknown>)=>operation(db)} as never);
  const payment=(await repository.list({tenantId:tenant,userId:user,membershipId:member})).payments.find(row=>row.id===paid.payment_obligation_id);
  assert.equal(payment?.refundDecision,"partial");assert.equal(payment?.refundable,30000);assert.equal(payment?.refundAllowed,true);
  await db.close();
});

test("změna splatnosti zachová původní datum, historii, audit a idempotenci",async()=>{
  const db=await database();const paid=await paidSignedRs(db,"due-date");
  const original=(await db.query<{due_at:string}>("SELECT due_at::text FROM payment_obligations WHERE id=$1",[paid.payment_obligation_id])).rows[0].due_at;
  const next=new Date(Date.now()+30*86_400_000).toISOString();
  const first=(await db.query<{id:string}>("SELECT app.change_payment_obligation_due_date($1,$2,$3,'Dohoda s klientem',$4,$5) id",[tenant,paid.payment_obligation_id,next,"due-change-command",member])).rows[0].id;
  const retry=(await db.query<{id:string}>("SELECT app.change_payment_obligation_due_date($1,$2,$3,'Jiný text při retry',$4,$5) id",[tenant,paid.payment_obligation_id,next,"due-change-command",member])).rows[0].id;
  assert.equal(retry,first);
  const row=(await db.query<{original_due_at:string;due_at:string}>("SELECT original_due_at::text,due_at::text FROM payment_obligations WHERE id=$1",[paid.payment_obligation_id])).rows[0];
  assert.equal(row.original_due_at,original);assert.match(row.due_at,/^\d{4}-\d{2}-\d{2}/);
  assert.equal((await db.query<{count:number}>("SELECT count(*)::int count FROM payment_due_date_changes WHERE obligation_id=$1",[paid.payment_obligation_id])).rows[0].count,1);
  assert.equal((await db.query<{count:number}>("SELECT count(*)::int count FROM audit_log WHERE action='payment.due_date_changed' AND entity_id=$1",[paid.payment_obligation_id])).rows[0].count,1);
  await db.close();
});

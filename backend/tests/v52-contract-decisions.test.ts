import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {PGlite} from "@electric-sql/pglite";
import {PaymentRepository} from "../src/payments/repository.js";

const tenant="d0000000-0000-4000-8000-000000000001";
const user="d1000000-0000-4000-8000-000000000001";
const member="d3000000-0000-4000-8000-000000000001";
const salesCase="c6000000-0000-4000-8000-000000000003";

async function source(path:string){return readFile(new URL(path,import.meta.url),"utf8");}

async function database(){
  const db=new PGlite();
  for(const name of ["0001_block_a_identity.sql","0002_block_b_inventory.sql","0003_block_c_sales.sql","0004_block_d_pricing_contracts.sql"]){
    await db.exec(await source(`../migrations/${name}`));
  }
  for(const name of ["0001_preview_block_b.sql","0002_preview_block_c.sql","0003_preview_block_d.sql"]){
    await db.exec(await source(`../seeds/${name}`));
  }
  for(const name of [
    "0007_practical_editing_rbac.sql","0011_v31_workflow_and_administration.sql","0012_v32_granular_rbac_profiles_and_price_approval.sql",
    "0013_v32_scope_enforcement.sql","0014_payments_and_reservation_activation.sql","0020_core_sales_workflow.sql",
    "0021_contract_external_signature.sql","0022_rs_signature_reservation.sql","0023_atomic_party_prereservation.sql",
    "0024_unit_payment_and_contract_workflow.sql","0028_contract_workflow_and_buyer_assignment.sql","0029_contract_party_assignments.sql",
    "0030_contract_assignment_workflow.sql","0031_accessory_pricing_and_contract_references.sql","0035_manual_payment_recording.sql",
    "0038_contract_addenda_notes_and_refunds.sql","0039_payment_refund_availability.sql",
  ])await db.exec(await source(`../migrations/${name}`));
  await db.exec(`INSERT INTO role_assignments(tenant_id,membership_id,role_id,assigned_by_user_id) VALUES('${tenant}','${member}','d4000000-0000-4000-8000-000000000001','${user}') ON CONFLICT DO NOTHING`);
  await db.exec(`SET ROLE develocrm_app;SELECT set_config('app.user_id','${user}',false);SELECT set_config('app.tenant_id','${tenant}',false);`);
  return db;
}

async function createRs(db:PGlite,key:string){
  const due=new Date(Date.now()+7*86_400_000).toISOString();
  return (await db.query<{contract_id:string;version_id:string;payment_obligation_id:string}>(
    "SELECT * FROM app.create_contract_with_payment($1,$2,'rs',$3,$4,$5,NULL,$6,'fixed',250000,$7)",
    [tenant,salesCase,`DEJ-TEST-${key}`,`Testovací RS ${key}`,member,key,due],
  )).rows[0];
}

async function sign(db:PGlite,contractId:string,versionId:string){
  for(const status of ["sent","approved"]){
    await db.query("SELECT app.transition_contract_status($1,$2,$3,'Test workflow',$4)",[tenant,contractId,status,member]);
  }
  await db.query("SELECT * FROM app.sign_contract_externally($1,$2,$3,now(),$4,'Test podpis')",[tenant,contractId,versionId,member]);
}

test("dodatek vznikne pouze k podepsané smlouvě, čísluje se D01/D02 a má vlastní verze",async()=>{
  const db=await database();
  const base=await createRs(db,"addendum-base");
  await assert.rejects(
    db.query("SELECT * FROM app.create_contract_addendum($1,$2,NULL,$3,$4)",[tenant,base.contract_id,member,"addendum-before-sign"]),
    /signed base contract/i,
  );
  await sign(db,base.contract_id,base.version_id);
  const first=(await db.query<{contract_id:string;version_id:string;amendment_number:number;reference:string}>(
    "SELECT * FROM app.create_contract_addendum($1,$2,$3,$4,$5)",[tenant,base.contract_id,"První dodatek",member,"addendum-command-01"],
  )).rows[0];
  const retry=(await db.query<{contract_id:string}>(
    "SELECT * FROM app.create_contract_addendum($1,$2,$3,$4,$5)",[tenant,base.contract_id,"Jiný název se při retry nepoužije",member,"addendum-command-01"],
  )).rows[0];
  const second=(await db.query<{contract_id:string;amendment_number:number;reference:string}>(
    "SELECT * FROM app.create_contract_addendum($1,$2,NULL,$3,$4)",[tenant,base.contract_id,member,"addendum-command-02"],
  )).rows[0];
  assert.equal(retry.contract_id,first.contract_id);
  assert.equal(first.amendment_number,1);assert.match(first.reference,/-D01$/);
  assert.equal(second.amendment_number,2);assert.match(second.reference,/-D02$/);
  const firstRow=(await db.query<{base_contract_type:string;parent_contract_id:string}>("SELECT base_contract_type,parent_contract_id FROM contracts WHERE id=$1",[first.contract_id])).rows[0];
  assert.deepEqual(firstRow,{base_contract_type:"rs",parent_contract_id:base.contract_id});
  assert.equal((await db.query("SELECT id FROM contract_versions WHERE contract_id=$1 AND version_number=1",[first.contract_id])).rows.length,1);
  assert.equal((await db.query("SELECT id FROM contract_parties WHERE contract_id=$1 AND effective_to IS NULL",[first.contract_id])).rows.length>0,true);
  await db.query("SELECT app.create_contract_version($1,$2,'Dodatek D01 v02','manual',$3,$4,'{}'::jsonb)",[tenant,first.contract_id,member,first.version_id]);
  assert.equal((await db.query<{count:number}>("SELECT count(*)::int count FROM contract_versions WHERE contract_id=$1",[first.contract_id])).rows[0].count,2);
  assert.equal((await db.query<{count:number}>("SELECT count(*)::int count FROM audit_log WHERE entity_id IN ($1,$2) AND action='contract.addendum_created'",[first.contract_id,second.contract_id])).rows[0].count,2);
  await db.close();
});

test("interní poznámka je append-only, řadí se od nejnovější a archivace zachová audit",async()=>{
  const db=await database();
  const base=await createRs(db,"notes-base");
  const first=(await db.query<{id:string}>("SELECT app.add_contract_note($1,$2,'První poznámka',$3) id",[tenant,base.contract_id,member])).rows[0].id;
  const second=(await db.query<{id:string}>("SELECT app.add_contract_note($1,$2,'Druhá poznámka',$3) id",[tenant,base.contract_id,member])).rows[0].id;
  const listed=await db.query<{id:string;text:string}>("SELECT id,text FROM contract_notes WHERE contract_id=$1 ORDER BY created_at DESC,id DESC",[base.contract_id]);
  assert.equal(listed.rows[0].id,second);assert.equal(listed.rows[1].id,first);
  await db.query("SELECT app.archive_contract_note($1,$2,'Chybná interní poznámka',$3)",[tenant,first,member]);
  await db.query("SELECT app.archive_contract_note($1,$2,'Opakovaný požadavek',$3)",[tenant,first,member]);
  assert.equal((await db.query("SELECT id FROM contract_notes WHERE id=$1 AND archived_at IS NOT NULL AND text='První poznámka'",[first])).rows.length,1);
  assert.equal((await db.query<{count:number}>("SELECT count(*)::int count FROM audit_log WHERE entity_id=$1 AND action='contract.note_archived'",[first])).rows[0].count,1);
  assert.equal((await db.query<{count:number}>("SELECT count(*)::int count FROM audit_log WHERE entity_id IN ($1,$2) AND action='contract.note_added'",[first,second])).rows[0].count,2);
  await db.close();
});

test("zrušená zaplacená RS zachová úhradu a umožní explicitní částečné vratky bez duplicit",async()=>{
  const db=await database();
  const base=await createRs(db,"refund-base");
  await sign(db,base.contract_id,base.version_id);
  const transaction=(await db.query<{id:string}>(
    "SELECT app.record_payment($1,$2,100000,now(),NULL,NULL,NULL,'Přijatý rezervační poplatek',$3,$4) id",
    [tenant,base.payment_obligation_id,"payment-for-refund",member],
  )).rows[0].id;
  await db.query("SELECT app.transition_contract_status($1,$2,'cancelled','Klient odstoupil',$3)",[tenant,base.contract_id,member]);
  assert.equal((await db.query("SELECT id FROM payment_transactions WHERE id=$1",[transaction])).rows.length,1);
  assert.equal((await db.query("SELECT id FROM payment_allocations WHERE transaction_id=$1 AND obligation_id=$2 AND amount=100000",[transaction,base.payment_obligation_id])).rows.length,1);
  const first=(await db.query<{id:string}>(
    "SELECT app.create_payment_refund($1,$2,$3,40000,now(),'Částečná vratka',$4,$5) id",
    [tenant,base.payment_obligation_id,transaction,"refund-command-0001",member],
  )).rows[0].id;
  const retry=(await db.query<{id:string}>(
    "SELECT app.create_payment_refund($1,$2,$3,40000,now(),'Částečná vratka',$4,$5) id",
    [tenant,base.payment_obligation_id,transaction,"refund-command-0001",member],
  )).rows[0].id;
  assert.equal(retry,first);
  await db.query("SELECT app.create_payment_refund($1,$2,$3,60000,now(),'Doplatek vratky',$4,$5)",[tenant,base.payment_obligation_id,transaction,"refund-command-0002",member]);
  await assert.rejects(
    db.query("SELECT app.create_payment_refund($1,$2,$3,1,now(),'Nad limit',$4,$5)",[tenant,base.payment_obligation_id,transaction,"refund-command-0003",member]),
    /exceeds refundable/i,
  );
  assert.equal((await db.query<{sum:string}>("SELECT sum(amount)::text sum FROM payment_refunds WHERE obligation_id=$1",[base.payment_obligation_id])).rows[0].sum,"100000.00");
  assert.equal((await db.query<{count:number}>("SELECT count(*)::int count FROM payment_refunds WHERE obligation_id=$1",[base.payment_obligation_id])).rows[0].count,2);
  assert.equal((await db.query<{count:number}>("SELECT count(*)::int count FROM audit_log WHERE action='payment.refund_created' AND metadata->>'obligationId'=$1",[base.payment_obligation_id])).rows[0].count,2);
  assert.equal((await db.query<{count:number}>("SELECT count(*)::int count FROM outbox_events WHERE event_type='payment.refund_created.v1' AND payload->>'obligationId'=$1",[base.payment_obligation_id])).rows[0].count,2);
  await db.close();
});

test("vratka respektuje stav RS, skutečnou úhradu, oprávnění a volitelnou poznámku",async()=>{
  const activeDb=await database();
  const active=await createRs(activeDb,"refund-active");
  const activeTransaction=(await activeDb.query<{id:string}>("SELECT app.record_payment($1,$2,100000,now(),NULL,NULL,NULL,NULL,$3,$4) id",[tenant,active.payment_obligation_id,"active-payment-0001",member])).rows[0].id;
  await assert.rejects(activeDb.query("SELECT app.create_payment_refund($1,$2,$3,1000,now(),NULL,$4,$5)",[tenant,active.payment_obligation_id,activeTransaction,"active-refund-0001",member]),/cancelled RS/i);
  await activeDb.close();

  const unpaidDb=await database();
  const unpaid=await createRs(unpaidDb,"refund-unpaid");await sign(unpaidDb,unpaid.contract_id,unpaid.version_id);await unpaidDb.query("SELECT app.transition_contract_status($1,$2,'cancelled','Ukončeno bez úhrady',$3)",[tenant,unpaid.contract_id,member]);
  await assert.rejects(unpaidDb.query("SELECT app.create_payment_refund($1,$2,$3,1000,now(),NULL,$4,$5)",[tenant,unpaid.payment_obligation_id,"00000000-0000-4000-8000-000000000099","unpaid-refund-01",member]),/received payment allocation/i);
  await unpaidDb.close();

  const paidDb=await database();
  const paid=await createRs(paidDb,"refund-permission");await sign(paidDb,paid.contract_id,paid.version_id);
  const paidTransaction=(await paidDb.query<{id:string}>("SELECT app.record_payment($1,$2,250000,now(),NULL,NULL,NULL,NULL,$3,$4) id",[tenant,paid.payment_obligation_id,"full-payment-0001",member])).rows[0].id;
  await paidDb.query("SELECT app.transition_contract_status($1,$2,'cancelled','Klient odstoupil',$3)",[tenant,paid.contract_id,member]);
  const repository=new PaymentRepository({withContext:async(_context:{tenantId:string;userId:string},operation:(client:PGlite)=>Promise<unknown>)=>operation(paidDb)} as never);
  const beforeRefund=await repository.list({tenantId:tenant,userId:user,membershipId:member});
  const projectedBefore=beforeRefund.payments.find((payment:{id:string})=>payment.id===paid.payment_obligation_id) as {refundable:number;refundAllowed:boolean};
  assert.equal(projectedBefore.refundable,250000);assert.equal(projectedBefore.refundAllowed,true);
  await assert.rejects(paidDb.query("SELECT app.create_payment_refund($1,$2,$3,1000,now(),NULL,$4,$5)",[tenant,paid.payment_obligation_id,paidTransaction,"no-permission-01","d3000000-0000-4000-8000-000000000004"]),/permission required/i);
  const refund=(await paidDb.query<{id:string}>("SELECT app.create_payment_refund($1,$2,$3,250000,now(),NULL,$4,$5) id",[tenant,paid.payment_obligation_id,paidTransaction,"optional-note-01",member])).rows[0];
  assert.equal((await paidDb.query<{reason:string}>("SELECT reason FROM payment_refunds WHERE id=$1",[refund.id])).rows[0].reason,"Bez poznámky");
  assert.equal((await paidDb.query<{refundable:string}>("SELECT (app.payment_obligation_paid($1,$2)-COALESCE(sum(amount),0))::text refundable FROM payment_refunds WHERE obligation_id=$2",[tenant,paid.payment_obligation_id])).rows[0].refundable,"0.00");
  const afterRefund=await repository.list({tenantId:tenant,userId:user,membershipId:member});
  const projectedAfter=afterRefund.payments.find((payment:{id:string})=>payment.id===paid.payment_obligation_id) as {refundable:number;refundAllowed:boolean};
  assert.equal(projectedAfter.refundable,0);assert.equal(projectedAfter.refundAllowed,false);
  await paidDb.close();
});

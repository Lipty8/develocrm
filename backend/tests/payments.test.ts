import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {PGlite} from "@electric-sql/pglite";

const tenant="d0000000-0000-4000-8000-000000000001";
const user="d1000000-0000-4000-8000-000000000001";
const member="d3000000-0000-4000-8000-000000000001";
const project="e0000000-0000-4000-8000-000000000001";
const unit="f0000000-0000-4000-8000-000000000003";
const salesCase="c6000000-0000-4000-8000-000000000002";
const contract="bd200000-0000-4000-8000-000000000002";
const party="c0000000-0000-4000-8000-000000000007";

async function database(){
  const db=new PGlite();
  for(const name of ["0001_block_a_identity.sql","0002_block_b_inventory.sql","0003_block_c_sales.sql","0004_block_d_pricing_contracts.sql","0011_v31_workflow_and_administration.sql"]){
    await db.exec(await readFile(new URL(`../migrations/${name}`,import.meta.url),"utf8"));
  }
  for(const name of ["0001_preview_block_b.sql","0002_preview_block_c.sql","0003_preview_block_d.sql"]){
    await db.exec(await readFile(new URL(`../seeds/${name}`,import.meta.url),"utf8"));
  }
  await db.exec(await readFile(new URL("../migrations/0014_payments_and_reservation_activation.sql",import.meta.url),"utf8"));
  await db.exec(await readFile(new URL("../migrations/0024_unit_payment_and_contract_workflow.sql",import.meta.url),"utf8"));
  await db.exec(`DELETE FROM role_assignments WHERE tenant_id='${tenant}' AND membership_id='${member}';
    INSERT INTO role_assignments(tenant_id,membership_id,role_id,assigned_by_user_id)
    VALUES('${tenant}','${member}','d4000000-0000-4000-8000-000000000001','${user}')`);
  return db;
}

async function asApp(db:PGlite){
  await db.exec(`SET ROLE develocrm_app;SELECT set_config('app.user_id','${user}',false);SELECT set_config('app.tenant_id','${tenant}',false);`);
}

async function signRs(db:PGlite){
  await db.exec("SELECT set_config('app.contract_status_command','on',false)");
  await db.query("UPDATE contracts SET current_status='signed',signed_at=now() WHERE tenant_id=$1 AND id=$2",[tenant,contract]);
}

test("podpis RS vytvoří jediný nastavitelný předpis rezervačního poplatku",async()=>{
  const db=await database();
  await db.query("UPDATE contracts SET reservation_fee_amount=300000,reservation_fee_due_days=3 WHERE id=$1",[contract]);
  await signRs(db);
  await db.query("UPDATE contracts SET current_status='signed' WHERE id=$1",[contract]);
  const rows=await db.query<{amount:number;days:number}>("SELECT amount::float8 amount,extract(day from due_at-created_at)::int days FROM payment_obligations WHERE contract_id=$1",[contract]);
  assert.equal(rows.rows.length,1);assert.equal(rows.rows[0].amount,300000);assert.equal(rows.rows[0].days,3);
  await db.close();
});

test("rezervaci nelze aktivovat bez podepsané RS ani bez úplné úhrady",async()=>{
  const db=await database();await asApp(db);
  await assert.rejects(db.query("SELECT * FROM app.create_unit_hold($1,$2,'reservation',ARRAY[$3]::uuid[],now()+interval '10 days',$4,NULL,'invalid-before-rs','Test rezervace')",[tenant,unit,party,member]),/signed RS/i);
  await db.exec("RESET ROLE");await signRs(db);await asApp(db);
  await assert.rejects(db.query("SELECT * FROM app.create_unit_hold($1,$2,'reservation',ARRAY[$3]::uuid[],now()+interval '10 days',$4,NULL,'invalid-before-fee','Test rezervace')",[tenant,unit,party,member]),/fully paid/i);
  await db.close();
});

test("částečné a vícečetné úhrady odvozují stav, přeplatek aktivuje rezervaci a reverzace zachová historii",async()=>{
  const db=await database();
  await db.query("SELECT app.transition_unit_commercial_status($1,$2,'available','cancelReservation','Příprava testu plateb',$3)",[tenant,unit,member]);
  await signRs(db);
  assert.equal((await db.query<{count:number}>("SELECT count(*)::int count FROM role_permissions grant_row JOIN permissions permission ON permission.id=grant_row.permission_id JOIN role_assignments assignment ON assignment.tenant_id=grant_row.tenant_id AND assignment.role_id=grant_row.role_id WHERE assignment.membership_id=$1 AND permission.code='payments.read'",[member])).rows[0].count,1);
  await asApp(db);
  assert.equal((await db.query<{allowed:boolean}>("SELECT app.has_project_permission($1,$2,$3,'payments.read') allowed",[tenant,member,project])).rows[0].allowed,true);
  const obligation=(await db.query<{id:string}>("SELECT id FROM payment_obligations WHERE contract_id=$1",[contract])).rows[0].id;
  const first=(await db.query<{id:string}>("SELECT app.record_payment($1,$2,100000,now(),'305','123','bank-1','První část',$3) id",[tenant,obligation,member])).rows[0].id;
  assert.equal((await db.query<{status:string}>("SELECT app.payment_obligation_status($1,$2,now()) status",[tenant,obligation])).rows[0].status,"partially_paid");
  await db.query("SELECT app.record_payment($1,$2,160000,now(),'305','123','bank-2','Druhá část',$3)",[tenant,obligation,member]);
  assert.equal((await db.query<{status:string}>("SELECT app.payment_obligation_status($1,$2,now()) status",[tenant,obligation])).rows[0].status,"overpaid");
  assert.equal((await db.query<{commercial_status:string}>("SELECT commercial_status FROM units WHERE id=$1",[unit])).rows[0].commercial_status,"reserved");
  assert.ok((await db.query("SELECT reservation_activated_at FROM sales_cases WHERE id=$1 AND reservation_activated_at IS NOT NULL",[salesCase])).rows.length===1);
  await db.query("SELECT app.reverse_payment($1,$2,'Chybně zadaná úhrada',$3)",[tenant,first,member]);
  assert.equal((await db.query<{status:string}>("SELECT app.payment_obligation_status($1,$2,now()) status",[tenant,obligation])).rows[0].status,"partially_paid");
  assert.ok((await db.query("SELECT id FROM payment_events WHERE obligation_id=$1 OR transaction_id=$2",[obligation,first])).rows.length>=3);
  assert.ok((await db.query("SELECT id FROM audit_log WHERE entity_id IN ($1,$2)",[obligation,first])).rows.length>=2);
  assert.ok((await db.query("SELECT id FROM outbox_events WHERE aggregate_id IN ($1,$2)",[obligation,first])).rows.length>=2);
  await db.close();
});

test("stav po splatnosti, RLS a project-scoped oprávnění jsou vynucené databází",async()=>{
  const db=await database();await signRs(db);
  const obligation=(await db.query<{id:string}>("SELECT id FROM payment_obligations WHERE contract_id=$1",[contract])).rows[0].id;
  assert.equal((await db.query<{status:string}>("SELECT app.payment_obligation_status($1,$2,now()+interval '40 days') status",[tenant,obligation])).rows[0].status,"overdue");
  const tables=["payment_obligations","payment_transactions","payment_allocations","payment_reversals","payment_events","bank_import_batches","bank_import_rows"];
  const policies=await db.query<{relrowsecurity:boolean;relforcerowsecurity:boolean}>("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=ANY($1::text[])",[tables]);
  assert.equal(policies.rows.length,tables.length);assert.ok(policies.rows.every(row=>row.relrowsecurity&&row.relforcerowsecurity));
  await db.close();
});

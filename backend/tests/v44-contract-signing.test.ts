import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {PGlite} from "@electric-sql/pglite";

const tenant="d0000000-0000-4000-8000-000000000001";
const user="d1000000-0000-4000-8000-000000000001";
const member="d3000000-0000-4000-8000-000000000001";
const salesCase="c6000000-0000-4000-8000-000000000002";

async function source(path:string){return readFile(new URL(path,import.meta.url),"utf8");}
async function database(){const db=new PGlite();for(const name of ["0001_block_a_identity.sql","0002_block_b_inventory.sql","0003_block_c_sales.sql","0004_block_d_pricing_contracts.sql","0011_v31_workflow_and_administration.sql"])await db.exec(await source(`../migrations/${name}`));for(const name of ["0001_preview_block_b.sql","0002_preview_block_c.sql","0003_preview_block_d.sql"])await db.exec(await source(`../seeds/${name}`));for(const name of ["0014_payments_and_reservation_activation.sql","0020_core_sales_workflow.sql","0021_contract_external_signature.sql"]){await db.exec(await source(`../migrations/${name}`));}await db.exec(`INSERT INTO role_assignments(tenant_id,membership_id,role_id,assigned_by_user_id) VALUES('${tenant}','${member}','d4000000-0000-4000-8000-000000000001','${user}') ON CONFLICT DO NOTHING`);await db.exec(await source("../migrations/0022_rs_signature_reservation.sql"));return db;}
async function asApp(db:PGlite){await db.exec(`SET ROLE develocrm_app;SELECT set_config('app.user_id','${user}',false);SELECT set_config('app.tenant_id','${tenant}',false);`);}

test("schválenou RS lze podepsat přes aktuální v01 a retry je idempotentní",async()=>{
  const db=await database();await asApp(db);
  const due=new Date(Date.now()+7*86400000).toISOString();
  const created=(await db.query<{contract_id:string;version_id:string;payment_obligation_id:string}>("SELECT * FROM app.create_contract_with_payment($1,$2,'rs','RS-SIGN-001','Test podpisu RS',$3,NULL,'rs-sign-test','fixed',250000,$4)",[tenant,salesCase,member,due])).rows[0];
  for(const state of ["sent","approved"])await db.query("SELECT app.transition_contract_status($1,$2,$3,'Test podpisu',$4)",[tenant,created.contract_id,state,member]);
  const signedAt=new Date(Date.now()-86400000).toISOString();
  const first=(await db.query<{completed:boolean;already_signed:boolean;version_id:string}>("SELECT * FROM app.sign_contract_externally($1,$2,$3,$4,$5,$6)",[tenant,created.contract_id,created.version_id,signedAt,member,"Podepsáno mimo CRM"])).rows[0];
  const retry=(await db.query<{completed:boolean;already_signed:boolean;version_id:string}>("SELECT * FROM app.sign_contract_externally($1,$2,$3,$4,$5,$6)",[tenant,created.contract_id,created.version_id,signedAt,member,"Retry"])).rows[0];
  assert.deepEqual(first,{completed:true,already_signed:false,version_id:created.version_id});
  assert.deepEqual(retry,{completed:true,already_signed:true,version_id:created.version_id});
  assert.equal((await db.query<{current_status:string}>("SELECT current_status FROM contracts WHERE id=$1",[created.contract_id])).rows[0].current_status,"signed");
  assert.equal((await db.query("SELECT id FROM contract_versions WHERE id=$1 AND version_status='signed' AND signed_at IS NOT NULL AND locked_at IS NOT NULL",[created.version_id])).rows.length,1);
  assert.ok((await db.query("SELECT id FROM contract_parties WHERE contract_id=$1 AND signing_required AND signature_status='signed' AND signed_version_id=$2",[created.contract_id,created.version_id])).rows.length>=1);
  assert.equal((await db.query("SELECT id FROM payment_obligations WHERE contract_id=$1",[created.contract_id])).rows.length,1);
  assert.equal((await db.query<{commercial_status:string}>("SELECT commercial_status FROM units WHERE id=(SELECT unit_id FROM contracts WHERE id=$1)",[created.contract_id])).rows[0].commercial_status,"reserved");
  assert.equal((await db.query<{current_stage:string}>("SELECT current_stage FROM sales_cases WHERE id=(SELECT sales_case_id FROM contracts WHERE id=$1)",[created.contract_id])).rows[0].current_stage,"reservation");
  assert.equal((await db.query("SELECT id FROM unit_holds WHERE sales_case_id=(SELECT sales_case_id FROM contracts WHERE id=$1) AND hold_type='reservation' AND status='active'",[created.contract_id])).rows.length,1);
  assert.equal((await db.query("SELECT id FROM contract_status_events WHERE contract_id=$1 AND to_status='signed'",[created.contract_id])).rows.length,1);
  assert.equal((await db.query("SELECT id FROM audit_log WHERE entity_id=$1 AND action='contract.signed'",[created.contract_id])).rows.length,1);
  assert.equal((await db.query("SELECT id FROM outbox_events WHERE aggregate_id=$1 AND event_type='contract.signed.v1'",[created.contract_id])).rows.length,1);
  assert.equal((await db.query("SELECT id FROM outbox_events WHERE aggregate_id=$1 AND event_type='rs.signature_reservation_activated.v1'",[created.contract_id])).rows.length,1);
  await db.close();
});

test("podpis odmítne starší nebo pracovní verzi a zachová smlouvu",async()=>{
  const db=await database();await asApp(db);
  const due=new Date(Date.now()+7*86400000).toISOString();
  const created=(await db.query<{contract_id:string;version_id:string}>("SELECT * FROM app.create_contract_with_payment($1,$2,'rs','RS-SIGN-002','Test neplatné verze',$3,NULL,'rs-sign-invalid','fixed',250000,$4)",[tenant,salesCase,member,due])).rows[0];
  await assert.rejects(db.query("SELECT * FROM app.sign_contract_externally($1,$2,$3,now(),$4,NULL)",[tenant,created.contract_id,created.version_id,member]),/approved or in signing/);
  for(const state of ["sent","approved"])await db.query("SELECT app.transition_contract_status($1,$2,$3,'Test podpisu',$4)",[tenant,created.contract_id,state,member]);
  await assert.rejects(db.query("SELECT * FROM app.sign_contract_externally($1,$2,gen_random_uuid(),now(),$3,NULL)",[tenant,created.contract_id,member]),/current contract version/);
  assert.equal((await db.query<{current_status:string}>("SELECT current_status FROM contracts WHERE id=$1",[created.contract_id])).rows[0].current_status,"approved");
  await db.close();
});

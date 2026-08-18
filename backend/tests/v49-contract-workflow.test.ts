import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {PGlite} from "@electric-sql/pglite";
import {
  CONTRACT_STATUS_ORDER,
  availableContractTransitions,
  contractStatusLabel,
} from "../src/shared/contract-workflow.js";

const tenant="d0000000-0000-4000-8000-000000000001";
const user="d1000000-0000-4000-8000-000000000001";
const member="d3000000-0000-4000-8000-000000000001";
const salesCase="c6000000-0000-4000-8000-000000000003";
const unit="f0000000-0000-4000-8000-000000000004";

async function source(path:string){return readFile(new URL(path,import.meta.url),"utf8");}
async function database(){
  const db=new PGlite();
  for(const name of ["0001_block_a_identity.sql","0002_block_b_inventory.sql","0003_block_c_sales.sql","0004_block_d_pricing_contracts.sql"]){
    await db.exec(await source(`../migrations/${name}`));
  }
  for(const name of ["0001_preview_block_b.sql","0002_preview_block_c.sql","0003_preview_block_d.sql"])await db.exec(await source(`../seeds/${name}`));
  for(const name of [
    "0007_practical_editing_rbac.sql","0011_v31_workflow_and_administration.sql","0012_v32_granular_rbac_profiles_and_price_approval.sql",
    "0013_v32_scope_enforcement.sql","0014_payments_and_reservation_activation.sql","0020_core_sales_workflow.sql",
    "0021_contract_external_signature.sql","0022_rs_signature_reservation.sql","0023_atomic_party_prereservation.sql",
    "0024_unit_payment_and_contract_workflow.sql","0028_contract_workflow_and_buyer_assignment.sql","0029_contract_party_assignments.sql",
  ])await db.exec(await source(`../migrations/${name}`));
  await db.exec(`INSERT INTO role_assignments(tenant_id,membership_id,role_id,assigned_by_user_id) VALUES('${tenant}','${member}','d4000000-0000-4000-8000-000000000001','${user}') ON CONFLICT DO NOTHING`);
  return db;
}
async function asApp(db:PGlite){await db.exec(`SET ROLE develocrm_app;SELECT set_config('app.user_id','${user}',false);SELECT set_config('app.tenant_id','${tenant}',false);`);}
async function createContract(db:PGlite,type:"rs"|"sbk"|"ks",key:string){
  const due=new Date(Date.now()+7*86400000).toISOString();
  return (await db.query<{contract_id:string;version_id:string;payment_obligation_id:string|null}>(
    "SELECT * FROM app.create_contract_with_payment($1,$2,$3,$4,$5,$6,NULL,$7,$8,$9,$10)",
    [tenant,salesCase,type,`${type.toUpperCase()}-${key}`,`Test ${type.toUpperCase()}`,member,key,...(type==="ks"?[null,null,null]:["fixed",250000,due])],
  )).rows[0];
}
async function approve(db:PGlite,contractId:string){for(const state of ["sent","approved"])await db.query("SELECT app.transition_contract_status($1,$2,$3,'Test workflow',$4)",[tenant,contractId,state,member]);}

test("veřejné workflow nemá mezistav K podpisu a používá správné české názvy",()=>{
  assert.deepEqual(CONTRACT_STATUS_ORDER,["draft","sent","negotiation","approved","signed"]);
  assert.deepEqual(availableContractTransitions("approved"),["negotiation","cancelled"]);
  assert.equal(contractStatusLabel("approved"),"Schválená");
  assert.equal(contractStatusLabel("signed"),"Podepsaná");
});

test("podpis RS, SBK a KS přímo ze schválené verze synchronizuje obchodní proces bez závislosti na úhradě",async()=>{
  const db=await database();await asApp(db);
  const rs=await createContract(db,"rs","workflow-rs");await approve(db,rs.contract_id);
  await db.query("SELECT * FROM app.sign_contract_externally($1,$2,$3,now(),$4,NULL)",[tenant,rs.contract_id,rs.version_id,member]);
  assert.equal((await db.query<{commercial_status:string}>("SELECT commercial_status FROM units WHERE id=$1",[unit])).rows[0].commercial_status,"reserved");
  assert.equal((await db.query<{current_stage:string}>("SELECT current_stage FROM sales_cases WHERE id=$1",[salesCase])).rows[0].current_stage,"reservation");
  assert.equal((await db.query("SELECT id FROM contract_status_events WHERE contract_id=$1 AND to_status='signing'",[rs.contract_id])).rows.length,0);

  const sbk=await createContract(db,"sbk","workflow-sbk");await approve(db,sbk.contract_id);
  assert.equal((await db.query("SELECT id FROM payment_transactions WHERE tenant_id=$1 AND project_id=(SELECT project_id FROM contracts WHERE id=$2)",[tenant,sbk.contract_id])).rows.length,0);
  await db.query("SELECT * FROM app.sign_contract_externally($1,$2,$3,now(),$4,NULL)",[tenant,sbk.contract_id,sbk.version_id,member]);
  assert.equal((await db.query<{commercial_status:string}>("SELECT commercial_status FROM units WHERE id=$1",[unit])).rows[0].commercial_status,"contracted");
  assert.equal((await db.query<{current_stage:string}>("SELECT current_stage FROM sales_cases WHERE id=$1",[salesCase])).rows[0].current_stage,"sbk");
  assert.equal((await db.query("SELECT id FROM payment_obligations WHERE contract_id=$1 AND cancelled_at IS NULL",[sbk.contract_id])).rows.length,1);

  const ks=await createContract(db,"ks","workflow-ks");await approve(db,ks.contract_id);
  await db.query("SELECT * FROM app.sign_contract_externally($1,$2,$3,now(),$4,NULL)",[tenant,ks.contract_id,ks.version_id,member]);
  assert.equal((await db.query<{commercial_status:string}>("SELECT commercial_status FROM units WHERE id=$1",[unit])).rows[0].commercial_status,"sold");
  assert.equal((await db.query<{current_stage:string}>("SELECT current_stage FROM sales_cases WHERE id=$1",[salesCase])).rows[0].current_stage,"ks");
  await db.close();
});

test("ukončení podepsané RS uvolní jednotku a zachová jediný platební předpis",async()=>{
  const db=await database();await asApp(db);
  const rs=await createContract(db,"rs","cancel-rs");await approve(db,rs.contract_id);
  await db.query("SELECT * FROM app.sign_contract_externally($1,$2,$3,now(),$4,NULL)",[tenant,rs.contract_id,rs.version_id,member]);
  await db.query("SELECT app.transition_contract_status($1,$2,'terminated','Klient odstoupil',$3)",[tenant,rs.contract_id,member]);
  assert.equal((await db.query<{commercial_status:string}>("SELECT commercial_status FROM units WHERE id=$1",[unit])).rows[0].commercial_status,"available");
  assert.equal((await db.query<{current_stage:string}>("SELECT current_stage FROM sales_cases WHERE id=$1",[salesCase])).rows[0].current_stage,"interest");
  assert.equal((await db.query("SELECT id FROM unit_holds WHERE sales_case_id=$1 AND status='active'",[salesCase])).rows.length,0);
  assert.equal((await db.query("SELECT id FROM payment_obligations WHERE contract_id=$1",[rs.contract_id])).rows.length,1);
  assert.equal((await db.query("SELECT id FROM audit_log WHERE entity_id=$1 AND action='rs.commercial_process_released'",[rs.contract_id])).rows.length,1);
  await db.close();
});

test("nová verze používá povolený zdroj a navazuje na předchozí verzi",async()=>{
  const db=await database();await asApp(db);
  const contract=await createContract(db,"rs","version-source");
  const created=(await db.query<{id:string}>("SELECT app.create_contract_version($1,$2,'Vrácená verze','imported',$3,$4,'{}'::jsonb) id",[tenant,contract.contract_id,member,contract.version_id])).rows[0];
  const version=(await db.query<{source_type:string;based_on_version_id:string;version_number:number}>("SELECT source_type,based_on_version_id,version_number FROM contract_versions WHERE id=$1",[created.id])).rows[0];
  assert.deepEqual(version,{source_type:"imported",based_on_version_id:contract.version_id,version_number:2});
  await db.close();
});

test("změna kupujícího zachová původní vazbu a aktivita klienta je auditovaná",async()=>{
  const db=await database();await asApp(db);
  const current=(await db.query<{party_id:string}>("SELECT party_id FROM sales_case_parties WHERE sales_case_id=$1 AND left_at IS NULL AND is_primary LIMIT 1",[salesCase])).rows[0].party_id;
  const replacement=(await db.query<{id:string}>("SELECT id FROM parties WHERE tenant_id=$1 AND id<>$2 AND lifecycle_status='active' ORDER BY id LIMIT 1",[tenant,current])).rows[0].id;
  await db.query("SELECT app.change_sales_case_buyer($1,$2,$3,$4,'Postoupení RS')",[tenant,salesCase,replacement,member]);
  assert.equal((await db.query("SELECT id FROM sales_case_parties WHERE sales_case_id=$1 AND party_id=$2 AND left_at IS NOT NULL",[salesCase,current])).rows.length,1);
  assert.equal((await db.query("SELECT id FROM sales_case_parties WHERE sales_case_id=$1 AND party_id=$2 AND left_at IS NULL AND is_primary",[salesCase,replacement])).rows.length,1);
  const activity=(await db.query<{id:string}>("SELECT app.add_party_activity($1,$2,'call','Potvrzeno telefonicky',$3) id",[tenant,replacement,member])).rows[0];
  const listed=await db.query<{id:string;note:string}>("SELECT id,note FROM app.list_party_activities($1,$2) WHERE party_id=$3",[tenant,member,replacement]);
  assert.equal(listed.rows[0].id,activity.id);assert.equal(listed.rows[0].note,"Potvrzeno telefonicky");
  assert.equal((await db.query("SELECT id FROM audit_log WHERE entity_id=$1 AND action='buyer_assignment.transferred'",[salesCase])).rows.length,1);
  await db.close();
});

test("postoupení podepsané RS zachová smlouvu, podpis, platbu i obchodní případ a je idempotentní",async()=>{
  const db=await database();await asApp(db);
  const rs=await createContract(db,"rs","assignment-rs");await approve(db,rs.contract_id);
  await db.query("SELECT * FROM app.sign_contract_externally($1,$2,$3,now(),$4,NULL)",[tenant,rs.contract_id,rs.version_id,member]);
  const original=(await db.query<{party_id:string}>("SELECT party_id FROM contract_parties WHERE contract_id=$1 AND participant_role IN ('buyer','co_buyer') AND effective_to IS NULL LIMIT 1",[rs.contract_id])).rows[0].party_id;
  const replacements=(await db.query<{id:string}>("SELECT id FROM parties WHERE tenant_id=$1 AND id<>$2 AND lifecycle_status='active' ORDER BY id LIMIT 2",[tenant,original])).rows.map(row=>row.id);
  const [replacement,coBuyer]=replacements;
  const buyers=JSON.stringify([{partyId:replacement,role:"buyer",isPrimary:true,share:0.5},{partyId:coBuyer,role:"co_buyer",isPrimary:false,share:0.5}]);
  const first=(await db.query<{id:string}>("SELECT app.assign_sales_case_buyers($1,$2,$3::jsonb,$4,'Postoupení podepsané RS',$5) id",[tenant,salesCase,buyers,member,"assignment-command-1"])).rows[0].id;
  const retry=(await db.query<{id:string}>("SELECT app.assign_sales_case_buyers($1,$2,$3::jsonb,$4,'Postoupení podepsané RS',$5) id",[tenant,salesCase,buyers,member,"assignment-command-1"])).rows[0].id;
  assert.equal(retry,first);
  assert.equal((await db.query("SELECT id FROM contracts WHERE id=$1 AND sales_case_id=$2 AND current_status='signed'",[rs.contract_id,salesCase])).rows.length,1);
  assert.equal((await db.query("SELECT id FROM contract_versions WHERE contract_id=$1 AND version_status='signed'",[rs.contract_id])).rows.length,1);
  assert.equal((await db.query("SELECT id FROM payment_obligations WHERE contract_id=$1 AND cancelled_at IS NULL",[rs.contract_id])).rows.length,1);
  assert.equal((await db.query("SELECT id FROM contract_parties WHERE contract_id=$1 AND party_id=$2 AND effective_to IS NOT NULL AND signature_status='signed'",[rs.contract_id,original])).rows.length,1);
  assert.equal((await db.query("SELECT id FROM contract_parties WHERE contract_id=$1 AND party_id=$2 AND effective_to IS NULL AND signature_status='not_required'",[rs.contract_id,replacement])).rows.length,1);
  assert.equal((await db.query("SELECT id FROM contract_parties WHERE contract_id=$1 AND party_id=$2 AND effective_to IS NULL AND participant_role='co_buyer'",[rs.contract_id,coBuyer])).rows.length,1);
  assert.equal((await db.query("SELECT id FROM sales_case_parties WHERE sales_case_id=$1 AND left_at IS NULL AND participant_role IN ('buyer','co_buyer')",[salesCase])).rows.length,2);
  assert.equal((await db.query("SELECT id FROM buyer_assignment_events WHERE sales_case_id=$1",[salesCase])).rows.length,1);
  assert.equal((await db.query("SELECT id FROM audit_log WHERE id=$1 AND action='buyer_assignment.transferred'",[first])).rows.length,1);
  assert.equal((await db.query("SELECT id FROM outbox_events WHERE aggregate_id=$1 AND event_type='buyer_assignment.transferred.v1'",[salesCase])).rows.length,1);
  await assert.rejects(createContract(db,"rs","duplicate-live-rs"),/unique|duplicate/i);
  const sbk=await createContract(db,"sbk","assignment-sbk");
  assert.equal((await db.query("SELECT id FROM contracts WHERE id=$1 AND sales_case_id=$2",[sbk.contract_id,salesCase])).rows.length,1);
  assert.equal((await db.query("SELECT id FROM contract_parties WHERE contract_id=$1 AND party_id=$2 AND effective_to IS NULL",[sbk.contract_id,replacement])).rows.length,1);
  const rls=(await db.query<{relrowsecurity:boolean;relforcerowsecurity:boolean}>("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='buyer_assignment_events'")).rows[0];
  assert.deepEqual(rls,{relrowsecurity:true,relforcerowsecurity:true});
  await db.close();
});

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
    "0030_contract_assignment_workflow.sql",
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
  assert.deepEqual(availableContractTransitions("signed"),["cancelled"]);
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

test("zrušení podepsané RS ukončí obchodní případ, uvolní jednotku a zruší neuhrazený předpis",async()=>{
  const db=await database();await asApp(db);
  const rs=await createContract(db,"rs","cancel-rs");await approve(db,rs.contract_id);
  await db.query("SELECT * FROM app.sign_contract_externally($1,$2,$3,now(),$4,NULL)",[tenant,rs.contract_id,rs.version_id,member]);
  await db.query("SELECT app.transition_contract_status($1,$2,'cancelled','Klient odstoupil',$3)",[tenant,rs.contract_id,member]);
  assert.equal((await db.query<{commercial_status:string}>("SELECT commercial_status FROM units WHERE id=$1",[unit])).rows[0].commercial_status,"available");
  assert.equal((await db.query<{status:string}>("SELECT status FROM sales_cases WHERE id=$1",[salesCase])).rows[0].status,"cancelled");
  assert.equal((await db.query("SELECT id FROM unit_holds WHERE sales_case_id=$1 AND status='active'",[salesCase])).rows.length,0);
  assert.equal((await db.query("SELECT id FROM payment_obligations WHERE contract_id=$1",[rs.contract_id])).rows.length,1);
  assert.equal((await db.query("SELECT id FROM payment_obligations WHERE contract_id=$1 AND cancelled_at IS NOT NULL",[rs.contract_id])).rows.length,1);
  assert.equal((await db.query("SELECT id FROM sales_case_parties WHERE sales_case_id=$1 AND left_at IS NULL",[salesCase])).rows.length,0);
  assert.equal((await db.query("SELECT id FROM audit_log WHERE entity_id=$1 AND action='rs.commercial_process_cancelled'",[rs.contract_id])).rows.length,1);
  await db.close();
});

test("zrušení RS zachová částečně uhrazený předpis a nevytváří automatickou vratku",async()=>{
  const db=await database();await asApp(db);
  const rs=await createContract(db,"rs","cancel-partially-paid-rs");await approve(db,rs.contract_id);
  await db.query("SELECT * FROM app.sign_contract_externally($1,$2,$3,now(),$4,NULL)",[tenant,rs.contract_id,rs.version_id,member]);
  const obligation=(await db.query<{id:string}>("SELECT id FROM payment_obligations WHERE contract_id=$1",[rs.contract_id])).rows[0];
  await db.query("SELECT app.record_payment($1,$2,1000,now(),NULL,NULL,$3,'Částečná úhrada',$4)",[tenant,obligation.id,"partial-payment-rs-cancel",member]);
  await db.query("SELECT app.transition_contract_status($1,$2,'cancelled','Klient odstoupil',$3)",[tenant,rs.contract_id,member]);
  assert.equal((await db.query("SELECT id FROM payment_obligations WHERE id=$1 AND cancelled_at IS NULL",[obligation.id])).rows.length,1);
  assert.equal((await db.query("SELECT id FROM payment_allocations WHERE obligation_id=$1 AND amount=1000",[obligation.id])).rows.length,1);
  assert.equal((await db.query("SELECT id FROM payment_events WHERE obligation_id=$1 AND event_type='obligation.retained_after_case_end'",[obligation.id])).rows.length,1);
  assert.equal((await db.query("SELECT reversal.id FROM payment_reversals reversal JOIN payment_allocations allocation ON allocation.tenant_id=reversal.tenant_id AND allocation.transaction_id=reversal.transaction_id WHERE allocation.obligation_id=$1",[obligation.id])).rows.length,0);
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

test("přímá změna kupujícího je zakázaná a aktivita klienta zůstává auditovaná",async()=>{
  const db=await database();await asApp(db);
  const current=(await db.query<{party_id:string}>("SELECT party_id FROM sales_case_parties WHERE sales_case_id=$1 AND left_at IS NULL AND is_primary LIMIT 1",[salesCase])).rows[0].party_id;
  const replacement=(await db.query<{id:string}>("SELECT id FROM parties WHERE tenant_id=$1 AND id<>$2 AND lifecycle_status='active' ORDER BY id LIMIT 1",[tenant,current])).rows[0].id;
  const buyers=JSON.stringify([{partyId:replacement,role:"buyer",isPrimary:true,share:null}]);
  await assert.rejects(db.query("SELECT app.assign_sales_case_buyers($1,$2,$3::jsonb,$4,'Přímá změna',$5)",[tenant,salesCase,buyers,member,"forbidden-direct-assignment"]),/signed assignment contract/i);
  assert.equal((await db.query("SELECT id FROM sales_case_parties WHERE sales_case_id=$1 AND party_id=$2 AND left_at IS NULL",[salesCase,current])).rows.length,1);
  const activity=(await db.query<{id:string}>("SELECT app.add_party_activity($1,$2,'call','Potvrzeno telefonicky',$3) id",[tenant,replacement,member])).rows[0];
  const listed=await db.query<{id:string;note:string}>("SELECT id,note FROM app.list_party_activities($1,$2) WHERE party_id=$3",[tenant,member,replacement]);
  assert.equal(listed.rows[0].id,activity.id);assert.equal(listed.rows[0].note,"Potvrzeno telefonicky");
  await db.close();
});

test("postoupení podepsané RS je nový dokument a kupující se změní až jeho podpisem",async()=>{
  const db=await database();await asApp(db);
  const rs=await createContract(db,"rs","assignment-rs");await approve(db,rs.contract_id);
  await db.query("SELECT * FROM app.sign_contract_externally($1,$2,$3,now(),$4,NULL)",[tenant,rs.contract_id,rs.version_id,member]);
  const original=(await db.query<{party_id:string}>("SELECT party_id FROM contract_parties WHERE contract_id=$1 AND participant_role IN ('buyer','co_buyer') AND effective_to IS NULL LIMIT 1",[rs.contract_id])).rows[0].party_id;
  const replacements=(await db.query<{id:string}>("SELECT id FROM parties WHERE tenant_id=$1 AND id<>$2 AND lifecycle_status='active' ORDER BY id LIMIT 2",[tenant,original])).rows.map(row=>row.id);
  const [replacement,coBuyer]=replacements;
  const buyers=JSON.stringify([{partyId:replacement,role:"buyer",isPrimary:true,share:0.5},{partyId:coBuyer,role:"co_buyer",isPrimary:false,share:0.5}]);
  const params=[tenant,unit,buyers,member,new Date().toISOString(),"Postoupení podepsané RS","assignment-command-1"];
  const first=(await db.query<{contract_id:string;version_id:string;contract_type:string;parent_contract_id:string}>("SELECT * FROM app.create_contract_assignment($1,$2,$3::jsonb,$4,$5,$6,$7)",params)).rows[0];
  const retry=(await db.query<{contract_id:string}>("SELECT * FROM app.create_contract_assignment($1,$2,$3::jsonb,$4,$5,$6,$7)",params)).rows[0];
  assert.equal(retry.contract_id,first.contract_id);assert.equal(first.contract_type,"assignment_rs");assert.equal(first.parent_contract_id,rs.contract_id);
  assert.equal((await db.query("SELECT id FROM sales_case_parties WHERE sales_case_id=$1 AND party_id=$2 AND left_at IS NULL",[salesCase,original])).rows.length,1);
  await approve(db,first.contract_id);
  const signed=await db.query("SELECT * FROM app.sign_contract_externally($1,$2,$3,now(),$4,'Podepsané postoupení')",[tenant,first.contract_id,first.version_id,member]);
  assert.equal(signed.rows.length,1);
  assert.equal((await db.query("SELECT id FROM contracts WHERE id=$1 AND sales_case_id=$2 AND current_status='signed'",[rs.contract_id,salesCase])).rows.length,1);
  assert.equal((await db.query("SELECT id FROM contract_versions WHERE contract_id=$1 AND version_status='signed'",[rs.contract_id])).rows.length,1);
  assert.equal((await db.query("SELECT id FROM payment_obligations WHERE contract_id=$1 AND cancelled_at IS NULL",[rs.contract_id])).rows.length,1);
  assert.equal((await db.query("SELECT id FROM contract_parties WHERE contract_id=$1 AND party_id=$2 AND effective_to IS NULL AND signature_status='signed'",[rs.contract_id,original])).rows.length,1);
  assert.equal((await db.query("SELECT id FROM contract_parties WHERE contract_id=$1 AND party_id=$2 AND participant_role='assignor' AND signature_status='signed'",[first.contract_id,original])).rows.length,1);
  assert.equal((await db.query("SELECT id FROM contract_parties WHERE contract_id=$1 AND party_id=$2 AND participant_role='assignee' AND signature_status='signed'",[first.contract_id,replacement])).rows.length,1);
  assert.equal((await db.query("SELECT id FROM sales_case_parties WHERE sales_case_id=$1 AND left_at IS NULL AND participant_role IN ('buyer','co_buyer')",[salesCase])).rows.length,2);
  assert.equal((await db.query("SELECT id FROM buyer_assignment_events WHERE sales_case_id=$1 AND source_contract_id=$2",[salesCase,first.contract_id])).rows.length,1);
  assert.equal((await db.query("SELECT id FROM outbox_events WHERE aggregate_id=$1 AND event_type='contract.assignment_completed.v1'",[first.contract_id])).rows.length,1);
  await db.query("SELECT * FROM app.sign_contract_externally($1,$2,$3,now(),$4,'Opakovaný podpis')",[tenant,first.contract_id,first.version_id,member]);
  assert.equal((await db.query("SELECT id FROM buyer_assignment_events WHERE source_contract_id=$1",[first.contract_id])).rows.length,1);
  await assert.rejects(createContract(db,"rs","duplicate-live-rs"),/unique|duplicate/i);
  const sbk=await createContract(db,"sbk","assignment-sbk");
  assert.equal((await db.query("SELECT id FROM contracts WHERE id=$1 AND sales_case_id=$2",[sbk.contract_id,salesCase])).rows.length,1);
  assert.equal((await db.query("SELECT id FROM contract_parties WHERE contract_id=$1 AND party_id=$2 AND effective_to IS NULL",[sbk.contract_id,replacement])).rows.length,1);
  const rls=(await db.query<{relrowsecurity:boolean;relforcerowsecurity:boolean}>("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='buyer_assignment_events'")).rows[0];
  assert.deepEqual(rls,{relrowsecurity:true,relforcerowsecurity:true});
  await db.close();
});

test("po podepsané SBK se vytváří Postoupení SBK a dalším standardním krokem zůstává KS",async()=>{
  const db=await database();await asApp(db);
  const rs=await createContract(db,"rs","assignment-sbk-rs");await approve(db,rs.contract_id);
  await db.query("SELECT * FROM app.sign_contract_externally($1,$2,$3,now(),$4,NULL)",[tenant,rs.contract_id,rs.version_id,member]);
  const sbk=await createContract(db,"sbk","assignment-sbk-core");await approve(db,sbk.contract_id);
  await db.query("SELECT * FROM app.sign_contract_externally($1,$2,$3,now(),$4,NULL)",[tenant,sbk.contract_id,sbk.version_id,member]);
  const current=(await db.query<{party_id:string}>("SELECT party_id FROM sales_case_parties WHERE sales_case_id=$1 AND left_at IS NULL AND is_primary LIMIT 1",[salesCase])).rows[0].party_id;
  const replacement=(await db.query<{id:string}>("SELECT id FROM parties WHERE tenant_id=$1 AND id<>$2 AND lifecycle_status='active' ORDER BY id LIMIT 1",[tenant,current])).rows[0].id;
  const buyers=JSON.stringify([{partyId:replacement,role:"buyer",isPrimary:true,share:null}]);
  const assignment=(await db.query<{contract_id:string;version_id:string;contract_type:string;parent_contract_id:string}>("SELECT * FROM app.create_contract_assignment($1,$2,$3::jsonb,$4,now(),NULL,$5)",[tenant,unit,buyers,member,"assignment-sbk-command"])).rows[0];
  assert.equal(assignment.contract_type,"assignment_sbk");assert.equal(assignment.parent_contract_id,sbk.contract_id);
  await approve(db,assignment.contract_id);
  await db.query("SELECT * FROM app.sign_contract_externally($1,$2,$3,now(),$4,NULL)",[tenant,assignment.contract_id,assignment.version_id,member]);
  assert.equal((await db.query("SELECT id FROM sales_case_parties WHERE sales_case_id=$1 AND party_id=$2 AND left_at IS NULL",[salesCase,replacement])).rows.length,1);
  assert.equal((await db.query("SELECT id FROM contracts WHERE sales_case_id=$1 AND contract_type='sbk'",[salesCase])).rows.length,1);
  const ks=await createContract(db,"ks","assignment-sbk-next-ks");
  assert.ok(ks.contract_id);assert.equal((await db.query("SELECT id FROM contracts WHERE sales_case_id=$1 AND contract_type='ks'",[salesCase])).rows.length,1);
  await db.close();
});

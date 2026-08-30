import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {PGlite} from "@electric-sql/pglite";

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
    "0030_contract_assignment_workflow.sql","0031_accessory_pricing_and_contract_references.sql","0032_accessory_lifecycle.sql",
  ])await db.exec(await source(`../migrations/${name}`));
  await db.exec(`INSERT INTO role_assignments(tenant_id,membership_id,role_id,assigned_by_user_id) VALUES('${tenant}','${member}','d4000000-0000-4000-8000-000000000001','${user}') ON CONFLICT DO NOTHING`);
  await db.exec(`SET ROLE develocrm_app;SELECT set_config('app.user_id','${user}',false);SELECT set_config('app.tenant_id','${tenant}',false);`);
  return db;
}

async function createAccessory(db:PGlite,category:"parking"|"cellar"|"wallbox",code:string,amount:number,relatedAccessory:string|null=null){
  const project=(await db.query<{project_id:string}>("SELECT project_id FROM units WHERE tenant_id=$1 AND id=$2",[tenant,unit])).rows[0].project_id;
  return (await db.query<{id:string}>("SELECT app.create_project_accessory($1,$2,$3,$4,NULL,$5,NULL,$6,$7) id",[tenant,project,category,code,amount,relatedAccessory,member])).rows[0].id;
}

test("příslušenství má vlastní cenu, časové přiřazení a po uvolnění je znovu dostupné",async()=>{
  const db=await database();
  const base=Number((await db.query<{amount:number}>("SELECT app.current_unit_price($1,$2)::float8 amount",[tenant,unit])).rows[0].amount);
  const accessoryBefore=Number((await db.query<{amount:number}>("SELECT app.current_unit_accessory_price($1,$2)::float8 amount",[tenant,unit])).rows[0].amount);
  const parking=await createAccessory(db,"parking","P-TEST",800000);
  const wallbox=await createAccessory(db,"wallbox","WB-TEST",80000,parking);
  const parkingAssignment=(await db.query<{id:string}>("SELECT app.assign_accessory_to_unit($1,$2,$3,now(),$4) id",[tenant,unit,parking,member])).rows[0].id;
  const assignment=(await db.query<{id:string}>("SELECT app.assign_accessory_to_unit($1,$2,$3,now(),$4) id",[tenant,unit,wallbox,member])).rows[0].id;
  const priced=(await db.query<{accessory:number;total:number}>("SELECT app.current_unit_accessory_price($1,$2)::float8 accessory,app.current_unit_sales_price($1,$2)::float8 total",[tenant,unit])).rows[0];
  assert.equal(priced.accessory,accessoryBefore+880000);assert.equal(priced.total,base+accessoryBefore+880000);
  await assert.rejects(db.query("SELECT app.assign_accessory_to_unit($1,$2,$3,now(),$4)",[tenant,unit,wallbox,member]),/already assigned/i);
  await assert.rejects(db.query("UPDATE unit_accessory_assignments SET valid_to=now() WHERE id=$1",[assignment]),/domain command/i);
  await db.query("SELECT app.remove_accessory_from_unit($1,$2,now(),$3)",[tenant,parkingAssignment,member]);
  assert.equal(Number((await db.query<{amount:number}>("SELECT app.current_unit_sales_price($1,$2)::float8 amount",[tenant,unit])).rows[0].amount),base+accessoryBefore+80000);
  await db.query("SELECT app.remove_accessory_from_unit($1,$2,now(),$3)",[tenant,assignment,member]);
  assert.equal(Number((await db.query<{amount:number}>("SELECT app.current_unit_sales_price($1,$2)::float8 amount",[tenant,unit])).rows[0].amount),base+accessoryBefore);
  assert.equal((await db.query("SELECT id FROM unit_accessory_assignments WHERE id=$1 AND valid_to IS NOT NULL",[assignment])).rows.length,1);
  assert.equal((await db.query("SELECT id FROM accessories accessory WHERE accessory.id=$1 AND NOT EXISTS(SELECT 1 FROM unit_accessory_assignments assignment WHERE assignment.accessory_id=accessory.id AND assignment.valid_to IS NULL)",[wallbox])).rows.length,1);
  assert.equal((await db.query("SELECT id FROM audit_log WHERE entity_id IN ($1,$2) AND action IN ('accessory.assigned','accessory.removed')",[assignment,parkingAssignment])).rows.length,4);
  assert.equal((await db.query("SELECT id FROM outbox_events WHERE aggregate_id=$1 AND event_type IN ('accessory.assigned.v1','accessory.removed.v1')",[unit])).rows.length,4);
  await db.close();
});

test("nepoužité příslušenství se smaže, použité archivuje a aktivní přiřazení operaci blokuje",async()=>{
  const db=await database();
  const unused=await createAccessory(db,"cellar","S-DELETE",100000);
  const deleted=(await db.query<{outcome:{mode:string}}>("SELECT app.remove_or_archive_accessory($1,$2,$3,'Test nepoužité položky') outcome",[tenant,unused,member])).rows[0].outcome;
  assert.equal(deleted.mode,"delete");
  assert.equal((await db.query("SELECT id FROM accessories WHERE id=$1",[unused])).rows.length,0);

  const used=await createAccessory(db,"parking","P-ARCHIVE",750000);
  const assignment=(await db.query<{id:string}>("SELECT app.assign_accessory_to_unit($1,$2,$3,now(),$4) id",[tenant,unit,used,member])).rows[0].id;
  await assert.rejects(db.query("SELECT app.remove_or_archive_accessory($1,$2,$3,'Stále přiřazené')",[tenant,used,member]),/currently assigned/i);
  await db.query("SELECT app.remove_accessory_from_unit($1,$2,now(),$3)",[tenant,assignment,member]);
  const archived=(await db.query<{outcome:{mode:string}}>("SELECT app.remove_or_archive_accessory($1,$2,$3,'Historická položka') outcome",[tenant,used,member])).rows[0].outcome;
  assert.equal(archived.mode,"archive");
  assert.equal((await db.query("SELECT id FROM accessories WHERE id=$1 AND archived_at IS NOT NULL AND operational_status='archived'",[used])).rows.length,1);
  assert.equal((await db.query("SELECT id FROM unit_accessory_assignments WHERE accessory_id=$1",[used])).rows.length,1);
  assert.equal((await db.query("SELECT id FROM audit_log WHERE entity_id IN ($1,$2) AND action IN ('accessory.deleted','accessory.archived')",[unused,used])).rows.length,2);
  await db.close();
});

test("smlouva a procentní předpis používají neměnný snapshot ceny včetně příslušenství",async()=>{
  const db=await database();
  const wallbox=await createAccessory(db,"wallbox","WB-SNAPSHOT",125000);
  const assignment=(await db.query<{id:string}>("SELECT app.assign_accessory_to_unit($1,$2,$3,now(),$4) id",[tenant,unit,wallbox,member])).rows[0].id;
  const total=Number((await db.query<{amount:number}>("SELECT app.current_unit_sales_price($1,$2)::float8 amount",[tenant,unit])).rows[0].amount);
  const due=new Date(Date.now()+7*86400000).toISOString();
  const created=(await db.query<{contract_id:string;payment_obligation_id:string;payment_amount:number}>("SELECT * FROM app.create_contract_with_payment($1,$2,'rs','RS SNAPSHOT','RS snapshot',$3,NULL,$4,'percentage',10,$5)",[tenant,salesCase,member,"snapshot-rs",due])).rows[0];
  assert.equal(Number(created.payment_amount),Math.round(total*10)/100);
  const snapshot=(await db.query<{unit_price_snapshot:number;accessory_price_snapshot:Array<{code:string;amount:number}>;total_price_snapshot:number}>("SELECT unit_price_snapshot::float8 unit_price_snapshot,accessory_price_snapshot,total_price_snapshot::float8 total_price_snapshot FROM contracts WHERE id=$1",[created.contract_id])).rows[0];
  assert.equal(Number(snapshot.total_price_snapshot),total);assert.equal(snapshot.accessory_price_snapshot.some(item=>item.code==="WB-SNAPSHOT"&&Number(item.amount)===125000),true);
  await db.query("INSERT INTO accessory_price_history(tenant_id,project_id,accessory_id,amount,currency,valid_from,reason,recorded_by_membership_id) SELECT tenant_id,project_id,id,175000,'CZK',now()+interval '1 second','Nová ceníková cena', $2 FROM accessories WHERE id=$1",[wallbox,member]);
  await db.query("SELECT app.remove_accessory_from_unit($1,$2,now(),$3)",[tenant,assignment,member]);
  const unchanged=(await db.query<{total_price_snapshot:number}>("SELECT total_price_snapshot::float8 total_price_snapshot FROM contracts WHERE id=$1",[created.contract_id])).rows[0];
  assert.equal(Number(unchanged.total_price_snapshot),total);
  assert.equal((await db.query("SELECT id FROM payment_obligations WHERE id=$1 AND amount=$2",[created.payment_obligation_id,Math.round(total*10)/100])).rows.length,1);
  await db.close();
});

test("historická reference dostane bezpečný suffix a aktivní smlouva stejného typu se neduplikuje",async()=>{
  const db=await database();
  const first=(await db.query<{id:string}>("SELECT app.create_contract($1,$2,'ks','KS 417','Kupní smlouva · 417',$3,NULL) id",[tenant,salesCase,member])).rows[0].id;
  await db.query("SELECT app.transition_contract_status($1,$2,'cancelled','Historická smlouva',$3)",[tenant,first,member]);
  const second=(await db.query<{id:string}>("SELECT app.create_contract($1,$2,'ks','KS 417','Kupní smlouva · 417',$3,NULL) id",[tenant,salesCase,member])).rows[0].id;
  assert.equal((await db.query<{reference:string}>("SELECT reference FROM contracts WHERE id=$1",[second])).rows[0].reference,"KS 417-02");
  await assert.rejects(db.query("SELECT app.create_contract($1,$2,'ks','KS 417','Kupní smlouva · 417',$3,NULL)",[tenant,salesCase,member]),/active contract of this type already exists/i);
  assert.equal((await db.query("SELECT id FROM contract_versions WHERE contract_id IN ($1,$2) AND version_number=1",[first,second])).rows.length,2);
  await db.close();
});

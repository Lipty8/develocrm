import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrations = ["0001_block_a_identity.sql","0002_block_b_inventory.sql","0003_block_c_sales.sql","0004_block_d_pricing_contracts.sql","0005_pilot_import_compatibility.sql","0006_crud_operations.sql"];
const seeds = ["0001_preview_block_b.sql","0002_preview_block_c.sql","0003_preview_block_d.sql","0004_pilot_rezidence_dejvice.sql"];
const tenant = "d0000000-0000-4000-8000-000000000001";

async function pilotDatabase() {
  const db = new PGlite();
  for (const name of migrations) await db.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  for (const name of seeds) await db.exec(await readFile(new URL(`../seeds/${name}`, import.meta.url), "utf8"));
  return db;
}

test("pilot import vytvoří přesně jednu Rezidenci Dejvice a přesné zdrojové počty", async () => {
  const db = await pilotDatabase();
  const project = (await db.query<{id:string}>("SELECT id FROM projects WHERE tenant_id=$1 AND code='DEJ' AND archived_at IS NULL",[tenant])).rows[0];
  assert.ok(project);
  assert.equal((await db.query("SELECT id FROM projects WHERE tenant_id=$1 AND lower(name)=lower('Rezidence Dejvice') AND archived_at IS NULL",[tenant])).rows.length,1);
  assert.equal((await db.query("SELECT id FROM units WHERE tenant_id=$1 AND project_id=$2 AND archived_at IS NULL",[tenant,project.id])).rows.length,19);
  assert.equal((await db.query("SELECT accessory.id FROM accessories accessory JOIN accessory_types type ON type.tenant_id=accessory.tenant_id AND type.id=accessory.accessory_type_id WHERE accessory.tenant_id=$1 AND accessory.project_id=$2 AND accessory.archived_at IS NULL AND type.category='cellar'",[tenant,project.id])).rows.length,19);
  assert.equal((await db.query("SELECT accessory.id FROM accessories accessory JOIN accessory_types type ON type.tenant_id=accessory.tenant_id AND type.id=accessory.accessory_type_id WHERE accessory.tenant_id=$1 AND accessory.project_id=$2 AND accessory.archived_at IS NULL AND type.category='parking'",[tenant,project.id])).rows.length,29);
  assert.equal((await db.query("SELECT price.id FROM unit_price_history price WHERE price.tenant_id=$1 AND price.project_id=$2",[tenant,project.id])).rows.length,19);
  assert.equal((await db.query("SELECT price.id FROM accessory_price_history price WHERE price.tenant_id=$1 AND price.project_id=$2",[tenant,project.id])).rows.length,48);
  await db.close();
});

test("pilot import je idempotentní a nevytváří duplicitní canonical parties ani vazby", async () => {
  const db = await pilotDatabase();
  const seed = await readFile(new URL("../seeds/0004_pilot_rezidence_dejvice.sql",import.meta.url),"utf8");
  await db.exec(seed);
  const project=(await db.query<{id:string}>("SELECT id FROM projects WHERE tenant_id=$1 AND code='DEJ'",[tenant])).rows[0];
  assert.equal((await db.query("SELECT id FROM units WHERE tenant_id=$1 AND project_id=$2 AND archived_at IS NULL",[tenant,project.id])).rows.length,19);
  assert.equal((await db.query("SELECT id FROM party_external_identifiers WHERE tenant_id=$1 AND source_system='rezidence_dejvice_excel'",[tenant])).rows.length,10);
  assert.equal((await db.query("SELECT id FROM sales_cases WHERE tenant_id=$1 AND project_id=$2",[tenant,project.id])).rows.length,8);
  assert.equal((await db.query("SELECT id FROM contracts WHERE tenant_id=$1 AND project_id=$2",[tenant,project.id])).rows.length,4);
  await db.close();
});

test("nejisté případy nevytvoří neověřený aktivní hold ani prodej jednotky", async () => {
  const db = await pilotDatabase();
  const project=(await db.query<{id:string}>("SELECT id FROM projects WHERE tenant_id=$1 AND code='DEJ'",[tenant])).rows[0];
  assert.equal((await db.query("SELECT id FROM unit_holds WHERE tenant_id=$1 AND project_id=$2 AND status='active'",[tenant,project.id])).rows.length,0);
  assert.equal((await db.query("SELECT id FROM unit_holds WHERE tenant_id=$1 AND project_id=$2 AND status<>'active'",[tenant,project.id])).rows.length,4);
  const statuses=await db.query<{code:string;commercial_status:string}>("SELECT code,commercial_status FROM units WHERE tenant_id=$1 AND project_id=$2 AND archived_at IS NULL ORDER BY code",[tenant,project.id]);
  assert.deepEqual(statuses.rows.filter(row=>row.commercial_status!=="available"),[
    {code:"206",commercial_status:"reserved"},{code:"312",commercial_status:"pre_reserved"},{code:"314",commercial_status:"reserved"},
  ]);
  assert.equal((await db.query("SELECT id FROM sales_cases WHERE tenant_id=$1 AND project_id=$2 AND status='active'",[tenant,project.id])).rows.length,4);
  await db.close();
});

test("smluvní a cenová data zachovají zdrojový stav, čisté částky i append-only ochranu", async () => {
  const db=await pilotDatabase();
  const project=(await db.query<{id:string}>("SELECT id FROM projects WHERE tenant_id=$1 AND code='DEJ'",[tenant])).rows[0];
  const contracts=await db.query<{current_status:string;count:number}>("SELECT current_status,count(*)::int count FROM contracts WHERE tenant_id=$1 AND project_id=$2 GROUP BY current_status ORDER BY current_status",[tenant,project.id]);
  assert.deepEqual(contracts.rows,[{current_status:"cancelled",count:1},{current_status:"sent",count:2},{current_status:"signed",count:1}]);
  const unit101=await db.query<{amount:number;amount_net:number}>("SELECT price.amount::float8 amount,price.amount_net::float8 amount_net FROM unit_price_history price JOIN units unit ON unit.tenant_id=price.tenant_id AND unit.id=price.unit_id WHERE unit.project_id=$1 AND unit.code='101'",[project.id]);
  assert.deepEqual(unit101.rows[0],{amount:24710000,amount_net:22062500});
  await assert.rejects(db.query("UPDATE unit_price_history SET amount=1 WHERE tenant_id=$1 AND project_id=$2",[tenant,project.id]),/append-only/i);
  await db.close();
});

test("RLS skryje pilotní projekt i klienty jinému tenantovi",async()=>{
  const db=await pilotDatabase();
  await db.exec("SET ROLE develocrm_app; SELECT set_config('app.user_id','d1000000-0000-4000-8000-000000000001',false); SELECT set_config('app.tenant_id','00000000-0000-4000-8000-000000000099',false);");
  assert.equal((await db.query("SELECT id FROM projects WHERE code='DEJ'")).rows.length,0);
  assert.equal((await db.query("SELECT id FROM party_external_identifiers WHERE source_system='rezidence_dejvice_excel'")).rows.length,0);
  await db.close();
});

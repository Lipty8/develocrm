import assert from "node:assert/strict";
import {readFile,readdir} from "node:fs/promises";
import test from "node:test";
import {PGlite} from "@electric-sql/pglite";

const tenant="d0000000-0000-4000-8000-000000000001";
const user="d1000000-0000-4000-8000-000000000001";
const member="d3000000-0000-4000-8000-000000000001";

async function fixture(){
  const db=new PGlite();
  const migrations=(await readdir(new URL("../migrations/",import.meta.url)))
    .filter(name=>name.endsWith(".sql")&&name<"0016").sort();
  for(const name of migrations)await db.exec(await readFile(new URL(`../migrations/${name}`,import.meta.url),"utf8"));
  await db.exec(await readFile(new URL("../seeds/0001_preview_block_b.sql",import.meta.url),"utf8"));
  await db.exec(await readFile(new URL("../migrations/0016_v40_pilot_runtime_and_project_creation.sql",import.meta.url),"utf8"));
  await db.exec(`SELECT set_config('app.tenant_id','${tenant}',false);SELECT set_config('app.user_id','${user}',false);`);
  return db;
}

test("v40 založí prázdný projekt atomicky a pouze s workspace oprávněním",async()=>{
  const db=await fixture();
  const admin=(await db.query<{id:string}>("SELECT id FROM roles WHERE tenant_id=$1 AND code='admin'",[tenant])).rows[0].id;
  await db.query("INSERT INTO role_assignments(tenant_id,membership_id,role_id,assigned_by_user_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",[tenant,member,admin,user]);
  const created=(await db.query<{id:string}>(
    "SELECT app.create_project($1,$2,'Rezidence Vltavská','RVL','rezidence-vltavska','Praha 7','Vltavská 1','Pilotní projekt','preparation','2028-06-30',$2,'IMMO Building','CZK',24,'Bez automatických dat') id",
    [tenant,member],
  )).rows[0].id;
  assert.equal((await db.query("SELECT id FROM projects WHERE tenant_id=$1 AND id=$2 AND code='RVL'",[tenant,created])).rows.length,1);
  assert.equal((await db.query("SELECT id FROM units WHERE tenant_id=$1 AND project_id=$2",[tenant,created])).rows.length,0);
  assert.equal((await db.query("SELECT id FROM construction_status_events WHERE tenant_id=$1 AND project_id=$2",[tenant,created])).rows.length,1);
  assert.equal((await db.query("SELECT id FROM audit_log WHERE tenant_id=$1 AND entity_id=$2 AND action='project.created'",[tenant,created])).rows.length,1);
  assert.equal((await db.query("SELECT id FROM outbox_events WHERE tenant_id=$1 AND aggregate_id=$2 AND event_type='project.created.v1'",[tenant,created])).rows.length,1);
  await assert.rejects(db.query(
    "SELECT app.create_project($1,$2,'Duplicitní projekt','RVL','jiny-slug','Praha','','','preparation',NULL,NULL,'','CZK',NULL,'')",
    [tenant,member],
  ),/unique|duplicate/i);
  await db.close();
});

test("Project Manager nezíská projects.create",async()=>{
  const db=await fixture();
  const role=(await db.query<{id:string}>("SELECT id FROM roles WHERE tenant_id=$1 AND code='project_manager'",[tenant])).rows[0].id;
  await db.query("DELETE FROM role_assignments WHERE tenant_id=$1 AND membership_id=$2",[tenant,member]);
  await db.query("INSERT INTO role_assignments(tenant_id,membership_id,role_id,assigned_by_user_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",[tenant,member,role,user]);
  await assert.rejects(db.query(
    "SELECT app.create_project($1,$2,'Zakázaný projekt','NO','zakazany-projekt','Praha','','','preparation',NULL,NULL,'','CZK',NULL,'')",
    [tenant,member],
  ),/projects\.create/);
  await db.close();
});

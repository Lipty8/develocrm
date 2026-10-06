import assert from "node:assert/strict";
import {readFile,readdir} from "node:fs/promises";
import test from "node:test";
import {PGlite} from "@electric-sql/pglite";

const tenant="a0000000-0000-4000-8000-000000000047";
const actor="a1000000-0000-4000-8000-000000000047";
const member="a3000000-0000-4000-8000-000000000047";
const projectA="aa000000-0000-4000-8000-000000000047";
const projectB="ab000000-0000-4000-8000-000000000047";
const projectC="ac000000-0000-4000-8000-000000000047";
const projectD="ad000000-0000-4000-8000-000000000047";
const managerRole="a4000000-0000-4000-8000-000000000047";
const financeRole="a4000000-0000-4000-8000-000000000048";
const adminRole="a4000000-0000-4000-8000-000000000049";

async function migrationNames(){return(await readdir(new URL("../migrations/",import.meta.url))).filter(name=>name.endsWith(".sql")).sort();}
async function apply(db:PGlite,names:string[]){for(const name of names)await db.exec(await readFile(new URL(`../migrations/${name}`,import.meta.url),"utf8"));}
async function allowed(db:PGlite,projectId:string,permission:string){return Boolean((await db.query<{allowed:boolean}>("SELECT app.has_project_permission($1,$2,$3,$4) allowed",[tenant,member,projectId,permission])).rows[0]?.allowed);}

async function currentFixture(){
  const db=new PGlite();await apply(db,await migrationNames());
  await db.query("INSERT INTO tenants(id,name,slug,status) VALUES($1,'RBAC test','rbac-test','active')",[tenant]);
  await db.query("INSERT INTO users(id,entra_issuer,entra_subject,email,display_name) VALUES($1,'test','actor','actor@example.test','Actor')",[actor]);
  await db.query("INSERT INTO tenant_memberships(id,tenant_id,user_id,status,accepted_at) VALUES($1,$2,$3,'active',now())",[member,tenant,actor]);
  for(const [id,code,name] of [[projectA,"A47","Projekt A"],[projectB,"B47","Projekt B"],[projectC,"C47","Projekt C"]])await db.query("INSERT INTO projects(id,tenant_id,code,name,slug,lifecycle_status) VALUES($1,$2,$3,$4,lower($3),'active')",[id,tenant,code,name]);
  await db.query("INSERT INTO roles(id,tenant_id,code,name,is_system) VALUES($1,$2,'project_manager','Projektový manažer',true),($3,$2,'finance','Finance',true),($4,$2,'admin','Administrátor',true)",[managerRole,tenant,financeRole,adminRole]);
  await db.query(`INSERT INTO role_permissions(tenant_id,role_id,permission_id,scope)
    SELECT $1,$2,id,'project' FROM permissions WHERE code=ANY($3::text[])`,[tenant,managerRole,["projects.read","units.read","units.update","clients.read_all","clients.update","documents.read","documents.update","contracts.read","contracts.create"]]);
  await db.query(`INSERT INTO role_permissions(tenant_id,role_id,permission_id,scope)
    SELECT $1,$2,id,'project' FROM permissions WHERE code=ANY($3::text[])`,[tenant,financeRole,["payments.read","payments.manage"]]);
  await db.query(`INSERT INTO role_permissions(tenant_id,role_id,permission_id,scope)
    SELECT $1,$2,id,'workspace' FROM permissions WHERE code='users.manage'`,[tenant,adminRole]);
  return db;
}

test("projektové role se skládají, ale nikdy nepřetékají do jiného projektu",async()=>{
  const db=await currentFixture();
  await db.query("INSERT INTO project_role_assignments(tenant_id,project_id,membership_id,role_id,assigned_by_user_id) VALUES($1,$2,$3,$4,$5),($1,$2,$3,$6,$5)",[tenant,projectA,member,managerRole,actor,financeRole]);
  assert.equal(await allowed(db,projectA,"unit.manage"),true);
  assert.equal(await allowed(db,projectA,"payments.manage"),true,"dvě role se na jednom projektu sjednotí");
  assert.equal(await allowed(db,projectB,"unit.read"),false);
  assert.equal(await allowed(db,projectB,"payments.read"),false);
  await db.close();
});

test("odlišný přístup ke třem projektům a jeho změna platí od dalšího requestu",async()=>{
  const db=await currentFixture();
  await db.query("INSERT INTO project_role_assignments(tenant_id,project_id,membership_id,role_id,assigned_by_user_id) VALUES($1,$2,$3,$4,$5)",[tenant,projectA,member,managerRole,actor]);
  await db.query(`INSERT INTO project_custom_access(tenant_id,project_id,membership_id,area,access_level,assigned_by_user_id)
    VALUES($1,$2,$3,'clients','edit',$4)`,[tenant,projectB,member,actor]);
  assert.equal(await allowed(db,projectA,"unit.manage"),true,"Dejvice používají projektovou roli");
  assert.equal(await allowed(db,projectB,"clients.update"),true,"Hrdlička používá vlastní přístup");
  assert.equal(await allowed(db,projectB,"unit.read"),false,"vlastní přístup neotevře jiné moduly");
  assert.equal(await allowed(db,projectC,"project.read"),false,"třetí projekt zůstane bez přístupu");

  await db.query("DELETE FROM project_custom_access WHERE tenant_id=$1 AND project_id=$2 AND membership_id=$3",[tenant,projectB,member]);
  await db.query("INSERT INTO project_role_assignments(tenant_id,project_id,membership_id,role_id,assigned_by_user_id) VALUES($1,$2,$3,$4,$5)",[tenant,projectB,member,financeRole,actor]);
  assert.equal(await allowed(db,projectB,"clients.update"),false,"odebraný přístup zmizí bez nové session");
  assert.equal(await allowed(db,projectB,"payments.read"),true,"nová role platí od dalšího requestu");
  assert.equal(await allowed(db,projectC,"payments.read"),false,"finance nepřetékají do jiného projektu");
  await db.close();
});

test("vlastní Read/Edit respektuje oblast a nepovoluje citlivé operace",async()=>{
  const db=await currentFixture();
  await db.query(`INSERT INTO project_custom_access(tenant_id,project_id,membership_id,area,access_level,assigned_by_user_id)
    VALUES($1,$2,$3,'documents','read',$4),($1,$2,$3,'clients','edit',$4),($1,$2,$3,'payments','edit',$4),($1,$2,$3,'contracts','edit',$4),($1,$2,$3,'units','edit',$4)`,[tenant,projectB,member,actor]);
  assert.equal(await allowed(db,projectB,"documents.read"),true);
  assert.equal(await allowed(db,projectB,"documents.update"),false);
  assert.equal(await allowed(db,projectB,"clients.update"),true);
  assert.equal(await allowed(db,projectB,"exports.run"),false);
  assert.equal(await allowed(db,projectB,"payments.record"),true);
  assert.equal(await allowed(db,projectB,"payments.manage"),false);
  assert.equal(await allowed(db,projectB,"contracts.create"),true);
  assert.equal(await allowed(db,projectB,"contracts.record_signature"),false);
  assert.equal(await allowed(db,projectB,"prices.propose"),true);
  assert.equal(await allowed(db,projectB,"prices.approve"),false);
  await assert.rejects(db.query("INSERT INTO project_role_assignments(tenant_id,project_id,membership_id,role_id,assigned_by_user_id) VALUES($1,$2,$3,$4,$5)",[tenant,projectB,member,managerRole,actor]),/roles or custom access/);
  await db.exec(`SET ROLE develocrm_app;SELECT set_config('app.tenant_id','${tenant}',false);SELECT set_config('app.user_id','${actor}',false);`);
  assert.equal((await db.query("SELECT 1 FROM project_custom_access WHERE tenant_id=$1 AND membership_id=$2",[tenant,member])).rows.length,5,"uživatel načte vlastní custom scope i přes RLS");
  await db.exec("RESET ROLE");
  await db.close();
});

test("globální Administrátor spravuje workspace, ale nemá business bypass",async()=>{
  const db=await currentFixture();
  await db.query("INSERT INTO role_assignments(tenant_id,membership_id,role_id,assigned_by_user_id) VALUES($1,$2,$3,$4)",[tenant,member,adminRole,actor]);
  await db.exec(`SELECT set_config('app.tenant_id','${tenant}',false);SELECT set_config('app.user_id','${actor}',false);`);
  assert.equal((await db.query<{allowed:boolean}>("SELECT app.current_user_has_permission('users.manage') allowed")).rows[0].allowed,true);
  assert.equal(await allowed(db,projectA,"clients.read_all"),false);
  assert.equal(await allowed(db,projectC,"project.read"),false);
  await db.close();
});

test("0047 zachová přístup na existujících projektech a nový projekt zůstane soukromý",async()=>{
  const db=new PGlite();const names=await migrationNames();const before=names.filter(name=>name<"0047_project_specific_rbac.sql");
  await apply(db,before);
  await db.query("INSERT INTO tenants(id,name,slug,status) VALUES($1,'Legacy RBAC','legacy-rbac','active')",[tenant]);
  await db.query("INSERT INTO users(id,entra_issuer,entra_subject,email,display_name) VALUES($1,'test','legacy','legacy@example.test','Legacy Admin')",[actor]);
  await db.query("INSERT INTO tenant_memberships(id,tenant_id,user_id,status,accepted_at) VALUES($1,$2,$3,'active',now())",[member,tenant,actor]);
  for(const [id,code,name] of [[projectA,"A47","Projekt A"],[projectB,"B47","Projekt B"]])await db.query("INSERT INTO projects(id,tenant_id,code,name,slug,lifecycle_status) VALUES($1,$2,$3,$4,lower($3),'active')",[id,tenant,code,name]);
  await db.query("INSERT INTO roles(id,tenant_id,code,name,is_system) VALUES($1,$2,'admin','Administrátor',true)",[adminRole,tenant]);
  await db.query(`INSERT INTO role_permissions(tenant_id,role_id,permission_id,scope)
    SELECT $1,$2,id,'workspace' FROM permissions WHERE code=ANY($3::text[])`,[tenant,adminRole,["users.manage","clients.read_all","clients.update","payments.read"]]);
  await db.query("INSERT INTO role_assignments(tenant_id,membership_id,role_id,assigned_by_user_id) VALUES($1,$2,$3,$4)",[tenant,member,adminRole,actor]);
  const baseline=await Promise.all([projectA,projectB].flatMap(projectId=>["clients.read_all","clients.update","payments.read"].map(async permission=>[projectId,permission,await allowed(db,projectId,permission)] as const)));
  await apply(db,["0047_project_specific_rbac.sql"]);
  for(const [projectId,permission,value] of baseline)assert.equal(await allowed(db,projectId,permission),value,`${projectId} ${permission} se nesmí změnit`);
  await db.query("INSERT INTO projects(id,tenant_id,code,name,slug,lifecycle_status) VALUES($1,$2,'C47','Projekt C','c47','active')",[projectC,tenant]);
  assert.equal(await allowed(db,projectC,"clients.read_all"),false,"nový projekt nepřebírá přístup globálního administrátora");
  await db.exec(`SELECT set_config('app.tenant_id','${tenant}',false);SELECT set_config('app.user_id','${actor}',false);`);
  await db.query("INSERT INTO projects(id,tenant_id,code,name,slug,lifecycle_status) VALUES($1,$2,'D47','Projekt D','d47','active')",[projectD,tenant]);
  assert.equal(await allowed(db,projectD,"clients.read_all"),true,"aktivní tvůrce získá jediný explicitní projektový grant");
  assert.equal((await db.query("SELECT 1 FROM project_role_assignments assignment JOIN roles role ON role.tenant_id=assignment.tenant_id AND role.id=assignment.role_id WHERE assignment.tenant_id=$1 AND assignment.project_id=$2 AND assignment.membership_id=$3 AND role.code='project_admin'",[tenant,projectD,member])).rows.length,1);
  assert.equal((await db.query("SELECT 1 FROM role_permissions grant_row JOIN permissions permission ON permission.id=grant_row.permission_id WHERE grant_row.tenant_id=$1 AND grant_row.role_id=$2 AND permission.code='clients.read_all'",[tenant,adminRole])).rows.length,0,"Admin po migraci nemá business permission");
  await db.close();
});

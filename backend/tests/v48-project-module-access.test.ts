import assert from "node:assert/strict";
import {readFile,readdir} from "node:fs/promises";
import test from "node:test";
import {PGlite} from "@electric-sql/pglite";

const tenant="b0000000-0000-4000-8000-000000000048";
const user="b1000000-0000-4000-8000-000000000048";
const member="b3000000-0000-4000-8000-000000000048";
const projectA="ba000000-0000-4000-8000-000000000048";
const projectB="bb000000-0000-4000-8000-000000000048";
const role="b4000000-0000-4000-8000-000000000048";

async function names(){return(await readdir(new URL("../migrations/",import.meta.url))).filter(name=>name.endsWith(".sql")).sort();}
async function apply(db:PGlite,migrations:string[]){for(const name of migrations)await db.exec(await readFile(new URL(`../migrations/${name}`,import.meta.url),"utf8"));}
async function allowed(db:PGlite,projectId:string,permission:string){return Boolean((await db.query<{allowed:boolean}>("SELECT app.has_project_permission($1,$2,$3,$4) allowed",[tenant,member,projectId,permission])).rows[0]?.allowed);}

test("0048 převede projektové role na matici beze změny efektivních oprávnění",async()=>{
  const db=new PGlite();const migrations=await names();await apply(db,migrations.filter(name=>name<"0048_project_module_access.sql"));
  await db.query("INSERT INTO tenants(id,name,slug,status) VALUES($1,'Module access','module-access','active')",[tenant]);
  await db.query("INSERT INTO users(id,entra_issuer,entra_subject,email,display_name) VALUES($1,'test','module-user','module@example.test','Module User')",[user]);
  await db.query("INSERT INTO tenant_memberships(id,tenant_id,user_id,status,accepted_at) VALUES($1,$2,$3,'active',now())",[member,tenant,user]);
  await db.query("INSERT INTO projects(id,tenant_id,code,name,slug,lifecycle_status) VALUES($1,$2,'MA','Projekt A','project-a','active'),($3,$2,'MB','Projekt B','project-b','active')",[projectA,tenant,projectB]);
  await db.query("INSERT INTO roles(id,tenant_id,code,name,is_system) VALUES($1,$2,'finance_custom','Finance custom',false)",[role,tenant]);
  await db.query(`INSERT INTO role_permissions(tenant_id,role_id,permission_id,scope)
    SELECT $1,$2,id,'project' FROM permissions WHERE code=ANY($3::text[])`,[tenant,role,["payments.read","payments.manage","payments.reverse","documents.read"]]);
  await db.query("INSERT INTO project_role_assignments(tenant_id,project_id,membership_id,role_id,assigned_by_user_id) VALUES($1,$2,$3,$4,$5)",[tenant,projectA,member,role,user]);
  const permissions=["payments.read","payments.manage","payments.reverse","documents.read","documents.update","units.read"];
  const before=await Promise.all(permissions.map(permission=>allowed(db,projectA,permission)));
  await apply(db,["0048_project_module_access.sql"]);
  assert.equal((await db.query("SELECT 1 FROM project_role_assignments WHERE tenant_id=$1",[tenant])).rows.length,0);
  assert.deepEqual(await Promise.all(permissions.map(permission=>allowed(db,projectA,permission))),before);
  assert.equal(await allowed(db,projectB,"payments.read"),false,"přístup nepřeteče do druhého projektu");
  const payment=(await db.query<{access_level:string;permission_overrides:string[]}>("SELECT access_level,permission_overrides FROM project_custom_access WHERE tenant_id=$1 AND project_id=$2 AND membership_id=$3 AND area='payments'",[tenant,projectA,member])).rows[0];
  assert.equal(payment.access_level,"read","neúplná edit sada se nesmí vydávat za plné Úpravy");
  assert.deepEqual(payment.permission_overrides.sort(),["payments.manage","payments.reverse"]);
  await db.close();
});

test("0048 zachová i historická vlastní oprávnění mimo nové hranice oblasti",async()=>{
  const db=new PGlite();const migrations=await names();await apply(db,migrations.filter(name=>name<"0048_project_module_access.sql"));
  await db.query("INSERT INTO tenants(id,name,slug,status) VALUES($1,'Custom matrix','custom-matrix','active')",[tenant]);
  await db.query("INSERT INTO users(id,entra_issuer,entra_subject,email,display_name) VALUES($1,'test','custom-user','custom@example.test','Custom User')",[user]);
  await db.query("INSERT INTO tenant_memberships(id,tenant_id,user_id,status,accepted_at) VALUES($1,$2,$3,'active',now())",[member,tenant,user]);
  await db.query("INSERT INTO projects(id,tenant_id,code,name,slug,lifecycle_status) VALUES($1,$2,'MA','Projekt A','project-a','active')",[projectA,tenant]);
  await db.query("INSERT INTO project_custom_access(tenant_id,project_id,membership_id,area,access_level,assigned_by_user_id) VALUES($1,$2,$3,'units','edit',$4)",[tenant,projectA,member,user]);
  const permissions=["units.read","units.update","media.read","media.manage","payments.read"];
  const before=await Promise.all(permissions.map(permission=>allowed(db,projectA,permission)));
  await apply(db,["0048_project_module_access.sql"]);
  assert.deepEqual(await Promise.all(permissions.map(permission=>allowed(db,projectA,permission))),before);
  const unit=(await db.query<{access_level:string;permission_overrides:string[]}>("SELECT access_level,permission_overrides FROM project_custom_access WHERE tenant_id=$1 AND project_id=$2 AND membership_id=$3 AND area='units'",[tenant,projectA,member])).rows[0];
  const project=(await db.query<{access_level:string;permission_overrides:string[]}>("SELECT access_level,permission_overrides FROM project_custom_access WHERE tenant_id=$1 AND project_id=$2 AND membership_id=$3 AND area='project'",[tenant,projectA,member])).rows[0];
  assert.equal(unit.access_level,"edit");
  assert.equal(project.access_level,"none");
  assert.deepEqual(project.permission_overrides.sort(),["accessory.manage","accessory.read","media.manage","media.read","price.manage","price.read","unit.manage","unit.read"]);
  await db.close();
});

test("matice vynucuje Čtení, Úpravy, Bez přístupu a oddělenou citlivou vratku",async()=>{
  const db=new PGlite();await apply(db,await names());
  await db.query("INSERT INTO tenants(id,name,slug,status) VALUES($1,'Matrix','matrix','active')",[tenant]);
  await db.query("INSERT INTO users(id,entra_issuer,entra_subject,email,display_name) VALUES($1,'test','matrix-user','matrix@example.test','Matrix User')",[user]);
  await db.query("INSERT INTO tenant_memberships(id,tenant_id,user_id,status,accepted_at) VALUES($1,$2,$3,'active',now())",[member,tenant,user]);
  await db.query("INSERT INTO projects(id,tenant_id,code,name,slug,lifecycle_status) VALUES($1,$2,'MA','Projekt A','project-a','active'),($3,$2,'MB','Projekt B','project-b','active')",[projectA,tenant,projectB]);
  await db.query(`INSERT INTO project_custom_access(tenant_id,project_id,membership_id,area,access_level,permission_overrides,assigned_by_user_id)
    VALUES($1,$2,$3,'documents','read',ARRAY[]::text[],$4),($1,$2,$3,'payments','edit',ARRAY[]::text[],$4)`,[tenant,projectA,member,user]);
  assert.equal(await allowed(db,projectA,"documents.read"),true);
  assert.equal(await allowed(db,projectA,"documents.update"),false);
  assert.equal(await allowed(db,projectA,"payments.record"),true);
  assert.equal(await allowed(db,projectA,"payments.reverse"),false,"Úpravy plateb samy nepovolí vratku");
  assert.equal(await allowed(db,projectA,"units.read"),false);
  assert.equal(await allowed(db,projectB,"payments.read"),false);
  await db.query("UPDATE project_custom_access SET permission_overrides=ARRAY['payments.reverse'] WHERE tenant_id=$1 AND project_id=$2 AND membership_id=$3 AND area='payments'",[tenant,projectA,member]);
  assert.equal(await allowed(db,projectA,"payments.reverse"),true);
  await db.query("DELETE FROM project_custom_access WHERE tenant_id=$1 AND project_id=$2 AND membership_id=$3",[tenant,projectA,member]);
  assert.equal(await allowed(db,projectA,"payments.read"),false,"odebrání projektu platí okamžitě");
  await db.close();
});

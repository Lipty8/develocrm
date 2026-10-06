import assert from "node:assert/strict";
import {readFile,readdir} from "node:fs/promises";
import test from "node:test";
import {PGlite} from "@electric-sql/pglite";
import type {Database} from "../src/database.js";
import {IamRepository} from "../src/iam/repository.js";

const tenant="d0000000-0000-4000-8000-000000000001";
const user="d1000000-0000-4000-8000-000000000001";
const membership="d3000000-0000-4000-8000-000000000001";
const adminRole="d4000000-0000-4000-8000-000000000001";
const project="e0000000-0000-4000-8000-000000000001";
const projectAccess=(projectId=project)=>[{projectId,areaAccess:{project:"read" as const,payments:"edit" as const},advancedPermissions:[]}];

async function fixture(){
  const db=new PGlite();
  const migrations=(await readdir(new URL("../migrations/",import.meta.url))).filter(name=>name.endsWith(".sql")).sort();
  for(const name of migrations){
    await db.exec(await readFile(new URL(`../migrations/${name}`,import.meta.url),"utf8"));
  }
  await db.exec(await readFile(new URL("../seeds/0001_preview_block_b.sql",import.meta.url),"utf8"));
  await db.exec(`INSERT INTO role_assignments(tenant_id,membership_id,role_id,assigned_by_user_id)
    VALUES('${tenant}','${membership}','${adminRole}','${user}') ON CONFLICT DO NOTHING`);
  assert.equal((await db.query(`SELECT 1 FROM role_assignments assignment JOIN role_permissions role_permission ON role_permission.tenant_id=assignment.tenant_id AND role_permission.role_id=assignment.role_id JOIN permissions permission ON permission.id=role_permission.permission_id WHERE assignment.tenant_id=$1 AND assignment.membership_id=$2 AND permission.code='users.manage'`,[tenant,membership])).rows.length,1);
  const adapter={withContext:async<T>(context:{tenantId?:string;userId?:string;identityIssuer?:string;identitySubject?:string},work:(client:{query:typeof db.query})=>Promise<T>)=>{
    await db.exec(`SET ROLE develocrm_app;BEGIN;SELECT set_config('app.user_id','${context.userId??""}',true);SELECT set_config('app.tenant_id','${context.tenantId??""}',true);SELECT set_config('app.identity_issuer','${context.identityIssuer??""}',true);SELECT set_config('app.identity_subject','${context.identitySubject??""}',true);`);
    const query=(async(text:string,values?:unknown[])=>{const result=await db.query(text,values);return{...result,rowCount:result.rows.length};}) as typeof db.query;
    try{const result=await work({query});await db.exec("COMMIT");return result;}
    catch(error){await db.exec("ROLLBACK");throw error;}
  }} as unknown as Database;
  return{db,repository:new IamRepository(adapter)};
}

test("administrátor přidá Entra uživatele a upraví jeho projektový rozsah s auditem",async()=>{
  const {db,repository}=await fixture();
  const oid="30000000-0000-4000-8000-000000000031";
  const invited=await repository.addMember({tenantId:tenant,userId:user,membershipId:membership,entraObjectId:oid,name:"Jana Nová",email:"jana@example.test",jobTitle:"Finance",workPhone:"+420 222 333 444",workspaceRoleIds:[],projectAccess:projectAccess()});
  let snapshot=await repository.adminSnapshot({tenantId:tenant,userId:user});
  const row=snapshot.users.find(item=>item.membershipId===invited.membershipId);
  assert.ok(row);
  assert.equal(row.status,"active");
  assert.equal(row.entraObjectId,oid);
  assert.deepEqual(row.workspaceRoleIds,[]);
  assert.deepEqual(row.projectAccess,projectAccess());
  const identity={issuer:`https://login.microsoftonline.com/00000000-0000-4000-8000-000000000001/v2.0`,subject:oid,entraTenantId:"00000000-0000-4000-8000-000000000001",email:"jana.renamed@example.test",displayName:"Jana Nová"};
  const resolved=await repository.resolveUser(identity);
  assert.equal(resolved.id,row.userId);
  assert.equal(resolved.email,"jana.renamed@example.test","změna e-mailu nemění Entra identitu");
  await db.exec("RESET ROLE");
  assert.equal((await db.query("SELECT id FROM users WHERE entra_subject=$1",[oid])).rows.length,1,"první login nevytvoří duplicitu");
  const session=await repository.getSession(resolved,identity,tenant);
  assert.ok(session);
  assert.deepEqual(session.workspace.projectScopes.map(scope=>scope.projectId),[project]);
  await repository.updateMember({tenantId:tenant,userId:user,membershipId:membership,targetMembershipId:invited.membershipId,name:"Jana Nováková",email:"jana@example.test",jobTitle:"Vedoucí financí",workPhone:"+420 222 333 445",status:"active",workspaceRoleIds:[],projectAccess:projectAccess()});
  snapshot=await repository.adminSnapshot({tenantId:tenant,userId:user});
  assert.equal(snapshot.users.find(item=>item.membershipId===invited.membershipId)?.name,"Jana Nováková");
  await db.exec("RESET ROLE");
  assert.ok((await db.query("SELECT id FROM audit_log WHERE entity_id=$1",[invited.membershipId])).rows.length>=2);
  assert.ok((await db.query("SELECT id FROM outbox_events WHERE aggregate_id=$1",[invited.membershipId])).rows.length>=2);
  await db.close();
});

test("nelze deaktivovat posledního administrátora ani přiřadit cizí projekt",async()=>{
  const {db,repository}=await fixture();
  await assert.rejects(repository.updateMember({tenantId:tenant,userId:user,membershipId:membership,targetMembershipId:membership,name:"Iva Novotná",email:"iva@develo.example",status:"suspended",workspaceRoleIds:[adminRole],projectAccess:[]}),/Vlastní administrátorský přístup/);
  await assert.rejects(repository.addMember({tenantId:tenant,userId:user,membershipId:membership,entraObjectId:"30000000-0000-4000-8000-000000000032",name:"Neplatný uživatel",email:"invalid@example.test",workspaceRoleIds:[],projectAccess:projectAccess("aa000000-0000-4000-8000-000000000001")}),/projekt nepatří/i);
  await db.exec("RESET ROLE");
  assert.equal((await db.query("SELECT membership.id FROM tenant_memberships membership JOIN users user_account ON user_account.id=membership.user_id WHERE user_account.email='invalid@example.test'")).rows.length,0,"celá transakce pozvánky se vrátí zpět");
  await db.close();
});

test("stejný Entra oid nelze přidat dvakrát a neznámý oid se nepersistuje",async()=>{
  const {db,repository}=await fixture();
  const oid="30000000-0000-4000-8000-000000000033";
  const input={tenantId:tenant,userId:user,membershipId:membership,entraObjectId:oid,name:"Petr Nový",email:"petr@example.test",workspaceRoleIds:[],projectAccess:projectAccess()};
  const created=await repository.addMember(input);
  await assert.rejects(repository.addMember(input),/už má přístup/i);
  await db.exec("RESET ROLE");
  assert.equal((await db.query("SELECT id FROM users WHERE entra_subject=$1",[oid])).rows.length,1);
  assert.equal((await db.query("SELECT id FROM tenant_memberships WHERE tenant_id=$1 AND user_id=(SELECT id FROM users WHERE entra_subject=$2)",[tenant,oid])).rows.length,1);
  await repository.updateMember({tenantId:tenant,userId:user,membershipId:membership,targetMembershipId:created.membershipId,name:"Petr Nový",email:"petr@example.test",status:"suspended",workspaceRoleIds:[],projectAccess:projectAccess()});
  const identity={issuer:`https://login.microsoftonline.com/00000000-0000-4000-8000-000000000001/v2.0`,subject:oid,entraTenantId:"00000000-0000-4000-8000-000000000001",email:"petr@example.test",displayName:"Petr Nový"};
  assert.equal(await repository.getSession(await repository.resolveUser(identity),identity,tenant),null,"deaktivovaný membership nemá session");
  const unknown={...identity,subject:"30000000-0000-4000-8000-000000000034",email:"unknown@example.test"};
  await assert.rejects(repository.resolveUser(unknown),/nemá přístup/i);
  await db.exec("RESET ROLE");
  assert.equal((await db.query("SELECT id FROM users WHERE entra_subject=$1",[unknown.subject])).rows.length,0,"odmítnutý login nevytvoří orphan user");
  await db.close();
});

test("existující Entra identita bez membershipu se bezpečně znovu použije",async()=>{
  const {db,repository}=await fixture();
  const identityId="d1000000-0000-4000-8000-000000000099",oid="30000000-0000-4000-8000-000000000099";
  await db.query("INSERT INTO users(id,entra_issuer,entra_subject,email,display_name) VALUES($1,'https://login.microsoftonline.com/00000000-0000-4000-8000-000000000001/v2.0',$2,'old@example.test','Starý profil')",[identityId,oid]);
  const created=await repository.addMember({tenantId:tenant,userId:user,membershipId:membership,entraObjectId:oid,name:"Nový profil",email:"new@example.test",workspaceRoleIds:[],projectAccess:projectAccess()});
  await db.exec("RESET ROLE");
  const membershipRow=(await db.query<{user_id:string}>("SELECT user_id FROM tenant_memberships WHERE id=$1",[created.membershipId])).rows[0];
  assert.equal(membershipRow.user_id,identityId);
  assert.equal((await db.query("SELECT id FROM users WHERE entra_subject=$1",[oid])).rows.length,1);
  await db.close();
});

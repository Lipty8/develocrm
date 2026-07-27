import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {PGlite} from "@electric-sql/pglite";
import type {Database} from "../src/database.js";
import {IamRepository} from "../src/iam/repository.js";

const tenant="d0000000-0000-4000-8000-000000000001";
const user="d1000000-0000-4000-8000-000000000001";
const membership="d3000000-0000-4000-8000-000000000001";
const adminRole="d4000000-0000-4000-8000-000000000001";
const projectRole="d4000000-0000-4000-8000-000000000002";
const project="e0000000-0000-4000-8000-000000000001";

async function fixture(){
  const db=new PGlite();
  for(const name of ["0001_block_a_identity.sql","0002_block_b_inventory.sql","0003_block_c_sales.sql","0004_block_d_pricing_contracts.sql","0011_v31_workflow_and_administration.sql"]){
    await db.exec(await readFile(new URL(`../migrations/${name}`,import.meta.url),"utf8"));
  }
  await db.exec(await readFile(new URL("../seeds/0001_preview_block_b.sql",import.meta.url),"utf8"));
  await db.exec(`INSERT INTO role_assignments(tenant_id,membership_id,role_id,assigned_by_user_id)
    VALUES('${tenant}','${membership}','${adminRole}','${user}') ON CONFLICT DO NOTHING`);
  assert.equal((await db.query(`SELECT 1 FROM role_assignments assignment JOIN role_permissions role_permission ON role_permission.tenant_id=assignment.tenant_id AND role_permission.role_id=assignment.role_id JOIN permissions permission ON permission.id=role_permission.permission_id WHERE assignment.tenant_id=$1 AND assignment.membership_id=$2 AND permission.code='users.manage'`,[tenant,membership])).rows.length,1);
  const adapter={withContext:async<T>(context:{tenantId?:string;userId?:string},work:(client:{query:typeof db.query})=>Promise<T>)=>{
    await db.exec(`SET ROLE develocrm_app;BEGIN;SELECT set_config('app.user_id','${context.userId??""}',true);SELECT set_config('app.tenant_id','${context.tenantId??""}',true);`);
    const query=(async(text:string,values?:unknown[])=>{const result=await db.query(text,values);return{...result,rowCount:result.rows.length};}) as typeof db.query;
    try{const result=await work({query});await db.exec("COMMIT");return result;}
    catch(error){await db.exec("ROLLBACK");throw error;}
  }} as unknown as Database;
  return{db,repository:new IamRepository(adapter)};
}

test("administrátor pozve a upraví projektově omezeného uživatele s auditem",async()=>{
  const {db,repository}=await fixture();
  const invited=await repository.inviteMember({tenantId:tenant,userId:user,membershipId:membership,name:"Jana Nová",email:"jana@example.test",jobTitle:"Finance",workPhone:"+420 222 333 444",roleIds:[projectRole],projectIds:[project]});
  let snapshot=await repository.adminSnapshot({tenantId:tenant,userId:user});
  const row=snapshot.users.find(item=>item.membershipId===invited.membershipId);
  assert.ok(row);
  assert.deepEqual(row.roleIds,[projectRole]);
  assert.deepEqual(row.projectIds,[project]);
  await repository.updateMember({tenantId:tenant,userId:user,membershipId:membership,targetMembershipId:invited.membershipId,name:"Jana Nováková",email:"jana@example.test",jobTitle:"Vedoucí financí",workPhone:"+420 222 333 445",status:"active",roleIds:[projectRole],projectIds:[project]});
  snapshot=await repository.adminSnapshot({tenantId:tenant,userId:user});
  assert.equal(snapshot.users.find(item=>item.membershipId===invited.membershipId)?.name,"Jana Nováková");
  await db.exec("RESET ROLE");
  assert.ok((await db.query("SELECT id FROM audit_log WHERE entity_id=$1",[invited.membershipId])).rows.length>=2);
  assert.ok((await db.query("SELECT id FROM outbox_events WHERE aggregate_id=$1",[invited.membershipId])).rows.length>=2);
  await db.close();
});

test("nelze deaktivovat posledního administrátora ani přiřadit cizí projekt",async()=>{
  const {db,repository}=await fixture();
  await assert.rejects(repository.updateMember({tenantId:tenant,userId:user,membershipId:membership,targetMembershipId:membership,name:"Iva Novotná",email:"iva@develo.example",status:"suspended",roleIds:[adminRole],projectIds:[]}),/Vlastní administrátorský přístup/);
  await assert.rejects(repository.inviteMember({tenantId:tenant,userId:user,membershipId:membership,name:"Neplatný uživatel",email:"invalid@example.test",roleIds:[projectRole],projectIds:["aa000000-0000-4000-8000-000000000001"]}),/projekt nepatří/i);
  await db.exec("RESET ROLE");
  assert.equal((await db.query("SELECT membership.id FROM tenant_memberships membership JOIN users user_account ON user_account.id=membership.user_id WHERE user_account.email='invalid@example.test'")).rows.length,0,"celá transakce pozvánky se vrátí zpět");
  await db.close();
});

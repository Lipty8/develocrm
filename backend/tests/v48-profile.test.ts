import assert from "node:assert/strict";
import {readdir,readFile} from "node:fs/promises";
import test from "node:test";
import {PGlite} from "@electric-sql/pglite";
import type {Database} from "../src/database.js";
import {IamRepository} from "../src/iam/repository.js";
import {bootstrapIds,bootstrapPilotWorkspace,normalizeBootstrapInput} from "../src/iam/pilot-bootstrap.js";

test("profil synchronizuje Entra e-mail a uloží všechna uživatelská nastavení pod runtime rolí",async()=>{
  const db=new PGlite();const directory=new URL("../migrations/",import.meta.url);
  for(const name of (await readdir(directory)).filter(name=>/^\d+.*\.sql$/.test(name)).sort())await db.exec(await readFile(new URL(name,directory),"utf8"));
  const normalized=normalizeBootstrapInput({entraTenantId:"10000000-0000-4000-8000-000000000048",adminOid:"20000000-0000-4000-8000-000000000048",adminEmail:"stary@develo.example",adminName:"Adam Test",workspaceName:"Profile Test",workspaceId:"30000000-0000-4000-8000-000000000048"});
  const ids=bootstrapIds(normalized);const bootstrapClient={query:async(sql:string,parameters?:unknown[])=>{const result=await db.query(sql,parameters as never[]|undefined);return{rows:result.rows,rowCount:result.affectedRows??null};}} as never;
  await bootstrapPilotWorkspace(bootstrapClient,{...normalized,...ids});
  const adapter={withContext:async<T>(context:{tenantId?:string;userId?:string},work:(sqlClient:{query:typeof db.query})=>Promise<T>)=>{await db.exec(`SET ROLE develocrm_app;SELECT set_config('app.tenant_id','${context.tenantId??""}',false);SELECT set_config('app.user_id','${context.userId??""}',false);`);return work({query:async(text:string,values?:unknown[])=>{const result=await db.query(text,values as never[]|undefined);return{rows:result.rows,rowCount:result.affectedRows??null};}});}} as unknown as Database;
  const repository=new IamRepository(adapter);const user=await repository.updateOwnProfile({tenantId:ids.tenantId,userId:ids.userId,membershipId:ids.membershipId,identityEmail:"adam.liptak@immobuilding.cz",displayName:"Adam Lipták",jobTitle:"Administrátor",phone:"+420 774 243 324",initials:"AL",language:"cs",timezone:"Europe/Prague",notifications:{email:false,inApp:true}});
  assert.equal(user.email,"adam.liptak@immobuilding.cz");assert.equal(user.displayName,"Adam Lipták");assert.equal(user.phone,"+420 774 243 324");assert.deepEqual(user.notifications,{email:false,inApp:true});
  await db.exec("RESET ROLE");const stored=(await db.query<{email:string;profile_initials:string;profile_timezone:string}>("SELECT email,profile_initials,profile_timezone FROM users WHERE id=$1",[ids.userId])).rows[0];assert.equal(stored.email,"adam.liptak@immobuilding.cz");assert.equal(stored.profile_initials,"AL");assert.equal(stored.profile_timezone,"Europe/Prague");assert.equal((await db.query("SELECT id FROM audit_log WHERE entity_id=$1 AND action='profile.updated'",[ids.userId])).rows.length,1);assert.equal((await db.query("SELECT id FROM outbox_events WHERE aggregate_id=$1 AND event_type='profile.updated.v1'",[ids.userId])).rows.length,1);await db.close();
});

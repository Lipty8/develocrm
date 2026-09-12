import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { Database } from "../src/database.js";
import type { EntraTokenVerifier } from "../src/auth/entra.js";
import { buildApp } from "../src/app.js";
import { MediaAccessError, MediaRepository } from "../src/media/repository.js";
import { mapApiError } from "../src/http/api-error.js";
import { bootstrapIds, bootstrapPilotWorkspace, normalizeBootstrapInput } from "../src/iam/pilot-bootstrap.js";
import { importDejvice } from "../src/imports/dejvice.js";

async function pilot(){
  const db=new PGlite(),directory=new URL("../migrations/",import.meta.url);
  for(const name of (await readdir(directory)).filter(name=>/^\d+.*\.sql$/.test(name)).sort())await db.exec(await readFile(new URL(name,directory),"utf8"));
  const normalized=normalizeBootstrapInput({entraTenantId:"10000000-0000-4000-8000-000000000097",adminOid:"20000000-0000-4000-8000-000000000097",adminEmail:"security.admin@example.test",adminName:"Security Admin",workspaceName:"Security workspace",workspaceId:"30000000-0000-4000-8000-000000000097"}),ids=bootstrapIds(normalized);
  const client={query:async(sql:string,parameters?:unknown[])=>{if(!parameters&&sql.includes(";")){await db.exec(sql);return{rows:[],rowCount:null};}const result=await db.query(sql,parameters as never[]|undefined);return{rows:result.rows,rowCount:result.affectedRows??null};}} as never;
  await bootstrapPilotWorkspace(client,{...normalized,...ids});await importDejvice(client,await readFile(new URL("../seeds/0004_pilot_rezidence_dejvice.sql",import.meta.url),"utf8"),{tenantId:ids.tenantId,membershipId:ids.membershipId,dryRun:false});
  const adapter={withContext:async<T>(context:{tenantId?:string;userId?:string},work:(client:{query:(sql:string,parameters?:unknown[])=>Promise<{rows:never[];rowCount:number|null}>})=>Promise<T>)=>{await db.exec(`SELECT set_config('app.tenant_id','${context.tenantId??""}',false);SELECT set_config('app.user_id','${context.userId??""}',false);`);return work({query:async(sql,parameters)=>{const result=await db.query(sql,parameters as never[]|undefined);return{rows:result.rows as never[],rowCount:result.affectedRows??null};}});}} as unknown as Database;
  return{db,ids,media:new MediaRepository(adapter)};
}

test("media access vyžaduje tenant, project scope a media.read; znalost klíče nestačí",async()=>{
  const{db,ids,media}=await pilot();const project=(await db.query<{id:string}>("SELECT id FROM projects WHERE tenant_id=$1 AND code='DEJ'",[ids.tenantId])).rows[0];
  const privateKey=`${ids.tenantId}/${project.id}/project/${project.id}/cover/private-key`;
  const asset=await media.register({tenantId:ids.tenantId,userId:ids.userId,membershipId:ids.membershipId,entityType:"project",entityId:project.id,kind:"cover",url:`/api/media/file/${encodeURIComponent(privateKey)}`,storageKey:privateKey,fileName:"cover.png",mimeType:"image/png"});
  assert.equal((await media.getByStorageKey({tenantId:ids.tenantId,userId:ids.userId,membershipId:ids.membershipId,storageKey:privateKey})).id,asset.id);
  await assert.rejects(media.register({tenantId:ids.tenantId,userId:ids.userId,membershipId:ids.membershipId,entityType:"project",entityId:project.id,kind:"cover",url:"/api/media/file/foreign-key",storageKey:"foreign-tenant/foreign-project/cover/key",fileName:"cover.png",mimeType:"image/png"}),error=>error instanceof MediaAccessError&&error.reason==="invalid");
  await assert.rejects(media.getByStorageKey({tenantId:ids.tenantId,userId:ids.userId,membershipId:ids.membershipId,storageKey:"random-key"}),error=>error instanceof MediaAccessError&&error.reason==="not_found");
  const restrictedUser="40000000-0000-4000-8000-000000000097",restrictedMembership="50000000-0000-4000-8000-000000000097";
  await db.query("INSERT INTO users(id,entra_issuer,entra_subject,email,display_name) VALUES($1,'issuer','restricted-media','restricted@example.test','Restricted')",[restrictedUser]);await db.query("INSERT INTO tenant_memberships(id,tenant_id,user_id,status,accepted_at) VALUES($1,$2,$3,'active',now())",[restrictedMembership,ids.tenantId,restrictedUser]);
  await assert.rejects(media.getByStorageKey({tenantId:ids.tenantId,userId:restrictedUser,membershipId:restrictedMembership,storageKey:privateKey}),error=>error instanceof MediaAccessError&&error.reason==="forbidden");
  await assert.rejects(media.authorizeUpload({tenantId:ids.tenantId,userId:restrictedUser,membershipId:restrictedMembership,entityType:"project",entityId:project.id,kind:"cover"}),error=>error instanceof MediaAccessError&&error.reason==="forbidden");
  const otherProject="60000000-0000-4000-8000-000000000097";
  await db.query("INSERT INTO projects(id,tenant_id,code,name,slug) VALUES($1,$2,'SEC','Security project','security-project')",[otherProject,ids.tenantId]);
  const salesRole=(await db.query<{id:string}>("SELECT id FROM roles WHERE tenant_id=$1 AND code='sales'",[ids.tenantId])).rows[0];
  await db.query("INSERT INTO project_role_assignments(tenant_id,project_id,membership_id,role_id,assigned_by_user_id) VALUES($1,$2,$3,$4,$5)",[ids.tenantId,project.id,restrictedMembership,salesRole.id,ids.userId]);
  const otherKey=`${ids.tenantId}/${otherProject}/project/${otherProject}/cover/other-project-key`;
  await media.register({tenantId:ids.tenantId,userId:ids.userId,membershipId:ids.membershipId,entityType:"project",entityId:otherProject,kind:"cover",url:`/api/media/file/${encodeURIComponent(otherKey)}`,storageKey:otherKey,fileName:"other.png",mimeType:"image/png"});
  assert.equal((await media.getByStorageKey({tenantId:ids.tenantId,userId:restrictedUser,membershipId:restrictedMembership,storageKey:privateKey})).projectId,project.id);
  await assert.rejects(media.getByStorageKey({tenantId:ids.tenantId,userId:restrictedUser,membershipId:restrictedMembership,storageKey:otherKey}),error=>error instanceof MediaAccessError&&error.reason==="forbidden");
  await assert.rejects(media.getByStorageKey({tenantId:"30000000-0000-4000-8000-000000000098",userId:restrictedUser,membershipId:restrictedMembership,storageKey:privateKey}),error=>error instanceof MediaAccessError&&error.reason==="not_found");
  await db.close();
});

test("media metadata má vynucené RLS a jednu aktivní verzi na objekt",async()=>{
  const{db,ids}=await pilot();const flags=(await db.query<{relrowsecurity:boolean;relforcerowsecurity:boolean}>("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='media_assets'")).rows[0];assert.equal(flags.relrowsecurity,true);assert.equal(flags.relforcerowsecurity,true);
  const project=(await db.query<{id:string}>("SELECT id FROM projects WHERE tenant_id=$1 LIMIT 1",[ids.tenantId])).rows[0];await db.exec(`SELECT set_config('app.tenant_id','${ids.tenantId}',false)`);await db.query("INSERT INTO media_assets(tenant_id,project_id,entity_type,entity_id,kind,storage_key,file_name,mime_type,uploaded_by_user_id) VALUES($1,$2,'project',$2,'cover','one','one.png','image/png',$3)",[ids.tenantId,project.id,ids.userId]);await assert.rejects(db.query("INSERT INTO media_assets(tenant_id,project_id,entity_type,entity_id,kind,storage_key,file_name,mime_type,uploaded_by_user_id) VALUES($1,$2,'project',$2,'cover','two','two.png','image/png',$3)",[ids.tenantId,project.id,ids.userId]),/media_assets_one_active_entity_kind_uq|unique/i);await db.close();
});

test("centrální error mapper nikdy neposílá raw SQL ani interní constraint",()=>{
  const mapped=mapApiError({error:'new row violates check constraint "secret_constraint" after INSERT INTO parties'},409,"cid-1");assert.equal(mapped.code,"CONFLICT");assert.equal(mapped.correlationId,"cid-1");assert.doesNotMatch(mapped.message,/constraint|INSERT|secret/i);assert.equal(mapped.error,mapped.message);
});

test("všechny doménové API oblasti odmítnou požadavek bez Entra tokenu",async()=>{
  const database={ping:async()=>{},withContext:async()=>{throw new Error("database must not be reached without authentication");}} as unknown as Database;
  const verifier={verify:async()=>{throw new Error("Chybí Bearer token");}} as unknown as EntraTokenVerifier;
  const app=buildApp({database,verifier});
  const requests=[
    {method:"GET",url:"/v1/projects"},
    {method:"GET",url:"/v1/projects/10000000-0000-4000-8000-000000000001/units"},
    {method:"GET",url:"/v1/parties"},
    {method:"GET",url:"/v1/contracts"},
    {method:"GET",url:"/v1/payments"},
    {method:"GET",url:"/v1/documents"},
    {method:"GET",url:"/v1/tasks"},
    {method:"GET",url:"/v1/handovers"},
    {method:"GET",url:"/v1/client-changes"},
    {method:"GET",url:"/v1/media/access?key=private-key"},
    {method:"POST",url:"/v1/projects",payload:{}},
    {method:"PATCH",url:"/v1/units/10000000-0000-4000-8000-000000000001",payload:{}},
    {method:"POST",url:"/v1/parties",payload:{}},
    {method:"POST",url:"/v1/contracts",payload:{}},
    {method:"POST",url:"/v1/payment-obligations",payload:{}},
    {method:"POST",url:"/v1/handovers",payload:{}},
    {method:"POST",url:"/v1/tasks",payload:{}},
    {method:"POST",url:"/v1/documents",payload:{}},
    {method:"PATCH",url:"/v1/accessories/10000000-0000-4000-8000-000000000001",payload:{}},
    {method:"POST",url:"/v1/media/uploads/authorize",payload:{}},
  ];
  for(const request of requests){
    const response=await app.inject(request);
    assert.equal(response.statusCode,401,`${request.method} ${request.url}`);
    const payload=response.json() as {code:string;correlationId:string;message:string};
    assert.equal(payload.code,"UNAUTHENTICATED");
    assert.ok(payload.correlationId);
    assert.doesNotMatch(payload.message,/Bearer|token|SQL|constraint/i);
  }
  await app.close();
});

test("produkční media cesta neobsahuje demo identitu a chráněný stream ověřuje backend",async()=>{const [upload,file,client]=await Promise.all([readFile(new URL("../../app/api/media/route.ts",import.meta.url),"utf8"),readFile(new URL("../../app/api/media/file/[...key]/route.ts",import.meta.url),"utf8"),readFile(new URL("../../app/repositories/media-repository.ts",import.meta.url),"utf8")]);for(const source of[upload,file]){assert.doesNotMatch(source,/develocrm-demo|iva@develo\.example|iva-novotna/);}assert.match(file,/\/v1\/media\/access/);assert.match(upload,/\/v1\/media\/uploads\/authorize/);assert.match(client,/URL\.createObjectURL/);});

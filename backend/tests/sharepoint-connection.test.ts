import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { Database } from "../src/database.js";
import { SharePointConnectionService, SharePointConnectionValidationError } from "../src/documents/connection-service.js";
import { EntraMicrosoftGraphAdapter, MicrosoftGraphRequestError, type MicrosoftGraphAdapter } from "../src/documents/graph-adapter.js";
import { DocumentRepository, type DocumentContext } from "../src/documents/repository.js";
import { bootstrapIds, bootstrapPilotWorkspace, normalizeBootstrapInput } from "../src/iam/pilot-bootstrap.js";

const context:DocumentContext={tenantId:"30000000-0000-4000-8000-000000000111",userId:"20000000-0000-4000-8000-000000000111",membershipId:"40000000-0000-4000-8000-000000000111"};
const configured={id:"50000000-0000-4000-8000-000000000111",name:"Pilot",entraTenantId:"10000000-0000-4000-8000-000000000111",siteId:"site-1",driveId:"drive-1",authenticationMode:"managed_identity",credentialReference:"managed-identity://134a9cd1-c2d7-4386-b47c-c59260ad460c"};

function graph(overrides:Partial<MicrosoftGraphAdapter>={}):MicrosoftGraphAdapter{
  return {
    getSite:async()=>({id:"site-1",displayName:"DeveloCRM",webUrl:null}),
    listSiteDrives:async()=>[{id:"drive-1",name:"Dejvice TEST",webUrl:null,driveType:"documentLibrary"}],
    listFiles:async()=>[],uploadFile:async()=>{throw new Error("write disabled in validation");},getFileMetadata:async()=>null,downloadFile:async()=>{throw new Error("download disabled in validation");},
    createFolder:async()=>{throw new Error("write disabled in validation");},moveOrRenameFile:async()=>{throw new Error("write disabled in validation");},
    getVersions:async()=>[],delta:async()=>({items:[],deletedItemIds:[],nextCursor:null}),...overrides,
  };
}

test("validator verifies site, drive ownership and root listing without write operations",async()=>{
  const updates:Array<{status:string;errorCode?:string}>=[];
  const repository={configureConnection:async()=>({id:configured.id}),getConnectionForValidation:async()=>configured,recordConnectionValidation:async(input:{status:string;errorCode?:string})=>{updates.push(input);return{id:configured.id};}};
  const service=new SharePointConnectionService(repository as never,graph(),"134a9cd1-c2d7-4386-b47c-c59260ad460c");
  assert.deepEqual(await service.validate(context),{connectionId:configured.id,site:{id:"site-1",displayName:"DeveloCRM"},library:{id:"drive-1",name:"Dejvice TEST"},rootItemCount:0});
  assert.deepEqual(updates,[{...context,connectionId:configured.id,status:"connected"}]);
});

test("validator fails closed for a foreign drive and records only a safe error code",async()=>{
  const updates:Array<{status:string;errorCode?:string}>=[];
  const repository={configureConnection:async()=>({id:configured.id}),getConnectionForValidation:async()=>configured,recordConnectionValidation:async(input:{status:string;errorCode?:string})=>{updates.push(input);return{id:configured.id};}};
  const service=new SharePointConnectionService(repository as never,graph({listSiteDrives:async()=>[{id:"other",name:"Other",webUrl:null,driveType:null}]}),"134a9cd1-c2d7-4386-b47c-c59260ad460c");
  await assert.rejects(service.validate(context),error=>error instanceof SharePointConnectionValidationError&&error.code==="drive_not_in_site");
  assert.equal(updates[0]?.errorCode,"drive_not_in_site");
});

test("Graph authorization failures retain diagnostics in memory but persist a safe code",async()=>{
  const updates:Array<{status:string;errorCode?:string}>=[];
  const repository={configureConnection:async()=>({id:configured.id}),getConnectionForValidation:async()=>configured,recordConnectionValidation:async(input:{status:string;errorCode?:string})=>{updates.push(input);return{id:configured.id};}};
  const service=new SharePointConnectionService(repository as never,graph({getSite:async()=>{throw new MicrosoftGraphRequestError(403,"graph-request-id");}}),"134a9cd1-c2d7-4386-b47c-c59260ad460c");
  await assert.rejects(service.validate(context),error=>error instanceof SharePointConnectionValidationError&&error.code==="graph_forbidden"&&error.graphRequestId==="graph-request-id");
  assert.equal(updates[0]?.errorCode,"graph_forbidden");
});

test("production Graph adapter uses only the configured site and drive for read validation",async()=>{
  const requests:string[]=[];
  const originalFetch=globalThis.fetch;
  globalThis.fetch=(async(input:URL|RequestInfo)=>{
    const url=String(input);requests.push(url);
    if(url.includes("/sites/"))return new Response(JSON.stringify(url.includes("/drives?")?{value:[{id:"drive-1",name:"Dejvice TEST",driveType:"documentLibrary"}]}:{id:"site-1",displayName:"DeveloCRM"}),{status:200,headers:{"content-type":"application/json"}});
    return new Response(JSON.stringify({value:[]}),{status:200,headers:{"content-type":"application/json"}});
  }) as typeof fetch;
  try{
    const adapter=new EntraMicrosoftGraphAdapter({getAccessToken:async()=>"token"});
    await adapter.getSite("tenant,site,web");
    await adapter.listSiteDrives("tenant,site,web");
    await adapter.listFiles({siteId:"tenant,site,web",driveId:"drive-1"});
    assert.match(requests[0]??"",/\/sites\/tenant%2Csite%2Cweb\?\$select=/);
    assert.match(requests[1]??"",/\/sites\/tenant%2Csite%2Cweb\/drives\?\$select=/);
    assert.match(requests[2]??"",/\/drives\/drive-1\/root\/children$/);
    assert.ok(requests.every(url=>!url.includes("content")&&!url.includes("createUploadSession")));
  }finally{globalThis.fetch=originalFetch;}
});

test("historical driveItem version download uses the isolated Graph beta content endpoint",async()=>{
  const requests:string[]=[];const originalFetch=globalThis.fetch;
  globalThis.fetch=(async(input:URL|RequestInfo)=>{requests.push(String(input));return new Response(new Uint8Array([1,2,3]),{status:200});}) as typeof fetch;
  try{
    const adapter=new EntraMicrosoftGraphAdapter({getAccessToken:async()=>"token"});
    assert.deepEqual(await adapter.downloadFile({siteId:"site",driveId:"drive"},"item","1.0"),new Uint8Array([1,2,3]));
    assert.equal(requests[0],"https://graph.microsoft.com/beta/drives/drive/items/item/versions/1.0/content");
  }finally{globalThis.fetch=originalFetch;}
});

test("current driveItem version falls back from Graph 400 to current content",async()=>{
  const requests:string[]=[];const originalFetch=globalThis.fetch;
  globalThis.fetch=(async(input:URL|RequestInfo)=>{const url=String(input);requests.push(url);return url.includes("/beta/")
    ?new Response(JSON.stringify({error:{code:"badRequest"}}),{status:400,headers:{"content-type":"application/json"}})
    :new Response(new Uint8Array([4,5,6]),{status:200});}) as typeof fetch;
  try{
    const adapter=new EntraMicrosoftGraphAdapter({getAccessToken:async()=>"token"});
    assert.deepEqual(await adapter.downloadFile({siteId:"site",driveId:"drive"},"item","1.0"),new Uint8Array([4,5,6]));
    assert.deepEqual(requests,[
      "https://graph.microsoft.com/beta/drives/drive/items/item/versions/1.0/content",
      "https://graph.microsoft.com/v1.0/drives/drive/items/item/content",
    ]);
  }finally{globalThis.fetch=originalFetch;}
});

test("connection configuration is tenant scoped and requires integrations.manage",async()=>{
  const db=new PGlite(),directory=new URL("../migrations/",import.meta.url);
  for(const name of (await readdir(directory)).filter(name=>/^\d+.*\.sql$/.test(name)).sort())await db.exec(await readFile(new URL(name,directory),"utf8"));
  const normalized=normalizeBootstrapInput({entraTenantId:"10000000-0000-4000-8000-000000000112",adminOid:"20000000-0000-4000-8000-000000000112",adminEmail:"sharepoint.admin@example.test",adminName:"SharePoint Admin",workspaceName:"SharePoint workspace",workspaceId:"30000000-0000-4000-8000-000000000112"}),ids=bootstrapIds(normalized);
  const bootstrapClient={query:async(sql:string,parameters?:unknown[])=>{if(!parameters&&sql.includes(";")){await db.exec(sql);return{rows:[],rowCount:null};}const result=await db.query(sql,parameters as never[]|undefined);return{rows:result.rows,rowCount:result.affectedRows??null};}} as never;
  await bootstrapPilotWorkspace(bootstrapClient,{...normalized,...ids});
  const adapter={withContext:async<T>(requestContext:{tenantId?:string;userId?:string},work:(client:{query:(sql:string,parameters?:unknown[])=>Promise<{rows:never[];rowCount:number|null}>})=>Promise<T>)=>{await db.exec(`SELECT set_config('app.tenant_id','${requestContext.tenantId??""}',false);SELECT set_config('app.user_id','${requestContext.userId??""}',false);`);return work({query:async(sql,parameters)=>{const result=await db.query(sql,parameters as never[]|undefined);return{rows:result.rows as never[],rowCount:result.affectedRows??null};}});}} as unknown as Database;
  const repository=new DocumentRepository(adapter);
  const created=await repository.configureConnection({tenantId:ids.tenantId,userId:ids.userId,membershipId:ids.membershipId,name:"Pilot",entraTenantId:normalized.entraTenantId,siteId:"site-1",driveId:"drive-1",credentialReference:"managed-identity://134a9cd1-c2d7-4386-b47c-c59260ad460c"});
  assert.ok(created.id);
  assert.equal((await repository.getConnectionForValidation({tenantId:ids.tenantId,userId:ids.userId,membershipId:ids.membershipId}))?.driveId,"drive-1");
  const restrictedUser="60000000-0000-4000-8000-000000000112",restrictedMembership="70000000-0000-4000-8000-000000000112";
  await db.query("INSERT INTO users(id,entra_issuer,entra_subject,email,display_name) VALUES($1,'issuer','restricted-sp','restricted@example.test','Restricted')",[restrictedUser]);
  await db.query("INSERT INTO tenant_memberships(id,tenant_id,user_id,status,accepted_at) VALUES($1,$2,$3,'active',now())",[restrictedMembership,ids.tenantId,restrictedUser]);
  await assert.rejects(repository.configureConnection({tenantId:ids.tenantId,userId:restrictedUser,membershipId:restrictedMembership,name:"Denied",entraTenantId:normalized.entraTenantId,siteId:"site-2",driveId:"drive-2",credentialReference:"managed-identity://134a9cd1-c2d7-4386-b47c-c59260ad460c"}),/integrations\.manage/);
  assert.equal(await repository.getConnectionForValidation({tenantId:ids.tenantId,userId:restrictedUser,membershipId:restrictedMembership}),null);
  await assert.rejects(repository.configureConnection({tenantId:"80000000-0000-4000-8000-000000000112",userId:ids.userId,membershipId:ids.membershipId,name:"Foreign",entraTenantId:normalized.entraTenantId,siteId:"site-3",driveId:"drive-3",credentialReference:"managed-identity://134a9cd1-c2d7-4386-b47c-c59260ad460c"}));
  await db.close();
});

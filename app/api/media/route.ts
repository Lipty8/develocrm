import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { entityMedia, tenants, users } from "../../../db/schema";
import { getChatGPTUser } from "../../chatgpt-auth";
import { apiUnavailable, serverDataMode } from "../../lib/data-mode";
import { backendAuthorization, forwardBackendMutation } from "../../lib/backend-proxy";
import { validateMediaFile, type MediaKind } from "../../lib/media-validation";

const UUID_PATTERN=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type EntityType="project"|"unit";
function correlationId(request:Request){return request.headers.get("x-correlation-id")?.trim()||crypto.randomUUID();}
function log(level:"info"|"warn"|"error",value:Record<string,unknown>){console[level](JSON.stringify(value));}
function previewTenantId(){return process.env.DEVELOCRM_PREVIEW_TENANT_ID?.trim()||null;}
function objectKeyFromUrl(value:unknown){if(typeof value!=="string")return null;const marker="/api/media/file/";const index=value.indexOf(marker);if(index<0)return null;try{return decodeURIComponent(value.slice(index+marker.length).split(/[?#]/)[0]);}catch{return null;}}
async function enrich(media:Record<string,unknown>){const key=objectKeyFromUrl(media.url)??(typeof media.storageKey==="string"?media.storageKey:null);if(!key)return media;const object=await env.FILES.head(key).catch(()=>null);return object?{...media,fileName:object.customMetadata?.fileName||media.fileName,mimeType:object.httpMetadata?.contentType||media.mimeType,uploadedAt:object.customMetadata?.uploadedAt||media.uploadedAt,version:object.customMetadata?.version||media.version}:media;}

export async function GET(request:Request){
  const url=new URL(request.url),entityType=url.searchParams.get("entityType"),entityId=url.searchParams.get("entityId");
  if(!entityType||!entityId||!["project","unit"].includes(entityType))return Response.json({error:"Chybí identifikace objektu"},{status:400});
  const backendUrl=process.env.DEVELOCRM_API_URL?.replace(/\/$/,""),tenantId=process.env.DEVELOCRM_TENANT_ID?.trim(),authorization=backendAuthorization(request.headers.get("authorization"));
  if(backendUrl&&tenantId){
    if(!authorization)return Response.json({error:"Přihlášení je vyžadováno"},{status:401});
    const response=await fetch(`${backendUrl}/v1/${entityType==="project"?"projects":"units"}/${encodeURIComponent(entityId)}/media`,{headers:{authorization,"x-tenant-id":tenantId,"x-correlation-id":correlationId(request)},cache:"no-store"});
    if(!response.ok)return new Response(await response.arrayBuffer(),{status:response.status,headers:{"content-type":response.headers.get("content-type")||"application/json","x-correlation-id":response.headers.get("x-correlation-id")||correlationId(request)}});
    const payload=await response.json() as {media?:Record<string,unknown>[]};return Response.json({media:await Promise.all((payload.media??[]).map(enrich))},{headers:{"cache-control":"no-store"}});
  }
  if(serverDataMode()!=="browser")return apiUnavailable("Média nejsou dostupná bez společného backendu");
  const user=await getChatGPTUser(),tenant=previewTenantId();if(!user)return Response.json({error:"Přihlášení je vyžadováno"},{status:401});if(!tenant)return apiUnavailable("Preview úložiště médií není nakonfigurováno");
  const rows=await getDb().select().from(entityMedia).where(and(eq(entityMedia.tenantId,tenant),eq(entityMedia.entityType,entityType),eq(entityMedia.entityId,entityId)));
  return Response.json({media:await Promise.all(rows.map(row=>enrich({...row,url:`/api/media/file/${encodeURIComponent(row.objectKey)}`})))},{headers:{"cache-control":"no-store"}});
}

export async function POST(request:Request){
  const cid=correlationId(request),backendUrl=process.env.DEVELOCRM_API_URL?.trim(),configuredTenant=process.env.DEVELOCRM_TENANT_ID?.trim(),authorization=backendAuthorization(request.headers.get("authorization")),usesBackend=serverDataMode()==="api"||Boolean(backendUrl)||Boolean(configuredTenant);
  if(usesBackend&&!authorization)return Response.json({error:"Přihlášení je vyžadováno",correlationId:cid},{status:401,headers:{"x-correlation-id":cid,"cache-control":"no-store"}});
  const form=await request.formData(),file=form.get("file"),entityType=String(form.get("entityType")||"") as EntityType,entityId=String(form.get("entityId")||""),kind=String(form.get("kind")||"") as MediaKind;
  if(!(file instanceof File)||!entityId||!["project","unit"].includes(entityType)||!["cover","floorplan"].includes(kind))return Response.json({error:"Neúplný soubor nebo vazba",correlationId:cid},{status:400});
  try{validateMediaFile(file,kind);}catch(error){const message=error instanceof Error?error.message:"Nepodporovaný formát souboru.";return Response.json({error:message,correlationId:cid},{status:message.includes("velký")?413:415});}
  if(usesBackend){
    if(!backendUrl||!configuredTenant)return apiUnavailable("Uložení média vyžaduje připojený backend",cid);
    if(!UUID_PATTERN.test(entityId))return Response.json({error:"Médium musí být navázáno na platný databázový objekt",correlationId:cid},{status:400});
    const proxyRequest=()=>new Request(request.url,{method:"POST",headers:{authorization,"x-correlation-id":cid}});
    const authorized=await forwardBackendMutation(proxyRequest(),{method:"POST",target:"/v1/media/uploads/authorize",body:JSON.stringify({entityType,entityId,kind}),contentType:"application/json",unavailableMessage:"Oprávnění k nahrání nelze ověřit"});
    if(!authorized.ok)return authorized;
    const owner=await authorized.json() as {tenantId:string;projectId:string;unitId:string|null;userId:string};if(owner.tenantId!==configuredTenant)return Response.json({error:"Médium nelze nahrát",correlationId:cid},{status:403});
    const safeName=file.name.replace(/[^a-zA-Z0-9._-]+/g,"-"),uploadedAt=new Date().toISOString(),version=uploadedAt,objectKey=`${owner.tenantId}/${owner.projectId}/${entityType}/${entityId}/${kind}/${crypto.randomUUID()}-${safeName}`;
    try{await env.FILES.put(objectKey,file.stream(),{httpMetadata:{contentType:file.type},customMetadata:{tenantId:owner.tenantId,projectId:owner.projectId,entityType,entityId,kind,uploadedByUserId:owner.userId,uploadedAt,fileName:file.name,version}});}catch(error){log("error",{event:"media.storage.failed",correlationId:cid,entityType,entityId,kind,errorName:error instanceof Error?error.name:"Error"});return Response.json({error:kind==="floorplan"?"Půdorys se nepodařilo uložit. Zkuste to prosím znovu.":"Obrázek se nepodařilo uložit. Zkuste to prosím znovu.",correlationId:cid},{status:502,headers:{"x-correlation-id":cid}});}
    const mediaUrl=`/api/media/file/${encodeURIComponent(objectKey)}`;const stored=await forwardBackendMutation(proxyRequest(),{method:"POST",target:`/v1/${entityType==="project"?"projects":"units"}/${encodeURIComponent(entityId)}/${kind==="cover"?"cover":"floorplan"}`,body:JSON.stringify({url:mediaUrl,mimeType:file.type,storageKey:objectKey,fileName:file.name}),contentType:"application/json",unavailableMessage:"Metadata média nelze uložit"});
    if(!stored.ok){let rolledBack=false;try{await env.FILES.delete(objectKey);rolledBack=true;}catch(error){log("error",{event:"media.storage.rollback_failed",correlationId:cid,entityType,entityId,kind,errorName:error instanceof Error?error.name:"Error"});}log("warn",{event:"media.metadata.rejected",correlationId:cid,status:stored.status,entityType,entityId,kind,storageRolledBack:rolledBack});return stored;}
    const payload=await stored.json() as {media:Record<string,unknown>};log("info",{event:"media.upload.complete",correlationId:cid,status:201,entityType,entityId,kind});return Response.json({media:{...payload.media,url:mediaUrl,version}},{status:201,headers:{"x-correlation-id":cid,"cache-control":"no-store"}});
  }
  if(serverDataMode()!=="browser")return apiUnavailable("Uložení média vyžaduje připojený backend",cid);
  const user=await getChatGPTUser(),tenant=previewTenantId();if(!user)return Response.json({error:"Přihlášení je vyžadováno"},{status:401});if(!tenant)return apiUnavailable("Preview úložiště médií není nakonfigurováno",cid);
  const db=getDb(),userId=`chatgpt-${user.email.toLowerCase().replace(/[^a-z0-9]+/g,"-").slice(0,70)}`,safeName=file.name.replace(/[^a-zA-Z0-9._-]+/g,"-"),objectKey=`${tenant}/${entityType}/${entityId}/${kind}/${crypto.randomUUID()}-${safeName}`,uploadedAt=new Date().toISOString(),version=uploadedAt;
  await db.insert(tenants).values({id:tenant,name:"Preview workspace",slug:"preview-workspace"}).onConflictDoNothing();await db.insert(users).values({id:userId,tenantId:tenant,email:user.email,displayName:user.displayName,role:"admin"}).onConflictDoNothing();await env.FILES.put(objectKey,file.stream(),{httpMetadata:{contentType:file.type},customMetadata:{tenantId:tenant,entityType,entityId,kind,uploadedByUserId:userId,uploadedAt,fileName:file.name,version}});const id=crypto.randomUUID();await db.insert(entityMedia).values({id,tenantId:tenant,entityType,entityId,kind,objectKey,fileName:file.name,mimeType:file.type,uploadedByUserId:userId}).onConflictDoUpdate({target:[entityMedia.tenantId,entityMedia.entityType,entityMedia.entityId,entityMedia.kind],set:{objectKey,fileName:file.name,mimeType:file.type,uploadedByUserId:userId,updatedAt:uploadedAt}});return Response.json({media:{id,entityType,entityId,kind,fileName:file.name,mimeType:file.type,url:`/api/media/file/${encodeURIComponent(objectKey)}`,uploadedAt,uploadedBy:user.displayName,version}},{status:201});
}

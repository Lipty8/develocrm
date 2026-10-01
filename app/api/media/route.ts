import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { entityMedia, tenants, users } from "../../../db/schema";
import { getChatGPTUser } from "../../chatgpt-auth";
import { apiUnavailable, serverDataMode } from "../../lib/data-mode";
import { backendAuthorization, forwardBackendMutation } from "../../lib/backend-proxy";
import { MEDIA_UPLOAD_CHUNK_SIZE, mediaChunkBounds, validateMediaUploadDescriptor, type MediaUploadDescriptor } from "../../lib/media-upload-protocol";
import { validateMediaFile, type MediaKind } from "../../lib/media-validation";

const UUID_PATTERN=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type EntityType="project"|"unit";
type UploadOwner={mode:"api"|"browser";tenantId:string;projectId:string;unitId:string|null;userId:string;displayName?:string;email?:string};
type UploadSession=MediaUploadDescriptor&UploadOwner&{uploadId:string;objectKey:string;uploadedAt:string;version:string;chunkCount:number;chunkSize:number;expiresAt:string};
const UPLOAD_SESSION_PREFIX="_media_uploads";
const UPLOAD_SESSION_TTL_MS=30*60*1000;
function correlationId(request:Request){return request.headers.get("x-correlation-id")?.trim()||crypto.randomUUID();}
function log(level:"info"|"warn"|"error",value:Record<string,unknown>){console[level](JSON.stringify(value));}
function previewTenantId(){return process.env.DEVELOCRM_PREVIEW_TENANT_ID?.trim()||null;}
function usesBackend(){return serverDataMode()==="api"||Boolean(process.env.DEVELOCRM_API_URL?.trim())||Boolean(process.env.DEVELOCRM_TENANT_ID?.trim());}
function sessionKey(uploadId:string){return `${UPLOAD_SESSION_PREFIX}/${uploadId}/manifest.json`;}
function chunkKey(uploadId:string,index:number){return `${UPLOAD_SESSION_PREFIX}/${uploadId}/chunks/${index}`;}
function safeFileName(value:string){return value.replace(/[^a-zA-Z0-9._-]+/g,"-");}
function errorResponse(error:string,correlationId:string,status:number){return Response.json({error,correlationId},{status,headers:{"x-correlation-id":correlationId,"cache-control":"no-store"}});}
async function readSession(uploadId:string){
  if(!UUID_PATTERN.test(uploadId))return null;
  const object=await env.FILES.get(sessionKey(uploadId));
  if(!object)return null;
  try{return JSON.parse(await object.text()) as UploadSession;}catch{return null;}
}
async function clearSession(session:UploadSession){
  await env.FILES.delete([sessionKey(session.uploadId),...Array.from({length:session.chunkCount},(_,index)=>chunkKey(session.uploadId,index))]);
}
async function clearSessionSafely(session:UploadSession,cid:string){try{await clearSession(session);}catch(error){log("warn",{event:"media.upload.cleanup_failed",correlationId:cid,uploadId:session.uploadId,errorName:error instanceof Error?error.name:"Error"});}}
async function uploadOwner(request:Request,descriptor:Pick<MediaUploadDescriptor,"entityType"|"entityId"|"kind">,cid:string):Promise<UploadOwner|Response>{
  if(usesBackend()){
    const backendUrl=process.env.DEVELOCRM_API_URL?.trim(),configuredTenant=process.env.DEVELOCRM_TENANT_ID?.trim(),authorization=backendAuthorization(request.headers.get("authorization"));
    if(!authorization)return errorResponse("Přihlášení je vyžadováno",cid,401);
    if(!backendUrl||!configuredTenant)return apiUnavailable("Uložení média vyžaduje připojený backend",cid);
    if(!UUID_PATTERN.test(descriptor.entityId))return errorResponse("Médium musí být navázáno na platný databázový objekt",cid,400);
    const proxyRequest=new Request(request.url,{method:"POST",headers:{authorization,"x-correlation-id":cid}});
    const authorized=await forwardBackendMutation(proxyRequest,{method:"POST",target:"/v1/media/uploads/authorize",body:JSON.stringify(descriptor),contentType:"application/json",unavailableMessage:"Oprávnění k nahrání nelze ověřit"});
    if(!authorized.ok)return authorized;
    const owner=await authorized.json() as {tenantId:string;projectId:string;unitId:string|null;userId:string};
    if(owner.tenantId!==configuredTenant)return errorResponse("Médium nelze nahrát",cid,403);
    return {mode:"api",...owner};
  }
  if(serverDataMode()!=="browser")return apiUnavailable("Uložení média vyžaduje připojený backend",cid);
  const user=await getChatGPTUser(),tenantId=previewTenantId();
  if(!user)return errorResponse("Přihlášení je vyžadováno",cid,401);
  if(!tenantId)return apiUnavailable("Preview úložiště médií není nakonfigurováno",cid);
  return {mode:"browser",tenantId,projectId:descriptor.entityId,unitId:descriptor.entityType==="unit"?descriptor.entityId:null,userId:`chatgpt-${user.email.toLowerCase().replace(/[^a-z0-9]+/g,"-").slice(0,70)}`,displayName:user.displayName,email:user.email};
}
async function authorizeSession(request:Request,session:UploadSession,cid:string){
  const owner=await uploadOwner(request,session,cid);
  if(owner instanceof Response)return owner;
  if(owner.mode!==session.mode||owner.tenantId!==session.tenantId||owner.projectId!==session.projectId||owner.userId!==session.userId)return errorResponse("Relace pro nahrání není dostupná",cid,403);
  return owner;
}
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
  const cid=correlationId(request),backendUrl=process.env.DEVELOCRM_API_URL?.trim(),configuredTenant=process.env.DEVELOCRM_TENANT_ID?.trim(),authorization=backendAuthorization(request.headers.get("authorization")),backendMode=usesBackend();
  if(backendMode&&!authorization)return Response.json({error:"Přihlášení je vyžadováno",correlationId:cid},{status:401,headers:{"x-correlation-id":cid,"cache-control":"no-store"}});
  if(request.headers.get("content-type")?.includes("application/json")){
    let input:({action?:string}&Partial<MediaUploadDescriptor>);
    try{input=await request.json() as typeof input;}catch{return errorResponse("Neplatný požadavek pro nahrání",cid,400);}
    const descriptor={entityType:String(input.entityType||"") as EntityType,entityId:String(input.entityId||""),kind:String(input.kind||"") as MediaKind,fileName:String(input.fileName||""),mimeType:String(input.mimeType||""),size:Number(input.size)};
    if(input.action!=="start"||!["project","unit"].includes(descriptor.entityType)||!["cover","floorplan"].includes(descriptor.kind)||!descriptor.entityId||!descriptor.fileName)return errorResponse("Neúplný soubor nebo vazba",cid,400);
    let chunks:{chunkCount:number;chunkSize:number};
    try{chunks=validateMediaUploadDescriptor(descriptor);}catch(error){const message=error instanceof Error?error.message:"Nepodporovaný formát souboru.";return errorResponse(message,cid,message.includes("velký")?413:415);}
    const owner=await uploadOwner(request,descriptor,cid);if(owner instanceof Response)return owner;
    const uploadId=crypto.randomUUID(),uploadedAt=new Date().toISOString(),version=uploadedAt;
    const objectKey=owner.mode==="api"
      ?`${owner.tenantId}/${owner.projectId}/${descriptor.entityType}/${descriptor.entityId}/${descriptor.kind}/${crypto.randomUUID()}-${safeFileName(descriptor.fileName)}`
      :`${owner.tenantId}/${descriptor.entityType}/${descriptor.entityId}/${descriptor.kind}/${crypto.randomUUID()}-${safeFileName(descriptor.fileName)}`;
    const session:UploadSession={...descriptor,...owner,uploadId,objectKey,uploadedAt,version,...chunks,expiresAt:new Date(Date.now()+UPLOAD_SESSION_TTL_MS).toISOString()};
    await env.FILES.put(sessionKey(uploadId),JSON.stringify(session),{httpMetadata:{contentType:"application/json"}});
    log("info",{event:"media.upload.started",correlationId:cid,uploadId,entityType:descriptor.entityType,entityId:descriptor.entityId,kind:descriptor.kind,size:descriptor.size,chunkCount:chunks.chunkCount});
    return Response.json({uploadId,...chunks},{status:201,headers:{"x-correlation-id":cid,"cache-control":"no-store"}});
  }
  const form=await request.formData(),file=form.get("file"),entityType=String(form.get("entityType")||"") as EntityType,entityId=String(form.get("entityId")||""),kind=String(form.get("kind")||"") as MediaKind;
  if(!(file instanceof File)||!entityId||!["project","unit"].includes(entityType)||!["cover","floorplan"].includes(kind))return Response.json({error:"Neúplný soubor nebo vazba",correlationId:cid},{status:400});
  try{validateMediaFile(file,kind);}catch(error){const message=error instanceof Error?error.message:"Nepodporovaný formát souboru.";return Response.json({error:message,correlationId:cid},{status:message.includes("velký")?413:415});}
  if(backendMode){
    if(!backendUrl||!configuredTenant)return apiUnavailable("Uložení média vyžaduje připojený backend",cid);
    if(!UUID_PATTERN.test(entityId))return Response.json({error:"Médium musí být navázáno na platný databázový objekt",correlationId:cid},{status:400});
    const proxyRequest=()=>new Request(request.url,{method:"POST",headers:{authorization:authorization||"","x-correlation-id":cid}});
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

export async function PUT(request:Request){
  const cid=correlationId(request),url=new URL(request.url),uploadId=url.searchParams.get("uploadId")||"",index=Number(url.searchParams.get("index"));
  const session=await readSession(uploadId);if(!session)return errorResponse("Relace pro nahrání nebyla nalezena",cid,404);
  if(Date.parse(session.expiresAt)<Date.now()){await clearSession(session).catch(()=>undefined);return errorResponse("Platnost nahrávání vypršela. Vyberte soubor znovu.",cid,410);}
  const owner=await authorizeSession(request,session,cid);if(owner instanceof Response)return owner;
  let bounds:{start:number;end:number};try{bounds=mediaChunkBounds(index,session.size,session.chunkSize);}catch{return errorResponse("Neplatná část souboru",cid,400);}
  const bytes=await request.arrayBuffer(),expectedSize=bounds.end-bounds.start;
  if(bytes.byteLength!==expectedSize||bytes.byteLength>MEDIA_UPLOAD_CHUNK_SIZE)return errorResponse("Část souboru má neplatnou velikost",cid,400);
  await env.FILES.put(chunkKey(uploadId,index),bytes,{httpMetadata:{contentType:"application/octet-stream"}});
  log("info",{event:"media.upload.chunk",correlationId:cid,uploadId,index,size:bytes.byteLength});
  return new Response(null,{status:204,headers:{"x-correlation-id":cid,"cache-control":"no-store"}});
}

export async function PATCH(request:Request){
  const cid=correlationId(request);let uploadId="";try{uploadId=String((await request.json() as {uploadId?:string}).uploadId||"");}catch{return errorResponse("Neplatné dokončení nahrávání",cid,400);}
  const session=await readSession(uploadId);if(!session)return errorResponse("Relace pro nahrání nebyla nalezena",cid,404);
  if(Date.parse(session.expiresAt)<Date.now()){await clearSession(session).catch(()=>undefined);return errorResponse("Platnost nahrávání vypršela. Vyberte soubor znovu.",cid,410);}
  const owner=await authorizeSession(request,session,cid);if(owner instanceof Response)return owner;
  const keys=Array.from({length:session.chunkCount},(_,index)=>chunkKey(uploadId,index));
  const parts:ArrayBuffer[]=[];
  for(const key of keys){const object=await env.FILES.get(key);if(!object)return errorResponse("Nahrání souboru není kompletní",cid,409);parts.push(await object.arrayBuffer());}
  const total=parts.reduce((sum:number,part:ArrayBuffer)=>sum+part.byteLength,0);
  if(total!==session.size)return errorResponse("Nahraný soubor má neplatnou velikost",cid,409);
  const assembled=new Uint8Array(total);let offset=0;
  for(const part of parts){assembled.set(new Uint8Array(part),offset);offset+=part.byteLength;}
  try{
    await env.FILES.put(session.objectKey,assembled,{httpMetadata:{contentType:session.mimeType},customMetadata:{tenantId:session.tenantId,projectId:session.projectId,entityType:session.entityType,entityId:session.entityId,kind:session.kind,uploadedByUserId:session.userId,uploadedAt:session.uploadedAt,fileName:session.fileName,version:session.version}});
  }catch(error){log("error",{event:"media.storage.failed",correlationId:cid,uploadId,entityType:session.entityType,entityId:session.entityId,kind:session.kind,errorName:error instanceof Error?error.name:"Error"});return errorResponse(session.kind==="floorplan"?"Půdorys se nepodařilo uložit. Zkuste to prosím znovu.":"Obrázek se nepodařilo uložit. Zkuste to prosím znovu.",cid,502);}
  const mediaUrl=`/api/media/file/${encodeURIComponent(session.objectKey)}`;
  if(session.mode==="api"){
    const authorization=backendAuthorization(request.headers.get("authorization"));
    const proxyRequest=new Request(request.url,{method:"POST",headers:{authorization:authorization||"","x-correlation-id":cid}});
    const stored=await forwardBackendMutation(proxyRequest,{method:"POST",target:`/v1/${session.entityType==="project"?"projects":"units"}/${encodeURIComponent(session.entityId)}/${session.kind==="cover"?"cover":"floorplan"}`,body:JSON.stringify({url:mediaUrl,mimeType:session.mimeType,storageKey:session.objectKey,fileName:session.fileName}),contentType:"application/json",unavailableMessage:"Metadata média nelze uložit"});
    if(!stored.ok){let rolledBack=false;try{await env.FILES.delete(session.objectKey);rolledBack=true;}catch(error){log("error",{event:"media.storage.rollback_failed",correlationId:cid,uploadId,errorName:error instanceof Error?error.name:"Error"});}await clearSession(session).catch(()=>undefined);log("warn",{event:"media.metadata.rejected",correlationId:cid,uploadId,status:stored.status,entityType:session.entityType,entityId:session.entityId,kind:session.kind,storageRolledBack:rolledBack});return stored;}
    const payload=await stored.json() as {media:Record<string,unknown>};await clearSessionSafely(session,cid);log("info",{event:"media.upload.complete",correlationId:cid,uploadId,status:201,entityType:session.entityType,entityId:session.entityId,kind:session.kind,size:session.size});return Response.json({media:{...payload.media,url:mediaUrl,version:session.version}},{status:201,headers:{"x-correlation-id":cid,"cache-control":"no-store"}});
  }
  const db=getDb();await db.insert(tenants).values({id:session.tenantId,name:"Preview workspace",slug:"preview-workspace"}).onConflictDoNothing();await db.insert(users).values({id:session.userId,tenantId:session.tenantId,email:session.email||"preview@local",displayName:session.displayName||"Preview user",role:"admin"}).onConflictDoNothing();const id=crypto.randomUUID();await db.insert(entityMedia).values({id,tenantId:session.tenantId,entityType:session.entityType,entityId:session.entityId,kind:session.kind,objectKey:session.objectKey,fileName:session.fileName,mimeType:session.mimeType,uploadedByUserId:session.userId}).onConflictDoUpdate({target:[entityMedia.tenantId,entityMedia.entityType,entityMedia.entityId,entityMedia.kind],set:{objectKey:session.objectKey,fileName:session.fileName,mimeType:session.mimeType,uploadedByUserId:session.userId,updatedAt:session.uploadedAt}});await clearSessionSafely(session,cid);return Response.json({media:{id,entityType:session.entityType,entityId:session.entityId,kind:session.kind,fileName:session.fileName,mimeType:session.mimeType,url:mediaUrl,uploadedAt:session.uploadedAt,uploadedBy:session.displayName,version:session.version}},{status:201,headers:{"x-correlation-id":cid,"cache-control":"no-store"}});
}

export async function DELETE(request:Request){
  const cid=correlationId(request),uploadId=new URL(request.url).searchParams.get("uploadId")||"",session=await readSession(uploadId);
  if(!session)return new Response(null,{status:204,headers:{"x-correlation-id":cid,"cache-control":"no-store"}});
  const owner=await authorizeSession(request,session,cid);if(owner instanceof Response)return owner;
  await clearSession(session);log("info",{event:"media.upload.cancelled",correlationId:cid,uploadId});return new Response(null,{status:204,headers:{"x-correlation-id":cid,"cache-control":"no-store"}});
}

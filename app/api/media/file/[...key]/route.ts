import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { entityMedia } from "../../../../../db/schema";
import { getChatGPTUser } from "../../../../chatgpt-auth";
import { backendAuthorization } from "../../../../lib/backend-proxy";
import { serverDataMode } from "../../../../lib/data-mode";

function dispositionFileName(value:string){return encodeURIComponent(value).replace(/[!'()*]/g,character=>`%${character.charCodeAt(0).toString(16).toUpperCase()}`);}
function correlationId(request:Request){return request.headers.get("x-correlation-id")?.trim()||crypto.randomUUID();}

export async function GET(request:Request,context:{params:Promise<{key:string[]}>}){
  const {key}=await context.params,storageKey=key.join("/"),cid=correlationId(request);
  const backendUrl=process.env.DEVELOCRM_API_URL?.trim().replace(/\/$/,""),tenantId=process.env.DEVELOCRM_TENANT_ID?.trim();
  if(backendUrl&&tenantId){
    const authorization=backendAuthorization(request.headers.get("authorization"));
    if(!authorization)return Response.json({error:"Přihlášení je vyžadováno",correlationId:cid},{status:401});
    const access=await fetch(`${backendUrl}/v1/media/access?key=${encodeURIComponent(storageKey)}`,{headers:{authorization,"x-tenant-id":tenantId,"x-correlation-id":cid},cache:"no-store"});
    if(!access.ok)return new Response(await access.arrayBuffer(),{status:access.status,headers:{"content-type":access.headers.get("content-type")||"application/json","x-correlation-id":access.headers.get("x-correlation-id")||cid,"cache-control":"no-store"}});
  }else{
    if(serverDataMode()!=="browser")return Response.json({error:"Médium není dostupné",correlationId:cid},{status:503});
    const user=await getChatGPTUser(),previewTenant=process.env.DEVELOCRM_PREVIEW_TENANT_ID?.trim();
    if(!user)return Response.json({error:"Přihlášení je vyžadováno",correlationId:cid},{status:401});
    if(!previewTenant)return Response.json({error:"Preview úložiště není nakonfigurováno",correlationId:cid},{status:503});
    const row=(await getDb().select({id:entityMedia.id}).from(entityMedia).where(and(eq(entityMedia.tenantId,previewTenant),eq(entityMedia.objectKey,storageKey))).limit(1))[0];
    if(!row)return Response.json({error:"Soubor nebyl nalezen",correlationId:cid},{status:404});
  }
  const object=await env.FILES.get(storageKey);
  if(!object)return Response.json({error:"Soubor nebyl nalezen",correlationId:cid},{status:404});
  const headers=new Headers();object.writeHttpMetadata(headers);headers.set("etag",object.httpEtag);headers.set("cache-control","private, no-store");headers.set("x-content-type-options","nosniff");headers.set("content-security-policy","default-src 'none'; sandbox");headers.set("x-correlation-id",cid);
  const fileName=object.customMetadata?.fileName||key.at(-1)||"soubor",download=new URL(request.url).searchParams.get("download")==="1";headers.set("content-disposition",`${download?"attachment":"inline"}; filename*=UTF-8''${dispositionFileName(fileName)}`);
  return new Response(object.body,{headers});
}

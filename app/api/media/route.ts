import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { entityMedia, tenants, users } from "../../../db/schema";
import { getChatGPTUser } from "../../chatgpt-auth";
import { apiUnavailable, serverDataMode } from "../../lib/data-mode";

const TENANT_ID = "develocrm-demo";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const entityType = url.searchParams.get("entityType");
  const entityId = url.searchParams.get("entityId");
  if (!entityType || !entityId) return Response.json({ error: "Chybí identifikace objektu" }, { status: 400 });
  const backendUrl=process.env.DEVELOCRM_API_URL?.replace(/\/$/,"");const tenantId=process.env.DEVELOCRM_TENANT_ID;const authorization=request.headers.get("authorization");
  if(backendUrl&&tenantId&&authorization){const response=await fetch(`${backendUrl}/v1/${entityType==="project"?"projects":"units"}/${entityId}/media`,{headers:{authorization,"x-tenant-id":tenantId},cache:"no-store"});return new Response(await response.text(),{status:response.status,headers:{"content-type":"application/json"}});}
  if(serverDataMode()!=="browser")return apiUnavailable("Média nejsou dostupná bez společného backendu");
  const rows = await getDb().select().from(entityMedia).where(and(
    eq(entityMedia.tenantId, TENANT_ID), eq(entityMedia.entityType, entityType), eq(entityMedia.entityId, entityId),
  ));
  return Response.json({ media: rows.map((row) => ({ ...row, url: `/api/media/file/${encodeURIComponent(row.objectKey)}` })) });
}

export async function POST(request: Request) {
  if(serverDataMode()!=="browser"&&(!process.env.DEVELOCRM_API_URL||!process.env.DEVELOCRM_TENANT_ID||!request.headers.get("authorization")))return apiUnavailable("Uložení média vyžaduje připojený backend");
  const user = await getChatGPTUser();
  const form = await request.formData();
  const file = form.get("file");
  const entityType = String(form.get("entityType") || "");
  const entityId = String(form.get("entityId") || "");
  const kind = String(form.get("kind") || "");
  if (!(file instanceof File) || !entityType || !entityId || !kind) return Response.json({ error: "Neúplný soubor nebo vazba" }, { status: 400 });
  if (!file.type.startsWith("image/")) return Response.json({ error: "Podporovány jsou obrazové soubory" }, { status: 415 });
  if (file.size > 12 * 1024 * 1024) return Response.json({ error: "Soubor může mít nejvýše 12 MB" }, { status: 413 });

  const db = getDb();
  const userId = user ? `chatgpt-${user.email.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 70)}` : "iva-novotna";
  await db.insert(tenants).values({ id: TENANT_ID, name: "Develo Group", slug: "develo-group" }).onConflictDoNothing();
  await db.insert(users).values({ id: userId, tenantId: TENANT_ID, email: user?.email || "iva@develo.example", displayName: user?.displayName || "Iva Novotná", role: "admin" }).onConflictDoNothing();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-");
  const objectKey = `${TENANT_ID}/${entityType}/${entityId}/${kind}/${crypto.randomUUID()}-${safeName}`;
  await env.FILES.put(objectKey, file.stream(), { httpMetadata: { contentType: file.type }, customMetadata: { entityType, entityId, kind, uploadedBy: userId } });
  const publicUrl=`/api/media/file/${encodeURIComponent(objectKey)}`;const backendUrl=process.env.DEVELOCRM_API_URL?.replace(/\/$/,"");const tenantId=process.env.DEVELOCRM_TENANT_ID;const authorization=request.headers.get("authorization");
  if(backendUrl&&tenantId&&authorization){const response=await fetch(`${backendUrl}/v1/${entityType==="project"?"projects":"units"}/${entityId}/${kind==="cover"?"cover":"floorplan"}`,{method:"POST",headers:{authorization,"x-tenant-id":tenantId,"content-type":"application/json"},body:JSON.stringify({url:publicUrl,mimeType:file.type,source:"crm",externalId:objectKey})});if(!response.ok)return Response.json({error:"Metadata obrázku se nepodařilo uložit"},{status:response.status});return Response.json({media:{id:objectKey,entityType,entityId,kind,fileName:file.name,mimeType:file.type,url:publicUrl}},{status:201});}
  const id = crypto.randomUUID();
  await db.insert(entityMedia).values({ id, tenantId: TENANT_ID, entityType, entityId, kind, objectKey, fileName: file.name, mimeType: file.type, uploadedByUserId: userId }).onConflictDoUpdate({
    target: [entityMedia.tenantId, entityMedia.entityType, entityMedia.entityId, entityMedia.kind],
    set: { objectKey, fileName: file.name, mimeType: file.type, uploadedByUserId: userId, updatedAt: new Date().toISOString() },
  });
  return Response.json({ media: { id, entityType, entityId, kind, fileName: file.name, mimeType: file.type, url: publicUrl } }, { status: 201 });
}

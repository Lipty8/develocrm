import {forwardBackendMutation} from "../../lib/backend-proxy";

export async function GET(request:Request){const url=new URL(request.url);const backendUrl=process.env.DEVELOCRM_API_URL?.replace(/\/$/,"");const tenantId=process.env.DEVELOCRM_TENANT_ID;const authorization=request.headers.get("authorization");
  if(!backendUrl||!tenantId||!authorization)return Response.json({error:"Správa šablon vyžaduje připojený backend"},{status:503});
  const templateId=url.searchParams.get("templateId"),versionId=url.searchParams.get("versionId"),action=url.searchParams.get("action");
  let target="/v1/document-templates";if(templateId&&versionId&&(action==="preview"||action==="source"))target+=`/${encodeURIComponent(templateId)}/versions/${encodeURIComponent(versionId)}/${action}`;
  else{const params=new URLSearchParams();for(const key of ["projectId","outputTypeCode"]){const value=url.searchParams.get(key);if(value)params.set(key,value);}target+=params.size?`?${params}`:"";}
  const response=await fetch(`${backendUrl}${target}`,{headers:{authorization,"x-tenant-id":tenantId},cache:"no-store"});
  if(action==="preview"||action==="source")return new Response(await response.arrayBuffer(),{status:response.status,headers:{"content-type":response.headers.get("content-type")??"application/octet-stream","content-disposition":response.headers.get("content-disposition")??"attachment"}});
  return Response.json(await response.json().catch(()=>({error:"Šablony se nepodařilo načíst"})),{status:response.status});}

export async function POST(request:Request){const url=new URL(request.url);const action=url.searchParams.get("action")??"upload";const templateId=url.searchParams.get("templateId"),versionId=url.searchParams.get("versionId");
  if(action!=="upload"&&(!templateId||!versionId))return Response.json({error:"Chybí verze šablony"},{status:400});
  const target=action==="upload"?"/v1/document-templates/upload":`/v1/document-templates/${encodeURIComponent(templateId!)}/versions/${encodeURIComponent(versionId!)}/${action}`;
  return forwardBackendMutation(request,{method:"POST",target,body:action==="upload"?await request.text():undefined,unavailableMessage:"Správa šablon vyžaduje připojený backend"});}

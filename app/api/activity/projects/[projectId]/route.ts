export async function GET(request:Request,context:{params:Promise<{projectId:string}>}){
  const backendUrl=process.env.DEVELOCRM_API_URL?.replace(/\/$/,"");const tenantId=process.env.DEVELOCRM_TENANT_ID;const authorization=request.headers.get("authorization");
  if(!backendUrl||!tenantId||!authorization)return Response.json({error:"Historie projektu vyžaduje připojený backend"},{status:503});
  const {projectId}=await context.params;const response=await fetch(`${backendUrl}/v1/projects/${encodeURIComponent(projectId)}/timeline`,{headers:{authorization,"x-tenant-id":tenantId},cache:"no-store"});
  return new Response(await response.text(),{status:response.status,headers:{"content-type":"application/json"}});
}

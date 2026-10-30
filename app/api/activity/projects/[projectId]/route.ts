export async function GET(request:Request,context:{params:Promise<{projectId:string}>}){
  const backendUrl=process.env.DEVELOCRM_API_URL?.replace(/\/$/,"");const tenantId=process.env.DEVELOCRM_TENANT_ID;const authorization=request.headers.get("authorization");
  const supplied=request.headers.get('x-correlation-id');const correlationId=supplied&&/^[a-zA-Z0-9._:-]{1,100}$/.test(supplied)?supplied:crypto.randomUUID();
  if(!backendUrl||!tenantId||!authorization)return Response.json({error:"Historie projektu vyžaduje připojený backend"},{status:503,headers:{'x-correlation-id':correlationId,'cache-control':'no-store'}});
  const {projectId}=await context.params;
  try{
    const response=await fetch(`${backendUrl}/v1/projects/${encodeURIComponent(projectId)}/timeline`,{headers:{authorization,"x-tenant-id":tenantId,'x-correlation-id':correlationId},cache:"no-store",signal:request.signal,redirect:'manual'});
    if(response.status>=300&&response.status<400)return Response.json({error:'Historii projektu se nepodařilo načíst.'},{status:502,headers:{'x-correlation-id':correlationId,'cache-control':'no-store'}});
    return new Response(await response.text(),{status:response.status,headers:{"content-type":"application/json",'x-correlation-id':response.headers.get('x-correlation-id')||correlationId,'cache-control':'no-store'}});
  }catch(error){
    if(!request.signal.aborted)console.warn(JSON.stringify({event:'bff.project_activity.read_failed',correlationId,status:502,errorName:error instanceof Error?error.name:'Error'}));
    return Response.json({error:'Historii projektu se nepodařilo načíst.'},{status:502,headers:{'x-correlation-id':correlationId,'cache-control':'no-store'}});
  }
}

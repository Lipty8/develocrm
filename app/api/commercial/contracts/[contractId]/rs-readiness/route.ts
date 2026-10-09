export async function GET(request:Request,context:{params:Promise<{contractId:string}>}){
  const base=process.env.DEVELOCRM_API_URL?.replace(/\/$/,"");const tenant=process.env.DEVELOCRM_TENANT_ID;const auth=request.headers.get("authorization");
  if(!base||!tenant||!auth)return Response.json({error:"Backend není připojen"},{status:503});
  const {contractId}=await context.params;const response=await fetch(new URL(`/v1/contracts/${encodeURIComponent(contractId)}/rs-readiness`,base),{headers:{authorization:auth,"x-tenant-id":tenant},cache:"no-store"});
  return new Response(await response.arrayBuffer(),{status:response.status,headers:{"content-type":response.headers.get("content-type")||"application/json","cache-control":"no-store"}});
}

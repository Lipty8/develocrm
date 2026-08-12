export async function GET(request:Request,context:{params:Promise<{unitId:string}>}){
  const base=process.env.DEVELOCRM_API_URL?.replace(/\/$/,"");const tenant=process.env.DEVELOCRM_TENANT_ID;const auth=request.headers.get("authorization");
  if(!base||!tenant||!auth)return Response.json({error:"Backend není připojen"},{status:503});
  const {unitId}=await context.params;const response=await fetch(new URL(`/v1/units/${encodeURIComponent(unitId)}/next-contract-action`,base),{headers:{authorization:auth,"x-tenant-id":tenant},cache:"no-store"});
  return new Response(await response.arrayBuffer(),{status:response.status,headers:{"content-type":response.headers.get("content-type")||"application/json","cache-control":"no-store"}});
}

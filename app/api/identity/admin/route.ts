import { prototypeSession } from "../../../repositories/identity-repository";

export async function GET(request:Request){
  const backendUrl=process.env.DEVELOCRM_API_URL?.replace(/\/$/,"");const tenantId=process.env.DEVELOCRM_TENANT_ID;const authorization=request.headers.get("authorization");
  if(!backendUrl||!tenantId||!authorization)return Response.json({error:"Preview adapter"},{status:503});
  const response=await fetch(`${backendUrl}/v1/admin`,{headers:{authorization,"x-tenant-id":tenantId},cache:"no-store"});
  return new Response(await response.text(),{status:response.status,headers:{"content-type":"application/json","x-workspace":prototypeSession.workspace.tenantId}});
}

import {backendAuthorization} from "../../../../../../../lib/backend-proxy";
export async function GET(request:Request,context:{params:Promise<{contractId:string;versionId:string}>}){
  const base=process.env.DEVELOCRM_API_URL?.replace(/\/$/,"");const tenant=process.env.DEVELOCRM_TENANT_ID;const auth=backendAuthorization(request.headers.get("authorization"));
  if(!base||!tenant||!auth)return Response.json({ready:false},{status:503});
  const {contractId,versionId}=await context.params;
  const response=await fetch(new URL(`/v1/contracts/${encodeURIComponent(contractId)}/versions/${encodeURIComponent(versionId)}/document-readiness`,base),{headers:{authorization:auth,"x-tenant-id":tenant},cache:"no-store"});
  return new Response(await response.arrayBuffer(),{status:response.status,headers:{"content-type":"application/json","cache-control":"no-store"}});
}

import {apiUnavailable,browserFallbackResponse,serverDataMode} from "../../../../lib/data-mode";

export async function GET(request:Request,context:{params:Promise<{unitId:string}>}){
  const {unitId}=await context.params;
  const backendUrl=process.env.DEVELOCRM_API_URL?.replace(/\/$/,"");
  const tenantId=process.env.DEVELOCRM_TENANT_ID;
  const authorization=request.headers.get("authorization");
  if(!backendUrl||!tenantId||!authorization)return serverDataMode()==="browser"
    ?browserFallbackResponse({events:[],source:"preview"})
    :apiUnavailable("Historie není dostupná bez společného backendu");
  const response=await fetch(`${backendUrl}/v1/units/${unitId}/timeline`,{headers:{authorization,"x-tenant-id":tenantId},cache:"no-store"});
  return new Response(await response.text(),{status:response.status,headers:{"content-type":"application/json"}});
}

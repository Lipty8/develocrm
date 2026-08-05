import {clients,unitCommercialContexts} from "../../crm-data";
import {apiUnavailable,browserFallbackResponse,serverDataMode} from "../../lib/data-mode";
import {forwardBackendMutation} from "../../lib/backend-proxy";
import type {ClientSnapshot} from "../../repositories/client-repository";

export async function GET(request:Request){
  const backendUrl=process.env.DEVELOCRM_API_URL?.replace(/\/$/,"");
  const tenantId=process.env.DEVELOCRM_TENANT_ID;
  const authorization=request.headers.get("authorization");
  const incoming=new URL(request.url).searchParams;
  if(!backendUrl||!tenantId||!authorization)return serverDataMode()==="browser"
    ?incoming.has("page")?browserFallbackResponse({clients:clients.slice((Math.max(1,Number(incoming.get("page"))||1)-1)*(Number(incoming.get("pageSize"))||25),Math.max(1,Number(incoming.get("page"))||1)*(Number(incoming.get("pageSize"))||25)),total:clients.length,page:Math.max(1,Number(incoming.get("page"))||1),pageSize:Number(incoming.get("pageSize"))||25,source:"preview-seed"}):browserFallbackResponse({clients,unitContexts:unitCommercialContexts,source:"preview-seed"} satisfies ClientSnapshot)
    :apiUnavailable("Klienti nejsou dostupní bez společného backendu");
  const response=await fetch(`${backendUrl}/v1/clients${incoming.size?`?${incoming}`:""}`,{headers:{authorization,"x-tenant-id":tenantId},cache:"no-store"});
  if(!response.ok)return Response.json({error:"Backend klientů není dostupný"},{status:response.status});
  return Response.json({...await response.json(),source:"backend-api"});
}
export async function POST(request:Request){
  if(serverDataMode()==="browser")return browserFallbackResponse({error:"Vývojový browser adapter"},{status:503});
  return forwardBackendMutation(request,{method:"POST",target:"/v1/parties",unavailableMessage:"Vytvoření klienta vyžaduje připojený backend"});
}

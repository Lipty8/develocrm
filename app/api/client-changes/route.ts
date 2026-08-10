import {apiUnavailable} from "../../lib/data-mode";
import {backendAuthorization,forwardBackendMutation} from "../../lib/backend-proxy";

export async function GET(request:Request){
  const backendUrl=process.env.DEVELOCRM_API_URL?.replace(/\/$/,"");const tenantId=process.env.DEVELOCRM_TENANT_ID;const authorization=backendAuthorization(request.headers.get("authorization"));
  if(!backendUrl||!tenantId||!authorization)return apiUnavailable("Klientské změny vyžadují připojený backend");
  const target=new URL("/v1/client-changes",backendUrl);new URL(request.url).searchParams.forEach((value,key)=>target.searchParams.set(key,value));
  try{const response=await fetch(target,{headers:{authorization,"x-tenant-id":tenantId,"x-correlation-id":request.headers.get("x-correlation-id")??crypto.randomUUID()},cache:"no-store"});return new Response(await response.arrayBuffer(),{status:response.status,headers:{"content-type":response.headers.get("content-type")??"application/json","x-correlation-id":response.headers.get("x-correlation-id")??""}});}catch{return apiUnavailable("Spojení s backendem se nezdařilo");}
}

export async function POST(request:Request){return forwardBackendMutation(request,{method:"POST",target:"/v1/client-changes",unavailableMessage:"Klientské změny vyžadují připojený backend"});}

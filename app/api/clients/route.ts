import { clients,unitCommercialContexts } from "../../crm-data";
import type { ClientSnapshot } from "../../repositories/client-repository";

export async function GET(request:Request) {
  const backendUrl=process.env.DEVELOCRM_API_URL?.replace(/\/$/,""); const tenantId=process.env.DEVELOCRM_TENANT_ID; const authorization=request.headers.get("authorization");
  if(!backendUrl||!tenantId||!authorization)return Response.json({clients,unitContexts:unitCommercialContexts,source:"preview-seed"} satisfies ClientSnapshot);
  const response=await fetch(`${backendUrl}/v1/clients`,{headers:{authorization,"x-tenant-id":tenantId},cache:"no-store"});
  if(!response.ok)return Response.json({error:"Backend klientů není dostupný"},{status:response.status});
  return Response.json({...await response.json(),source:"backend-api"});
}
export async function POST(request:Request){const backendUrl=process.env.DEVELOCRM_API_URL?.replace(/\/$/,"");const tenantId=process.env.DEVELOCRM_TENANT_ID;const authorization=request.headers.get("authorization");if(!backendUrl||!tenantId||!authorization)return Response.json({error:"Vytvoření klienta vyžaduje připojený backend"},{status:503});const response=await fetch(`${backendUrl}/v1/parties`,{method:"POST",headers:{authorization,"x-tenant-id":tenantId,"content-type":"application/json"},body:await request.text()});return new Response(await response.text(),{status:response.status,headers:{"content-type":"application/json"}});}

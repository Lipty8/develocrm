import {contracts,unitPriceHistories,units} from "../../crm-data";
import type {CommercialSnapshot} from "../../repositories/commercial-repository";
export async function GET(request:Request){
  const backendUrl=process.env.DEVELOCRM_API_URL?.replace(/\/$/,"");const tenantId=process.env.DEVELOCRM_TENANT_ID;const authorization=request.headers.get("authorization");
  if(!backendUrl||!tenantId||!authorization)return Response.json({currentPrices:Object.fromEntries(units.map(unit=>[unit.id,unit.price])),priceHistories:unitPriceHistories,contracts,contractSummary:{},source:"preview-seed"} satisfies CommercialSnapshot);
  const response=await fetch(`${backendUrl}/v1/commercial`,{headers:{authorization,"x-tenant-id":tenantId},cache:"no-store"});if(!response.ok)return Response.json({error:"Backend cen a smluv není dostupný"},{status:response.status});
  return Response.json({...await response.json(),source:"backend-api"});
}

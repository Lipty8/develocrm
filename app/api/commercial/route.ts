import {contracts,unitPriceHistories,units} from "../../crm-data";
import {apiUnavailable,browserFallbackResponse,serverDataMode} from "../../lib/data-mode";
import type {CommercialSnapshot} from "../../repositories/commercial-repository";

export async function GET(request:Request){
  const backendUrl=process.env.DEVELOCRM_API_URL?.replace(/\/$/,"");
  const tenantId=process.env.DEVELOCRM_TENANT_ID;
  const authorization=request.headers.get("authorization");
  if(!backendUrl||!tenantId||!authorization){
    if(serverDataMode()!=="browser")return apiUnavailable("Ceny a smlouvy nejsou dostupné bez společného backendu");
    return browserFallbackResponse({
      currentPrices:Object.fromEntries(units.map(unit=>[unit.id,unit.price])),
      priceHistories:unitPriceHistories,
      contracts:contracts.map(contract=>({...contract,id:contract.id??`preview-contract-${slug(contract.project)}-${slug(contract.unit)}-${slug(contract.type)}`,statusCode:contract.statusCode??statusCode(contract.state)})),
      contractSummary:{},source:"preview-seed",
    } satisfies CommercialSnapshot);
  }
  const response=await fetch(`${backendUrl}/v1/commercial`,{headers:{authorization,"x-tenant-id":tenantId},cache:"no-store"});
  if(!response.ok)return Response.json({error:"Backend cen a smluv není dostupný"},{status:response.status});
  return Response.json({...await response.json(),source:"backend-api"});
}
function slug(value:string){return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");}
function statusCode(label:string){return ({"V přípravě":"draft","Odeslána":"sent","Ve vyjednávání":"negotiation","Schválena":"approved","K podpisu":"signing","Podepsána":"signed","Zrušena":"cancelled","Ukončena":"terminated","Ke kontrole":"negotiation"} as Record<string,string>)[label]??"draft";}

import {contracts,projects,unitPriceHistories,units} from "../../crm-data";
import {apiUnavailable,browserFallbackResponse,serverDataMode} from "../../lib/data-mode";
import type {CommercialSnapshot} from "../../repositories/commercial-repository";

export async function GET(request:Request){
  const backendUrl=process.env.DEVELOCRM_API_URL?.replace(/\/$/,"");
  const tenantId=process.env.DEVELOCRM_TENANT_ID;
  const authorization=request.headers.get("authorization");
  const query=new URL(request.url).searchParams;const projectId=query.get("projectId");const projectName=projects.find(project=>(project.backendId??project.code)===projectId)?.name;const scopedUnits=projectId?units.filter(unit=>unit.projectBackendId===projectId||unit.project===projectName):units;const scopedContracts=projectId?contracts.filter(contract=>contract.projectId===projectId||contract.project===projectName):contracts;
  if(!backendUrl||!tenantId||!authorization){
    if(serverDataMode()!=="browser")return apiUnavailable("Ceny a smlouvy nejsou dostupné bez společného backendu");
    return browserFallbackResponse({
      currentPrices:Object.fromEntries(scopedUnits.map(unit=>[unit.id,unit.price])),
      priceBreakdowns:Object.fromEntries(scopedUnits.map(unit=>[unit.id,{unitPrice:unit.basePrice??unit.price,accessoryPrice:unit.accessoryPrice??0,totalPrice:unit.price}])),
      priceHistories:unitPriceHistories,
      contracts:scopedContracts.map(contract=>({...contract,id:contract.id??`preview-contract-${slug(contract.project)}-${slug(contract.unit)}-${slug(contract.type)}`,statusCode:contract.statusCode??statusCode(contract.state)})),
      contractSummary:{},source:"preview-seed",
    } satisfies CommercialSnapshot);
  }
  const response=await fetch(`${backendUrl}/v1/commercial${query.size?`?${query}`:""}`,{headers:{authorization,"x-tenant-id":tenantId},cache:"no-store"});
  if(!response.ok)return Response.json({error:"Backend cen a smluv není dostupný"},{status:response.status});
  return Response.json({...await response.json(),source:"backend-api"});
}
function slug(value:string){return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");}
function statusCode(label:string){return ({"V přípravě":"draft","Odeslána":"sent","Ve vyjednávání":"negotiation","Schválena":"approved","Schválená":"approved","K podpisu":"signing","Podepsána":"signed","Podepsaná":"signed","Zrušena":"cancelled","Ukončena":"terminated","Ke kontrole":"negotiation"} as Record<string,string>)[label]??"draft";}

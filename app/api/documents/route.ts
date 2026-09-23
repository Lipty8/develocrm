import type { DocumentListResponse,DocumentRecord } from "../../repositories/document-repository";
import { previewConnection } from "../../repositories/document-repository";
import { clients,contracts } from "../../crm-data";
import { apiUnavailable, browserFallbackResponse, serverDataMode } from "../../lib/data-mode";
import { forwardBackendMutation } from "../../lib/backend-proxy";

const previewDocuments:DocumentRecord[]=[];

export async function GET(request:Request){
  const url=new URL(request.url);const backendUrl=process.env.DEVELOCRM_API_URL?.replace(/\/$/,"");const tenantId=process.env.DEVELOCRM_TENANT_ID;const authorization=request.headers.get("authorization");
  if(backendUrl&&tenantId&&authorization){
    const target=backendTarget(url);if(!target)return Response.json({error:"Chybí kontext dokumentů"},{status:400});
    const response=await fetch(`${backendUrl}${target}`,{headers:{authorization,"x-tenant-id":tenantId},cache:"no-store"});const payload=await response.json().catch(()=>({error:"Dokumentový backend není dostupný"}));
    if(!response.ok)return Response.json(payload,{status:response.status});if(url.searchParams.get("connection")==="sharepoint")return Response.json(payload);
    const documents="document" in payload?[payload.document]:payload.documents;return Response.json({documents,connection:payload.connection??previewConnection,source:"backend-api"});
  }
  if(serverDataMode()!=="browser")return apiUnavailable("Dokumenty nejsou dostupné bez společného backendu");
  if(url.searchParams.get("connection")==="sharepoint")return Response.json({connection:previewConnection});
  const documentId=url.searchParams.get("documentId");const projectId=url.searchParams.get("projectId");const unitId=url.searchParams.get("unitId");const typeCode=url.searchParams.get("typeCode");const status=url.searchParams.get("status");const query=(url.searchParams.get("query")??"").toLowerCase();
  const partyId=url.searchParams.get("partyId");const partyName=clients.find(client=>client.id===partyId)?.name;
  const contractId=url.searchParams.get("contractId");const contract=contracts.find(item=>item.id===contractId||item.reference===contractId);
  const documents=previewDocuments.filter(document=>(!documentId||document.id===documentId)&&(!projectId||document.projectId===projectId)&&(!unitId||document.units.includes(unitId))&&(!partyId||Boolean(partyName&&document.parties.includes(partyName)))&&(!contractId||document.contracts.includes(contractId)||Boolean(contract&&document.units.includes(contract.unit)&&document.typeName.includes(contract.type==="RS"?"Rezervační":contract.type==="SBK"?"budoucí":contract.type==="KS"?"Kupní":"Dodatek")))&&(!typeCode||document.typeCode===typeCode)&&(!status||document.status===status)&&(!query||`${document.name} ${document.typeName} ${document.projectName} ${document.units.join(" ")} ${document.parties.join(" ")}`.toLowerCase().includes(query)));
  return browserFallbackResponse({documents,connection:previewConnection,source:"preview-adapter"} satisfies DocumentListResponse);
}

export async function POST(request:Request){return forwardMutation(request,"POST");}
export async function PATCH(request:Request){return forwardMutation(request,"PATCH");}

async function forwardMutation(request:Request,method:"POST"|"PATCH"){
  const url=new URL(request.url);const backendUrl=process.env.DEVELOCRM_API_URL?.replace(/\/$/,"");const tenantId=process.env.DEVELOCRM_TENANT_ID;const authorization=request.headers.get("authorization");
  if(serverDataMode()==="browser")return browserFallbackResponse({error:"Změna je ve vývojovém režimu uložena lokálně"},{status:503});
  const documentId=url.searchParams.get("documentId");const action=url.searchParams.get("action");
  const body=await request.json() as Record<string,unknown>;
  const linkTargets:Record<string,string>={client_change:"client-change-links",complaint:"complaint-links",handover:"handover-links"};
  const linkSuffix=action==="link"?linkTargets[String(body.linkType??"")]:undefined;
  if(action==="link"&&(!documentId||!linkSuffix))return Response.json({error:"Neplatný typ vazby dokumentu"},{status:400});
  const target=documentId&&action==="version"?`/v1/documents/${encodeURIComponent(documentId)}/versions`:documentId&&linkSuffix?`/v1/documents/${encodeURIComponent(documentId)}/${linkSuffix}`:documentId?`/v1/documents/${encodeURIComponent(documentId)}`:"/v1/documents";
  if(action==="link"){
    const property=String(body.linkType)==="client_change"?"clientChangeId":String(body.linkType)==="complaint"?"complaintId":"handoverId";
    for(const key of Object.keys(body))delete body[key];
    body[property]=url.searchParams.get("targetId");
  }
  if(action==="version"&&documentId){
    body.versionIdentifier=`${documentId}-${String(body.label??Date.now())}`;
    body.versionLabel=body.label;
  }
  const response=await forwardBackendMutation(request,{method,target,body:JSON.stringify(body),unavailableMessage:"Změna dokumentu vyžaduje připojený backend"});
  const responseText=await response.text();
  if(response.ok&&method==="POST"&&!documentId&&backendUrl&&tenantId&&authorization){
    const created=JSON.parse(responseText) as {id:string};
    const detail=await fetch(`${backendUrl}/v1/documents/${encodeURIComponent(created.id)}`,{headers:{authorization,"x-tenant-id":tenantId},cache:"no-store"});
    if(detail.ok)return new Response(await detail.text(),{status:201,headers:{"content-type":"application/json"}});
  }
  return new Response(responseText,{status:response.status,headers:{"content-type":"application/json"}});
}

function backendTarget(url:URL){const params=url.searchParams;if(params.get("connection")==="sharepoint")return"/v1/document-connections/sharepoint";if(params.get("documentId"))return`/v1/documents/${encodeURIComponent(params.get("documentId")!)}`;if(params.get("clientChangeId"))return`/v1/client-changes/${encodeURIComponent(params.get("clientChangeId")!)}/documents`;if(params.get("complaintId"))return`/v1/complaints/${encodeURIComponent(params.get("complaintId")!)}/documents`;if(params.get("handoverId"))return`/v1/handovers/${encodeURIComponent(params.get("handoverId")!)}/documents`;if(params.get("projectId"))return`/v1/projects/${encodeURIComponent(params.get("projectId")!)}/documents?${copyFilters(params,["category","unitId","partyId"])}`;if(params.get("unitId"))return`/v1/units/${encodeURIComponent(params.get("unitId")!)}/documents?${copyFilters(params,["category"])}`;if(params.get("partyId"))return`/v1/parties/${encodeURIComponent(params.get("partyId")!)}/documents`;if(params.get("contractId"))return`/v1/contracts/${encodeURIComponent(params.get("contractId")!)}/documents`;return`/v1/documents?${copyFilters(params,["query","typeCode","status","projectId","partyId","unitId","contractId","clientChangeId","complaintId","handoverId"])}`;}
function copyFilters(source:URLSearchParams,keys:string[]){const target=new URLSearchParams();for(const key of keys){const value=source.get(key);if(value)target.set(key,value);}return target.toString();}

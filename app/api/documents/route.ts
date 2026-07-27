import type { DocumentEventRecord,DocumentListResponse,DocumentRecord,DocumentStatus,DocumentVersionRecord } from "../../repositories/document-repository";
import { previewConnection } from "../../repositories/document-repository";
import { clients,contracts } from "../../crm-data";

const version=(id:string,label:string,status:DocumentStatus,note:string,createdAt:string,author:string):DocumentVersionRecord=>({id,identifier:id,label,status,note,fileSize:null,createdAt,author});
const event=(id:string,type:string,title:string,note:string,occurredAt:string,actor:string,versionLabel:string|null,previousStatus:string|null=null,newStatus:string|null=null):DocumentEventRecord=>({id,type,title,note,occurredAt,actor,versionLabel,previousStatus,newStatus});
const previewDocuments:DocumentRecord[]=[
  doc({id:"preview-doc-a203-sbk",projectId:"RJ",projectName:"Rezidence Javorová",name:"SBK A203 – Jana a Petr Novákovi",typeCode:"future_purchase_contract",typeName:"Smlouva o budoucí kupní",status:"negotiation",note:"Zapracovat připomínku k termínu třetí splátky.",createdAt:"2026-03-20T07:00:00Z",updatedAt:"2026-07-21T07:42:00Z",author:"Pavel Sedlák",version:"v3",units:["A203"],parties:["Jana a Petr Novákovi"],contracts:["RJ-A203-SBK","preview-contract-rezidence-javorova-a203-sbk"],salesCases:["A203 · aktivní obchodní případ"],versions:[
    version("a203-v3","v3","negotiation","Zapracované připomínky klienta","2026-07-21T07:42:00Z","Pavel Sedlák"),
    version("a203-v2","v2","sent","Odesláno klientovi","2026-04-02T11:10:00Z","Iva Novotná"),
    version("a203-v1","v1","draft","První návrh","2026-03-20T07:00:00Z","Iva Novotná"),
  ],events:[
    event("a203-e3","version_created","Vytvořena nová verze v3","Zapracovány připomínky klienta","2026-07-21T07:42:00Z","Pavel Sedlák","v3","sent","negotiation"),
    event("a203-e2","status_changed","Dokument odeslán klientovi","Odesláno e-mailem k připomínkám","2026-04-02T11:10:00Z","Iva Novotná","v2","draft","sent"),
    event("a203-e1","created","Dokument vytvořen","První návrh SBK","2026-03-20T07:00:00Z","Iva Novotná","v1",null,"draft"),
  ]}),
  doc({id:"preview-doc-a305-rs",projectId:"RJ",projectName:"Rezidence Javorová",name:"RS A305 – David Kříž",typeCode:"reservation_contract",typeName:"Rezervační smlouva",status:"sent",note:"Klientovi odesláno k podpisu.",createdAt:"2026-06-14T08:15:00Z",updatedAt:"2026-07-18T13:18:00Z",author:"Iva Novotná",version:"v1",units:["A305"],parties:["David Kříž"],contracts:["RJ-A305-RS","preview-contract-rezidence-javorova-a305-rs"],salesCases:["A305 · aktivní obchodní případ"],versions:[version("a305-v1","v1","sent","Odesláno k podpisu","2026-07-18T13:18:00Z","Iva Novotná")],events:[
    event("a305-e2","status_changed","Dokument odeslán k podpisu","Čeká se na klienta","2026-07-18T13:18:00Z","Iva Novotná","v1","ready","sent"),
    event("a305-e1","created","Dokument vytvořen","Rezervační smlouva připravena","2026-06-14T08:15:00Z","Iva Novotná","v1",null,"draft"),
  ]}),
  doc({id:"preview-doc-b308-ks",projectId:"RJ",projectName:"Rezidence Javorová",name:"KS B308 – Alto Services s.r.o.",typeCode:"purchase_contract",typeName:"Kupní smlouva",status:"signed",note:"Podepsaná verze uložená v evidenci CRM.",createdAt:"2026-02-10T10:30:00Z",updatedAt:"2026-06-02T12:10:00Z",author:"Iva Novotná",version:"v1",units:["B308"],parties:["Alto Services s.r.o."],contracts:["RJ-B308-KS","preview-contract-rezidence-javorova-b308-ks"],salesCases:["B308 · uzavřený obchodní případ"],versions:[version("b308-v1","v1","signed","Podepsaná finální verze","2026-06-02T12:10:00Z","Iva Novotná")],events:[
    event("b308-e2","status_changed","Dokument podepsán","Podepsáno oběma stranami","2026-06-02T12:10:00Z","Iva Novotná","v1","sent","signed"),
    event("b308-e1","created","Dokument vytvořen","Kupní smlouva","2026-02-10T10:30:00Z","Iva Novotná","v1",null,"draft"),
  ]}),
  doc({id:"preview-doc-d404-amendment",projectId:"PČ",projectName:"Parková čtvrť",name:"Dodatek č. 2 – D404",typeCode:"amendment",typeName:"Dodatek",status:"negotiation",note:"Změna termínu dokončení klientských změn.",createdAt:"2026-07-18T06:20:00Z",updatedAt:"2026-07-21T11:05:00Z",author:"Iva Novotná",version:"v1",units:["D404"],parties:["Tomáš Janda"],contracts:["PC-D404-D02"],salesCases:["D404 · aktivní obchodní případ"],versions:[version("d404-v1","v1","negotiation","Pracovní verze dodatku","2026-07-21T11:05:00Z","Iva Novotná")],events:[event("d404-e1","created","Dokument vytvořen","Dodatek k SBK","2026-07-18T06:20:00Z","Iva Novotná","v1",null,"draft")]}),
  doc({id:"preview-doc-c211-handover",projectId:"PČ",projectName:"Parková čtvrť",name:"Předávací protokol C211",typeCode:"handover_protocol",typeName:"Předávací protokol",status:"signed",note:"Protokol podepsán oběma stranami.",createdAt:"2026-07-08T07:00:00Z",updatedAt:"2026-07-08T09:45:00Z",author:"Pavel Sedlák",version:"v1",units:["C211"],parties:["Kateřina Dvořáková"],contracts:[],salesCases:[],versions:[version("c211-v1","v1","signed","Podepsaný protokol","2026-07-08T09:45:00Z","Pavel Sedlák")],events:[event("c211-e1","created","Předávací protokol vytvořen","Podepsáno při předání","2026-07-08T09:45:00Z","Pavel Sedlák","v1",null,"signed")]}),
  doc({id:"preview-doc-a203-photos",projectId:"RJ",projectName:"Rezidence Javorová",name:"Fotodokumentace před předáním A203",typeCode:"photo_documentation",typeName:"Fotodokumentace",status:"ready",note:"Kontrolní sada fotografií dokončené jednotky.",createdAt:"2026-07-20T12:00:00Z",updatedAt:"2026-07-20T12:00:00Z",author:"Martin Jelínek",version:"v1",units:["A203"],parties:[],contracts:[],salesCases:["A203 · aktivní obchodní případ"],versions:[version("photos-v1","v1","ready","Kontrolní sada","2026-07-20T12:00:00Z","Martin Jelínek")],events:[event("photos-e1","created","Fotodokumentace přidána","Kontrolní sada","2026-07-20T12:00:00Z","Martin Jelínek","v1",null,"ready")]}),
  doc({id:"preview-doc-a203-change",projectId:"RJ",projectName:"Rezidence Javorová",name:"Klientská změna – podlaha A203",typeCode:"client_change",typeName:"Klientská změna",status:"ready",note:"Schválený výběr dubové podlahy.",createdAt:"2026-07-15T08:00:00Z",updatedAt:"2026-07-19T14:00:00Z",author:"Pavel Sedlák",version:"v2",units:["A203"],parties:["Jana a Petr Novákovi"],contracts:[],salesCases:["A203 · aktivní obchodní případ"],versions:[version("change-v2","v2","ready","Schváleno klientem","2026-07-19T14:00:00Z","Pavel Sedlák"),version("change-v1","v1","draft","První návrh","2026-07-15T08:00:00Z","Pavel Sedlák")],events:[event("change-e1","version_created","Vytvořena verze v2","Schválený výběr","2026-07-19T14:00:00Z","Pavel Sedlák","v2","draft","ready")]}),
];

export async function GET(request:Request){
  const url=new URL(request.url);const backendUrl=process.env.DEVELOCRM_API_URL?.replace(/\/$/,"");const tenantId=process.env.DEVELOCRM_TENANT_ID;const authorization=request.headers.get("authorization");
  if(backendUrl&&tenantId&&authorization){
    const target=backendTarget(url);if(!target)return Response.json({error:"Chybí kontext dokumentů"},{status:400});
    const response=await fetch(`${backendUrl}${target}`,{headers:{authorization,"x-tenant-id":tenantId},cache:"no-store"});const payload=await response.json().catch(()=>({error:"Dokumentový backend není dostupný"}));
    if(!response.ok)return Response.json(payload,{status:response.status});if(url.searchParams.get("connection")==="sharepoint")return Response.json(payload);
    const documents="document" in payload?[payload.document]:payload.documents;return Response.json({documents,connection:payload.connection??previewConnection,source:"backend-api"});
  }
  if(url.searchParams.get("connection")==="sharepoint")return Response.json({connection:previewConnection});
  const documentId=url.searchParams.get("documentId");const projectId=url.searchParams.get("projectId");const unitId=url.searchParams.get("unitId");const typeCode=url.searchParams.get("typeCode");const status=url.searchParams.get("status");const query=(url.searchParams.get("query")??"").toLowerCase();
  const partyId=url.searchParams.get("partyId");const partyName=clients.find(client=>client.id===partyId)?.name;
  const contractId=url.searchParams.get("contractId");const contract=contracts.find(item=>item.id===contractId||item.reference===contractId);
  const documents=previewDocuments.filter(document=>(!documentId||document.id===documentId)&&(!projectId||document.projectId===projectId)&&(!unitId||document.units.includes(unitId))&&(!partyId||Boolean(partyName&&document.parties.includes(partyName)))&&(!contractId||document.contracts.includes(contractId)||Boolean(contract&&document.units.includes(contract.unit)&&document.typeName.includes(contract.type==="RS"?"Rezervační":contract.type==="SBK"?"budoucí":contract.type==="KS"?"Kupní":"Dodatek")))&&(!typeCode||document.typeCode===typeCode)&&(!status||document.status===status)&&(!query||`${document.name} ${document.typeName} ${document.projectName} ${document.units.join(" ")} ${document.parties.join(" ")}`.toLowerCase().includes(query)));
  return Response.json({documents,connection:previewConnection,source:"preview-adapter"} satisfies DocumentListResponse);
}

export async function POST(request:Request){return forwardMutation(request,"POST");}
export async function PATCH(request:Request){return forwardMutation(request,"PATCH");}

async function forwardMutation(request:Request,method:"POST"|"PATCH"){
  const url=new URL(request.url);const backendUrl=process.env.DEVELOCRM_API_URL?.replace(/\/$/,"");const tenantId=process.env.DEVELOCRM_TENANT_ID;const authorization=request.headers.get("authorization");
  if(!backendUrl||!tenantId||!authorization)return Response.json({error:"Změna je v preview uložena lokálně v prohlížeči"},{status:503});
  const documentId=url.searchParams.get("documentId");const target=documentId&&url.searchParams.get("action")==="version"?`/v1/documents/${encodeURIComponent(documentId)}/versions`:documentId?`/v1/documents/${encodeURIComponent(documentId)}`:"/v1/documents";
  const body=await request.json() as Record<string,unknown>;
  if(url.searchParams.get("action")==="version"&&documentId)body.versionIdentifier=`${documentId}-${String(body.label??Date.now())}`,body.versionLabel=body.label;
  const response=await fetch(`${backendUrl}${target}`,{method,headers:{authorization,"x-tenant-id":tenantId,"content-type":"application/json"},body:JSON.stringify(body)});
  const responseText=await response.text();
  if(response.ok&&method==="POST"&&!documentId){
    const created=JSON.parse(responseText) as {id:string};
    const detail=await fetch(`${backendUrl}/v1/documents/${encodeURIComponent(created.id)}`,{headers:{authorization,"x-tenant-id":tenantId},cache:"no-store"});
    if(detail.ok)return new Response(await detail.text(),{status:201,headers:{"content-type":"application/json"}});
  }
  return new Response(responseText,{status:response.status,headers:{"content-type":"application/json"}});
}

function backendTarget(url:URL){const params=url.searchParams;if(params.get("connection")==="sharepoint")return"/v1/document-connections/sharepoint";if(params.get("documentId"))return`/v1/documents/${encodeURIComponent(params.get("documentId")!)}`;if(params.get("projectId"))return`/v1/projects/${encodeURIComponent(params.get("projectId")!)}/documents?${copyFilters(params,["category","unitId","partyId"])}`;if(params.get("unitId"))return`/v1/units/${encodeURIComponent(params.get("unitId")!)}/documents?${copyFilters(params,["category"])}`;if(params.get("partyId"))return`/v1/parties/${encodeURIComponent(params.get("partyId")!)}/documents`;if(params.get("contractId"))return`/v1/contracts/${encodeURIComponent(params.get("contractId")!)}/documents`;return`/v1/documents?${copyFilters(params,["query","typeCode","status","projectId","partyId","unitId","contractId"])}`;}
function copyFilters(source:URLSearchParams,keys:string[]){const target=new URLSearchParams();for(const key of keys){const value=source.get(key);if(value)target.set(key,value);}return target.toString();}
function doc(input:Partial<DocumentRecord>&Pick<DocumentRecord,"id"|"projectId"|"projectName"|"name"|"typeCode"|"typeName"|"status"|"createdAt"|"updatedAt"|"author"|"version"|"units"|"parties"|"contracts"|"salesCases">):DocumentRecord{return{category:["reservation_contract","future_purchase_contract","purchase_contract","amendment"].includes(input.typeCode)?"contract":input.typeCode==="client_change"?"client_document":"project_documentation",note:null,mimeType:"application/pdf",fileSize:null,storageProvider:"preview",webUrl:null,etag:null,sensitivity:"normal",versions:[],events:[],...input};}

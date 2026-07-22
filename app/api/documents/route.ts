import type { DocumentListResponse, DocumentRecord } from "../../repositories/document-repository";
import { previewConnection } from "../../repositories/document-repository";
import { clients } from "../../crm-data";

const previewDocuments:DocumentRecord[]=[
  {id:"preview-doc-project-standards",projectId:"RJ",projectName:"Rezidence Javorová",name:"Standardy projektu.pdf",category:"project_documentation",mimeType:"application/pdf",fileSize:2480000,storageProvider:"preview",webUrl:null,etag:"preview-1",sensitivity:"normal",updatedAt:"2026-07-18T09:30:00Z",author:"Martin Jelínek",version:"v3",units:[],parties:[],contracts:[]},
  {id:"preview-doc-a203-sbk",projectId:"RJ",projectName:"Rezidence Javorová",name:"SBK_A203_v04.docx",category:"contract",mimeType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",fileSize:184000,storageProvider:"preview",webUrl:null,etag:"preview-2",sensitivity:"sensitive",updatedAt:"2026-07-21T09:42:00Z",author:"Pavel Sedlák",version:"v04",units:["A203"],parties:["Jana a Petr Novákovi"],contracts:["RJ-A203-SBK"]},
  {id:"preview-doc-a203-rs",projectId:"RJ",projectName:"Rezidence Javorová",name:"RS_A203_podepsana.pdf",category:"reservation",mimeType:"application/pdf",fileSize:522000,storageProvider:"preview",webUrl:null,etag:"preview-3",sensitivity:"sensitive",updatedAt:"2026-03-18T14:00:00Z",author:"Iva Novotná",version:"finální",units:["A203"],parties:["Jana a Petr Novákovi"],contracts:["RJ-A203-RS"]},
  {id:"preview-doc-a305-offer",projectId:"RJ",projectName:"Rezidence Javorová",name:"Cenová_nabídka_A305.pdf",category:"price_document",mimeType:"application/pdf",fileSize:312000,storageProvider:"preview",webUrl:null,etag:"preview-4",sensitivity:"normal",updatedAt:"2026-07-15T08:10:00Z",author:"Iva Novotná",version:"v2",units:["A305"],parties:["David Kříž"],contracts:[]},
  {id:"preview-doc-project-situation",projectId:"RJ",projectName:"Rezidence Javorová",name:"Situace_projektu.pdf",category:"project_documentation",mimeType:"application/pdf",fileSize:4110000,storageProvider:"preview",webUrl:null,etag:"preview-5",sensitivity:"normal",updatedAt:"2026-07-12T11:00:00Z",author:"Martin Jelínek",version:"rev02",units:[],parties:[],contracts:[]},
];

export async function GET(request:Request){
  const url=new URL(request.url);const backendUrl=process.env.DEVELOCRM_API_URL?.replace(/\/$/,"");const tenantId=process.env.DEVELOCRM_TENANT_ID;const authorization=request.headers.get("authorization");
  if(backendUrl&&tenantId&&authorization){
    const projectId=url.searchParams.get("projectId");const unitId=url.searchParams.get("unitId");
    const target=url.searchParams.get("connection")==="sharepoint"?"/v1/document-connections/sharepoint":projectId?`/v1/projects/${encodeURIComponent(projectId)}/documents?${copyFilters(url.searchParams,["category","unitId","partyId"])}`:unitId?`/v1/units/${encodeURIComponent(unitId)}/documents?${copyFilters(url.searchParams,["category"])}`:null;
    if(!target)return Response.json({error:"Chybí kontext dokumentů"},{status:400});
    const response=await fetch(`${backendUrl}${target}`,{headers:{authorization,"x-tenant-id":tenantId},cache:"no-store"});
    const payload=await response.json().catch(()=>({error:"Dokumentový backend není dostupný"}));
    if(!response.ok)return Response.json(payload,{status:response.status});
    if(url.searchParams.get("connection")==="sharepoint")return Response.json(payload);
    return Response.json({...payload,source:"backend-api"});
  }
  if(url.searchParams.get("connection")==="sharepoint")return Response.json({connection:previewConnection});
  const projectId=url.searchParams.get("projectId");const unitId=url.searchParams.get("unitId");const category=url.searchParams.get("category");const partyId=url.searchParams.get("partyId");const partyName=clients.find(client=>client.id===partyId)?.name;
  const documents=previewDocuments.filter(document=>(!projectId||document.projectId===projectId)&&(!unitId||document.units.includes(unitId))&&(!partyId||Boolean(partyName&&document.parties.includes(partyName)))&&(!category||document.category===category));
  return Response.json({documents,connection:previewConnection,source:"preview-adapter"} satisfies DocumentListResponse);
}

function copyFilters(source:URLSearchParams,keys:string[]):string{const target=new URLSearchParams();for(const key of keys){const value=source.get(key);if(value)target.set(key,value);}return target.toString();}

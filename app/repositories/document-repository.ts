import type { MediaLink } from "./media-repository";
import { mediaRepository } from "./media-repository";
import { responseAllowsBrowserFallback } from "../lib/data-mode";
import { apiFetch } from "../lib/api-client";

export type DocumentCategory = "contract" | "floor_plan" | "project_documentation" | "client_document" | "price_document" | "reservation" | "other";
export type DocumentStatus = "draft" | "ready" | "sent" | "negotiation" | "signed" | "archived";
export type DocumentConnectionState = { status:"not_configured"|"connected"|"error"|"disabled";syncStatus:"idle"|"syncing"|"error"|"paused";lastSuccessfulSyncAt:string|null };
export type DocumentVersionRecord={id:string;identifier:string;label:string;status:DocumentStatus;note:string|null;fileSize:number|null;createdAt:string;author:string|null};
export type DocumentEventRecord={id:string;type:string;title:string;note:string|null;previousStatus:string|null;newStatus:string|null;occurredAt:string;actor:string;versionLabel:string|null};
export type DocumentRecord = {
  id:string;projectId:string;projectName:string;name:string;category:DocumentCategory;typeCode:string;typeName:string;
  status:DocumentStatus;note:string|null;mimeType:string;fileSize:number|null;
  storageProvider:"sharepoint"|"preview"|"external"|"preview_media";webUrl:string|null;etag:string|null;sensitivity:"normal"|"sensitive";
  createdAt:string;updatedAt:string;author:string|null;version:string|null;units:string[];parties:string[];contracts:string[];salesCases:string[];
  versions?:DocumentVersionRecord[];events?:DocumentEventRecord[];
};
export type DocumentListResponse={documents:DocumentRecord[];connection:DocumentConnectionState;source:"backend-api"|"preview-adapter"};
export type DocumentFilters={query?:string;category?:string;typeCode?:string;status?:string;projectId?:string;unitId?:string;partyId?:string;contractId?:string};
export type NewDocumentInput={projectId:string;projectName:string;name:string;typeCode:string;typeName:string;status:DocumentStatus;note?:string;unit?:string;party?:string;contract?:string;salesCase?:string;author?:string};

export const documentTypeOptions=[
  {code:"reservation_contract",name:"Rezervační smlouva"},{code:"future_purchase_contract",name:"Smlouva o budoucí kupní"},
  {code:"purchase_contract",name:"Kupní smlouva"},{code:"amendment",name:"Dodatek"},{code:"client_change",name:"Klientská změna"},
  {code:"handover_protocol",name:"Předávací protokol"},{code:"complaint_protocol",name:"Reklamační protokol"},
  {code:"photo_documentation",name:"Fotodokumentace"},{code:"other",name:"Jiné"},
];

export interface DocumentRepository {
  listAll(filters?:DocumentFilters,signal?:AbortSignal):Promise<DocumentListResponse>;
  listProject(projectId:string,filters?:DocumentFilters,signal?:AbortSignal):Promise<DocumentListResponse>;
  listUnit(unitId:string,filters?:DocumentFilters,signal?:AbortSignal):Promise<DocumentListResponse>;
  listParty(partyId:string,signal?:AbortSignal):Promise<DocumentListResponse>;
  listContract(contractId:string,signal?:AbortSignal):Promise<DocumentListResponse>;
  get(documentId:string,signal?:AbortSignal):Promise<DocumentRecord|null>;
  create(input:NewDocumentInput):Promise<DocumentRecord>;
  update(document:DocumentRecord,input:{name:string;typeCode:string;typeName:string;status:DocumentStatus;note:string}):Promise<void>;
  addVersion(document:DocumentRecord,input:{label:string;status:DocumentStatus;note:string;author?:string}):Promise<void>;
  connection(signal?:AbortSignal):Promise<DocumentConnectionState>;
}

class ApiDocumentRepository implements DocumentRepository {
  async listAll(filters:DocumentFilters={},signal?:AbortSignal){return mergePreview(await requestDocuments(filters,signal),filters);}
  async listProject(projectId:string,filters:DocumentFilters={},signal?:AbortSignal){return mergePreview(await requestDocuments({projectId,...filters},signal),{projectId,...filters});}
  async listUnit(unitId:string,filters:DocumentFilters={},signal?:AbortSignal){
    const response=mergePreview(await requestDocuments({unitId,...filters},signal),{unitId,...filters});
    const media=await mediaRepository.get("unit",unitId,signal).catch(()=>null);
    if(media&&!response.documents.some(document=>document.category==="floor_plan"))response.documents.unshift(mediaDocument(media));
    return response;
  }
  async listParty(partyId:string,signal?:AbortSignal){return mergePreview(await requestDocuments({partyId},signal),{partyId});}
  async listContract(contractId:string,signal?:AbortSignal){return mergePreview(await requestDocuments({contractId},signal),{contractId});}
  async get(documentId:string,signal?:AbortSignal){
    const response=mergePreview(await requestDocuments({documentId},signal),{documentId});
    return response.documents.find(document=>document.id===documentId)??null;
  }
  async create(input:NewDocumentInput){
    const response=await apiFetch("/api/documents",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(input)});
    if(response.ok)return (await response.json() as {document:DocumentRecord}).document;
    if(!(response.status===503&&responseAllowsBrowserFallback(response)))throw await responseError(response,"Dokument se nepodařilo vytvořit");
    const now=new Date().toISOString();const id=`preview-doc-${Date.now()}`;
    const document:DocumentRecord={id,projectId:input.projectId,projectName:input.projectName,name:input.name,category:categoryForType(input.typeCode),typeCode:input.typeCode,typeName:input.typeName,status:input.status,note:input.note??null,mimeType:"application/octet-stream",fileSize:null,storageProvider:"preview",webUrl:null,etag:null,sensitivity:"normal",createdAt:now,updatedAt:now,author:input.author??"Iva Novotná",version:"v1",units:input.unit?[input.unit]:[],parties:input.party?[input.party]:[],contracts:input.contract?[input.contract]:[],salesCases:input.salesCase?[input.salesCase]:[],versions:[{id:`${id}-v1`,identifier:`${id}-v1`,label:"v1",status:input.status,note:input.note??null,fileSize:null,createdAt:now,author:input.author??"Iva Novotná"}],events:[{id:`${id}-e1`,type:"created",title:"Dokument vytvořen",note:input.note??null,previousStatus:null,newStatus:input.status,occurredAt:now,actor:input.author??"Iva Novotná",versionLabel:"v1"}]};
    const rows=previewCreated();rows.unshift(document);localStorage.setItem("develocrm.documents.created",JSON.stringify(rows));return document;
  }
  async update(document:DocumentRecord,input:{name:string;typeCode:string;typeName:string;status:DocumentStatus;note:string}){
    const response=await apiFetch(`/api/documents?documentId=${encodeURIComponent(document.id)}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify(input)});
    if(response.ok)return;if(!(response.status===503&&responseAllowsBrowserFallback(response)))throw await responseError(response,"Dokument se nepodařilo upravit");
    const edits=previewEdits();const now=new Date().toISOString();const previousStatus=edits[document.id]?.status??document.status;
    const events=[{id:`${document.id}-event-${Date.now()}`,type:previousStatus===input.status?"metadata_changed":"status_changed",title:previousStatus===input.status?"Metadata dokumentu upravena":"Stav dokumentu změněn",note:input.note,previousStatus,newStatus:input.status,occurredAt:now,actor:"Iva Novotná",versionLabel:document.version},...(edits[document.id]?.events??[])];
    edits[document.id]={...input,updatedAt:now,events};localStorage.setItem("develocrm.documents.edits",JSON.stringify(edits));
  }
  async addVersion(document:DocumentRecord,input:{label:string;status:DocumentStatus;note:string;author?:string}){
    const response=await apiFetch(`/api/documents?documentId=${encodeURIComponent(document.id)}&action=version`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(input)});
    if(response.ok)return;if(!(response.status===503&&responseAllowsBrowserFallback(response)))throw await responseError(response,"Verzi dokumentu se nepodařilo vytvořit");
    const edits=previewEdits();const now=new Date().toISOString();const version={id:`${document.id}-${input.label}-${Date.now()}`,identifier:`${document.id}-${input.label}`,label:input.label,status:input.status,note:input.note,fileSize:null,createdAt:now,author:input.author??"Iva Novotná"};
    const event={id:`${document.id}-event-${Date.now()}`,type:"version_created",title:`Vytvořena nová verze ${input.label}`,note:input.note,previousStatus:document.status,newStatus:input.status,occurredAt:now,actor:input.author??"Iva Novotná",versionLabel:input.label};
    edits[document.id]={...(edits[document.id]??{}),status:input.status,version:input.label,updatedAt:now,versions:[version,...(edits[document.id]?.versions??[])],events:[event,...(edits[document.id]?.events??[])]};localStorage.setItem("develocrm.documents.edits",JSON.stringify(edits));
  }
  async connection(signal?:AbortSignal){
    const response=await apiFetch("/api/documents?connection=sharepoint",{signal,cache:"no-store"});
    if(!response.ok)return previewConnection;
    return ((await response.json()) as {connection:DocumentConnectionState}).connection;
  }
}

async function requestDocuments(params:Record<string,string|undefined>,signal?:AbortSignal):Promise<DocumentListResponse>{
  const search=new URLSearchParams();for(const [key,value] of Object.entries(params))if(value)search.set(key,value);
  const response=await apiFetch(`/api/documents?${search}`,{signal,cache:"no-store"});
  if(!response.ok)throw new Error("Dokumenty se nepodařilo načíst");
  return response.json() as Promise<DocumentListResponse>;
}

function mergePreview(response:DocumentListResponse,filters:DocumentFilters):DocumentListResponse{
  if(typeof window==="undefined"||response.source!=="preview-adapter")return response;
  const edits=previewEdits();
  const base=response.documents.map(document=>applyEdit(document,edits[document.id]));
  const created=previewCreated().map(document=>applyEdit(document,edits[document.id])).filter(document=>matches(document,filters));
  return{...response,documents:[...created,...base].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))};
}
function applyEdit(document:DocumentRecord,edit:Partial<DocumentRecord>|undefined):DocumentRecord{
  if(!edit)return document;
  return{...document,...edit,versions:[...(edit.versions??[]),...(document.versions??[])],events:[...(edit.events??[]),...(document.events??[])]};
}
function matches(document:DocumentRecord,filters:DocumentFilters){const q=(filters.query??"").toLowerCase();return(!q||`${document.name} ${document.typeName} ${document.projectName} ${document.units.join(" ")} ${document.parties.join(" ")}`.toLowerCase().includes(q))&&(!filters.projectId||document.projectId===filters.projectId)&&(!filters.unitId||document.units.includes(filters.unitId))&&(!filters.partyId||document.parties.includes(filters.partyId))&&(!filters.contractId||document.contracts.includes(filters.contractId))&&(!filters.category||document.category===filters.category)&&(!filters.typeCode||document.typeCode===filters.typeCode)&&(!filters.status||document.status===filters.status);}
function previewCreated():DocumentRecord[]{if(typeof window==="undefined")return[];try{return JSON.parse(localStorage.getItem("develocrm.documents.created")||"[]");}catch{return[];}}
function previewEdits():Record<string,Partial<DocumentRecord>>{if(typeof window==="undefined")return{};try{return JSON.parse(localStorage.getItem("develocrm.documents.edits")||"{}");}catch{return{};}}
function categoryForType(type:string):DocumentCategory{return["reservation_contract","future_purchase_contract","purchase_contract","amendment"].includes(type)?"contract":type==="client_change"?"client_document":type==="handover_protocol"||type==="photo_documentation"?"project_documentation":"other";}
async function responseError(response:Response,fallback:string){const payload=await response.json().catch(()=>({})) as {error?:string};return new Error(payload.error??fallback);}

export function mediaDocument(media:MediaLink):DocumentRecord{return{
  id:`media:${media.id}`,projectId:"",projectName:"",name:media.fileName,category:"floor_plan",typeCode:"floor_plan",typeName:"Půdorys",status:"ready",note:"Existující preview médium jednotky.",mimeType:media.mimeType,fileSize:null,
  storageProvider:"preview_media",webUrl:media.url,etag:null,sensitivity:"normal",createdAt:"",updatedAt:"",author:"Preview media",version:"aktuální",units:[media.entityId],parties:[],contracts:[],salesCases:[],versions:[],events:[],
};}

export const previewConnection:DocumentConnectionState={status:"not_configured",syncStatus:"idle",lastSuccessfulSyncAt:null};
export const documentRepository:DocumentRepository=new ApiDocumentRepository();

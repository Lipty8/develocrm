import type { MediaLink } from "./media-repository";
import { mediaRepository } from "./media-repository";

export type DocumentCategory = "contract" | "floor_plan" | "project_documentation" | "client_document" | "price_document" | "reservation" | "other";
export type DocumentConnectionState = { status:"not_configured"|"connected"|"error"|"disabled";syncStatus:"idle"|"syncing"|"error"|"paused";lastSuccessfulSyncAt:string|null };
export type DocumentRecord = {
  id:string;projectId:string;projectName:string;name:string;category:DocumentCategory;mimeType:string;fileSize:number|null;
  storageProvider:"sharepoint"|"preview"|"external"|"preview_media";webUrl:string|null;etag:string|null;sensitivity:"normal"|"sensitive";
  updatedAt:string;author:string|null;version:string|null;units:string[];parties:string[];contracts:string[];
};
export type DocumentListResponse={documents:DocumentRecord[];connection:DocumentConnectionState;source:"backend-api"|"preview-adapter"};

export interface DocumentRepository {
  listProject(projectId:string,filters?:{category?:string;unitId?:string;partyId?:string},signal?:AbortSignal):Promise<DocumentListResponse>;
  listUnit(unitId:string,filters?:{category?:string},signal?:AbortSignal):Promise<DocumentListResponse>;
  connection(signal?:AbortSignal):Promise<DocumentConnectionState>;
}

class ApiDocumentRepository implements DocumentRepository {
  async listProject(projectId:string,filters:Record<string,string|undefined>={},signal?:AbortSignal){
    return requestDocuments({projectId,...filters},signal);
  }
  async listUnit(unitId:string,filters:Record<string,string|undefined>={},signal?:AbortSignal){
    const response=await requestDocuments({unitId,...filters},signal);
    const media=await mediaRepository.get("unit",unitId,signal).catch(()=>null);
    if(media&&!response.documents.some(document=>document.category==="floor_plan"))response.documents.unshift(mediaDocument(media));
    return response;
  }
  async connection(signal?:AbortSignal){
    const response=await fetch("/api/documents?connection=sharepoint",{signal,cache:"no-store"});
    if(!response.ok)return previewConnection;
    return ((await response.json()) as {connection:DocumentConnectionState}).connection;
  }
}

async function requestDocuments(params:Record<string,string|undefined>,signal?:AbortSignal):Promise<DocumentListResponse>{
  const search=new URLSearchParams();for(const [key,value] of Object.entries(params))if(value)search.set(key,value);
  const response=await fetch(`/api/documents?${search}`,{signal,cache:"no-store"});
  if(!response.ok)throw new Error("Dokumenty se nepodařilo načíst");
  return response.json() as Promise<DocumentListResponse>;
}

export function mediaDocument(media:MediaLink):DocumentRecord{return{
  id:`media:${media.id}`,projectId:"",projectName:"",name:media.fileName,category:"floor_plan",mimeType:media.mimeType,fileSize:null,
  storageProvider:"preview_media",webUrl:media.url,etag:null,sensitivity:"normal",updatedAt:"",author:"Preview media",version:"aktuální",units:[media.entityId],parties:[],contracts:[],
};}

export const previewConnection:DocumentConnectionState={status:"not_configured",syncStatus:"idle",lastSuccessfulSyncAt:null};
export const documentRepository:DocumentRepository=new ApiDocumentRepository();

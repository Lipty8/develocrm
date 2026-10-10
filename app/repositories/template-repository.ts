import {apiFetch} from "../lib/api-client";

export type TemplateLifecycle="draft"|"validated"|"approved"|"retired";
export type TemplateValidation={valid:boolean;tokens:string[];unknownTokens:string[];missingTokens:string[];malformedTokens:string[];legacyMarkers:string[];errors:string[]};
export type TemplateVersion={id:string;versionLabel:string;contentHash:string;status:TemplateLifecycle;effectiveFrom:string;validation:TemplateValidation;createdAt:string;
  validatedAt:string|null;approvedAt:string|null;retiredAt:string|null;actor:string|null;sourceWebUrl:string|null;sourceFileName:string};
export type DocumentTemplate={id:string;projectId:string;projectName:string;code:string;name:string;outputTypeCode:string;contractType:string|null;variantKey:string;status:string;canManage:boolean;canApprove:boolean;versions:TemplateVersion[]};
export type TemplateUploadInput={projectId:string;code:string;name:string;outputTypeCode:string;variantKey:string;versionLabel:string;effectiveFrom:string;file:File};

class TemplateRepository{
  async list(filters:{projectId?:string;outputTypeCode?:string}={},signal?:AbortSignal):Promise<DocumentTemplate[]>{const params=new URLSearchParams();for(const[key,value]of Object.entries(filters))if(value)params.set(key,value);
    const response=await apiFetch(`/api/document-templates?${params}`,{signal,cache:"no-store"});if(!response.ok)throw await error(response,"Šablony se nepodařilo načíst");return((await response.json())as{templates:DocumentTemplate[]}).templates;}
  async upload(input:TemplateUploadInput){const contentBase64=await base64(input.file);const{file,...metadata}=input;const response=await apiFetch("/api/document-templates?action=upload",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...metadata,fileName:file.name,mimeType:file.type||"application/vnd.openxmlformats-officedocument.wordprocessingml.document",contentBase64})});
    if(!response.ok)throw await error(response,"Novou verzi šablony se nepodařilo nahrát");return response.json() as Promise<{version:{templateId:string;templateVersionId:string;validation:TemplateValidation}}>;}
  async action(templateId:string,versionId:string,action:"validate"|"approve"|"retire"){const response=await apiFetch(`/api/document-templates?action=${action}&templateId=${encodeURIComponent(templateId)}&versionId=${encodeURIComponent(versionId)}`,{method:"POST"});if(!response.ok)throw await error(response,"Změnu šablony se nepodařilo dokončit");return response.json();}
  async download(templateId:string,versionId:string,action:"preview"|"source",fileName:string){const response=await apiFetch(`/api/document-templates?action=${action}&templateId=${encodeURIComponent(templateId)}&versionId=${encodeURIComponent(versionId)}`,{cache:"no-store"});if(!response.ok)throw await error(response,"Soubor šablony se nepodařilo stáhnout");
    const url=URL.createObjectURL(await response.blob());const link=document.createElement("a");link.href=url;link.download=fileName;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
}
async function base64(file:File):Promise<string>{const bytes=new Uint8Array(await file.arrayBuffer());let binary="";const chunk=0x8000;for(let index=0;index<bytes.length;index+=chunk)binary+=String.fromCharCode(...bytes.subarray(index,index+chunk));return btoa(binary);}
async function error(response:Response,fallback:string){const payload=await response.json().catch(()=>({})) as{error?:string;details?:string[];correlationId?:string};const suffix=payload.correlationId?` (${payload.correlationId})`:"";return new Error(`${payload.error??fallback}${suffix}`);}
export const templateRepository=new TemplateRepository();

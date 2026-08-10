import {apiFetch} from "../lib/api-client";

export type ClientChangeRecord={id:string;projectId:string;projectName:string;unitId:string;unitCode:string;partyId:string;partyName:string;salesCaseId:string|null;title:string;description:string|null;sourceType:"individual"|"catalog";catalogItemCode:string|null;category:string;status:string;surchargeAmount:number|null;currency:string;requestedAt:string;dueAt:string|null;createdAt:string;updatedAt:string};
export type NewClientChangeInput={projectId:string;unitId:string;partyId:string;title:string;description?:string;sourceType:"individual"|"catalog";catalogItemCode?:string;category:string;surchargeAmount?:number|null;currency?:string;requestedAt:string;dueAt?:string|null};

async function payload(response:Response){const value=await response.json().catch(()=>({})) as {error?:string;correlationId?:string};if(!response.ok)throw new Error(`${value.error??"Operace klientské změny selhala"}${value.correlationId?` · ID chyby ${value.correlationId}`:""}`);return value;}
export const clientChangeRepository={
 async list(filters:{projectId?:string;unitId?:string},signal?:AbortSignal){const query=new URLSearchParams();if(filters.projectId)query.set("projectId",filters.projectId);if(filters.unitId)query.set("unitId",filters.unitId);const response=await apiFetch(`/api/client-changes?${query}`,{signal,cache:"no-store"});const value=await payload(response) as {clientChanges?:ClientChangeRecord[]};return value.clientChanges??[];},
 async create(input:NewClientChangeInput){const response=await apiFetch("/api/client-changes",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(input)});return await payload(response) as ClientChangeRecord;},
 async archive(id:string,reason:string){const response=await apiFetch(`/api/client-changes/${encodeURIComponent(id)}/archive`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({reason})});return payload(response);},
};

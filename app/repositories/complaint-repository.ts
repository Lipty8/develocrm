import {apiFetch} from "../lib/api-client";

export type ComplaintRecord={id:string;projectId:string;projectName:string;unitId:string;unitCode:string;partyId:string;partyName:string;assigneeMembershipId:string|null;assigneeName:string|null;title:string;description:string;status:"new"|"in_progress"|"resolved";dueAt:string|null;createdAt:string;updatedAt:string;history:Array<{id:string;fromStatus:string|null;toStatus:string;note:string|null;actor:string;occurredAt:string}>};
export type NewComplaintInput={projectId:string;unitId:string;partyId:string;title:string;description:string;assigneeMembershipId?:string|null;dueAt?:string|null;idempotencyKey:string};
async function payload(response:Response){const value=await response.json().catch(()=>({})) as {error?:string;correlationId?:string};if(!response.ok)throw new Error(`${value.error??"Operace reklamace selhala"}${value.correlationId?` · ID chyby ${value.correlationId}`:""}`);return value;}
export const complaintRepository={
  async list(filters:{projectId?:string;unitId?:string},signal?:AbortSignal){const query=new URLSearchParams();if(filters.projectId)query.set("projectId",filters.projectId);if(filters.unitId)query.set("unitId",filters.unitId);const response=await apiFetch(`/api/complaints?${query}`,{signal,cache:"no-store"});const value=await payload(response) as {complaints?:ComplaintRecord[]};return value.complaints??[];},
  async create(input:NewComplaintInput){return await payload(await apiFetch("/api/complaints",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(input)})) as ComplaintRecord;},
  async transition(id:string,input:{status:ComplaintRecord["status"];note?:string;assigneeMembershipId?:string|null;dueAt?:string|null;idempotencyKey:string}){return await payload(await apiFetch(`/api/complaints/${encodeURIComponent(id)}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify(input)})) as ComplaintRecord;},
};

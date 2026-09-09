import {addCalendarDays} from "../lib/date-time";
import {units} from "../crm-data";
import { responseAllowsBrowserFallback } from "../lib/data-mode";
import { apiFetch } from "../lib/api-client";
export type HandoverHistoryEvent={id:string;type:"planned"|"rescheduled"|"handed_over"|"cancelled";occurredAt:string;previousScheduledAt:string|null;scheduledAt:string|null;actor:string|null};
export type HandoverRecord={id:string;projectId:string;project:string;unitId:string;unit:string;scheduledAt:string;client:string;owner:string;salesCaseId:string|null;status:"planned"|"handed_over"|"cancelled";readiness:number;attention:string|null;place:string|null;note:string|null;completedAt:string|null;participants:Array<{partyId:string;name:string;role:string}>;history:HandoverHistoryEvent[]};
export type HandoverScheduleInput={unitId:string;scheduledAt:string;responsibleMembershipId:string;place?:string|null;note?:string|null;idempotencyKey:string};
export type HandoverUpdateInput={handoverId:string;scheduledAt:string;responsibleMembershipId:string;status:string;readiness:number;attention?:string|null;place?:string|null;note?:string|null;completedAt?:string|null};
export interface HandoverRepository{
  list(input:{projectId?:string;unitId?:string;status?:string;owner?:string;query?:string;sort?:string;direction?:"asc"|"desc"},signal?:AbortSignal):Promise<HandoverRecord[]>;
  schedule(input:HandoverScheduleInput):Promise<{id:string}>;
  update(input:HandoverUpdateInput):Promise<{id:string}>;
}
class ApiHandoverRepository implements HandoverRepository{
  async list(input:{projectId?:string;unitId?:string;status?:string;owner?:string;query?:string;sort?:string;direction?:"asc"|"desc"},signal?:AbortSignal){
    const query=new URLSearchParams();if(input.projectId)query.set("projectId",input.projectId);if(input.unitId)query.set("unitId",input.unitId);if(input.status)query.set("status",input.status);if(input.owner)query.set("ownerId",input.owner);if(input.query)query.set("query",input.query);if(input.sort)query.set("sort",input.sort);if(input.direction)query.set("direction",input.direction);
    const response=await apiFetch(`/api/handovers?${query}`,{signal,cache:"no-store"});
    if(response.ok)return (await response.json() as {handovers:HandoverRecord[]}).handovers;
    if(!(response.status===503&&responseAllowsBrowserFallback(response)))throw new Error((await response.json().catch(()=>({} as {error?:string}))).error??"Předání nelze načíst");
    return previewHandovers();
  }
  async schedule(input:HandoverScheduleInput){
    const response=await apiFetch("/api/handovers",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(input)});
    if(response.ok)return response.json() as Promise<{id:string}>;
    const payload=await response.json().catch(()=>({})) as {error?:string};
    const correlationId=response.headers.get("x-correlation-id")||(payload as {correlationId?:string}).correlationId;
    throw new Error(`${payload.error??"Předání se nepodařilo naplánovat."}${correlationId?` · ID chyby ${correlationId}`:""}`);
  }
  async update(input:HandoverUpdateInput){
    const {handoverId,...body}=input;const response=await apiFetch(`/api/handovers/${encodeURIComponent(handoverId)}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
    if(response.ok)return response.json() as Promise<{id:string}>;
    const payload=await response.json().catch(()=>({})) as {error?:string;correlationId?:string};const correlationId=response.headers.get("x-correlation-id")||payload.correlationId;
    throw new Error(`${payload.error??"Předání se nepodařilo upravit."}${correlationId?` · ID chyby ${correlationId}`:""}`);
  }
}
function previewHandovers():HandoverRecord[]{
  const candidates=units.filter(unit=>unit.client).slice(0,7);const offsets=[0,1,1,3,5,8,12];const times=[[9,0],[10,30],[14,0],[13,30],[9,30],[15,0],[11,0]];
  return candidates.map((unit,index)=>{const date=addCalendarDays(new Date(),offsets[index]);date.setHours(times[index][0],times[index][1],0,0);const scheduledAt=date.toISOString();return{id:`preview-handover-${unit.id}`,projectId:unit.project,project:unit.project,unitId:unit.backendId??unit.id,unit:unit.id,scheduledAt,client:unit.client??"Bez klienta",owner:index%2?"Martin Jelínek":"Iva Novotná",salesCaseId:null,status:"planned",readiness:index===0?100:Math.max(65,96-index*4),attention:unit.attention??(index===2?"Chybí potvrzení klienta":null),place:null,note:null,completedAt:null,participants:[],history:[{id:`preview-handover-event-${unit.id}`,type:"planned",occurredAt:new Date(date.getTime()-86_400_000).toISOString(),previousScheduledAt:null,scheduledAt,actor:index%2?"Martin Jelínek":"Iva Novotná"}]};});
}
export const handoverRepository:HandoverRepository=new ApiHandoverRepository();

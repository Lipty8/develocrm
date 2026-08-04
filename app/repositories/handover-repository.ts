import {addCalendarDays} from "../lib/date-time";
import {units} from "../crm-data";
import { responseAllowsBrowserFallback } from "../lib/data-mode";
import { apiFetch } from "../lib/api-client";
export type HandoverRecord={id:string;projectId:string;project:string;unitId:string;unit:string;scheduledAt:string;client:string;owner:string;status:string;readiness:number;attention:string|null};
export interface HandoverRepository{
  list(input:{project?:string;status?:string;owner?:string;query?:string;sort?:string;direction?:"asc"|"desc"},signal?:AbortSignal):Promise<HandoverRecord[]>;
  schedule(input:{unitId:string;scheduledAt:string;responsibleMembershipId:string}):Promise<{id:string}>;
}
class ApiHandoverRepository implements HandoverRepository{
  async list(input:{project?:string;status?:string;owner?:string;query?:string;sort?:string;direction?:"asc"|"desc"},signal?:AbortSignal){
    const query=new URLSearchParams();if(input.project)query.set("projectId",input.project);if(input.status)query.set("status",input.status);if(input.owner)query.set("ownerId",input.owner);if(input.query)query.set("query",input.query);if(input.sort)query.set("sort",input.sort);if(input.direction)query.set("direction",input.direction);
    const response=await apiFetch(`/api/handovers?${query}`,{signal,cache:"no-store"});
    if(response.ok)return (await response.json() as {handovers:HandoverRecord[]}).handovers;
    if(!(response.status===503&&responseAllowsBrowserFallback(response)))throw new Error((await response.json().catch(()=>({} as {error?:string}))).error??"Předání nelze načíst");
    return previewHandovers();
  }
  async schedule(input:{unitId:string;scheduledAt:string;responsibleMembershipId:string}){
    const response=await apiFetch("/api/handovers",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(input)});
    if(response.ok)return response.json() as Promise<{id:string}>;
    const payload=await response.json().catch(()=>({})) as {error?:string};
    throw new Error(payload.error??"Předání nelze naplánovat");
  }
}
function previewHandovers():HandoverRecord[]{
  const candidates=units.filter(unit=>unit.client).slice(0,7);const offsets=[0,1,1,3,5,8,12];const times=[[9,0],[10,30],[14,0],[13,30],[9,30],[15,0],[11,0]];
  return candidates.map((unit,index)=>{const date=addCalendarDays(new Date(),offsets[index]);date.setHours(times[index][0],times[index][1],0,0);return{id:`preview-handover-${unit.id}`,projectId:unit.project,project:unit.project,unitId:unit.backendId??unit.id,unit:unit.id,scheduledAt:date.toISOString(),client:unit.client??"Bez klienta",owner:index%2?"Martin Jelínek":"Iva Novotná",status:index===0?"ready":index===1?"in_progress":"planned",readiness:index===0?100:Math.max(65,96-index*4),attention:unit.attention??(index===2?"Chybí potvrzení klienta":null)};});
}
export const handoverRepository:HandoverRepository=new ApiHandoverRepository();

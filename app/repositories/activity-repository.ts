import { unitTimeline } from "../crm-data";
import { clientUsesBrowserAdapter, responseAllowsBrowserFallback } from "../lib/data-mode";
import { apiFetch } from "../lib/api-client";
import {readError} from '../lib/read-state';
export type TimelineRecord={id:string;date:string;title:string;detail:string;icon:string;action:string};
const key="develocrm.preview.audit";
export function recordPreviewActivity(input:{unitKey:string;title:string;detail:string;icon?:string;action:string}){if(typeof window==="undefined")return;const rows=JSON.parse(localStorage.getItem(key)||"[]") as Array<TimelineRecord&{unitKey:string;timestamp:string}>;rows.unshift({id:crypto.randomUUID(),unitKey:input.unitKey,timestamp:new Date().toISOString(),date:new Date().toISOString(),title:input.title,detail:input.detail,icon:input.icon??"history",action:input.action});localStorage.setItem(key,JSON.stringify(rows.slice(0,300)));}
export const activityRepository={
 async workspaceTimeline(signal?:AbortSignal):Promise<TimelineRecord[]>{const response=await apiFetch('/api/activity',{signal,cache:'no-store'});if(!response.ok)throw readError(response);return (await response.json() as {events:TimelineRecord[]}).events;},
 async unitTimeline(unitId:string,unitKey:string,signal?:AbortSignal):Promise<TimelineRecord[]>{const response=await apiFetch(`/api/activity/units/${encodeURIComponent(unitId)}`,{signal,cache:"no-store"});if(!response.ok&&!responseAllowsBrowserFallback(response))throw readError(response);const payload=response.ok?await response.json() as {events?:TimelineRecord[]}:{};const browser=clientUsesBrowserAdapter();const local=!browser||typeof window==="undefined"?[]:(JSON.parse(localStorage.getItem(key)||"[]") as Array<TimelineRecord&{unitKey:string;timestamp:string}>).filter(row=>row.unitKey===unitKey).map(row=>({...row,date:row.timestamp}));const seed=browser&&!(payload.events?.length)?unitTimeline.map((item,index)=>({id:`seed-${unitKey}-${index}`,...item,action:`seed.${item.icon}`})):[];return[...local,...(payload.events??[]),...seed].slice(0,100);},
 async projectTimeline(projectId:string,signal?:AbortSignal):Promise<TimelineRecord[]>{const response=await apiFetch(`/api/activity/projects/${encodeURIComponent(projectId)}`,{signal,cache:"no-store"});if(!response.ok)throw new Error("Historii projektu nelze načíst");return (await response.json() as {events:TimelineRecord[]}).events;}
};

import type { Database } from "../database.js";

export type TimelineItem={id:string;date:string;title:string;detail:string;icon:string;action:string};
export class ActivityRepository{
 constructor(private readonly database:Database){}
 async unitTimeline(input:{tenantId:string;userId:string;membershipId:string;unitId:string}){return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>{
  const result=await client.query<{id:string;occurred_at:string;action:string;before_data:Record<string,unknown>|null;after_data:Record<string,unknown>|null;actor:string|null}>(
   `SELECT audit.id,audit.occurred_at::text,audit.action,audit.before_data,audit.after_data,actor.display_name actor
    FROM audit_log audit LEFT JOIN users actor ON actor.id=audit.actor_user_id
    JOIN units unit ON unit.tenant_id=audit.tenant_id AND unit.id=$2
    WHERE audit.tenant_id=$1 AND app.has_project_permission(unit.tenant_id,$3,unit.project_id,'unit.read')
      AND (audit.entity_id=unit.id OR audit.after_data->>'unitId'=unit.id::text OR audit.metadata->>'unitId'=unit.id::text)
    ORDER BY audit.occurred_at DESC,audit.id DESC LIMIT 100`,[input.tenantId,input.unitId,input.membershipId]);
  return result.rows.map(row=>mapTimeline(row));
 });}
 async projectTimeline(input:{tenantId:string;userId:string;membershipId:string;projectId:string}){return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>{
  const result=await client.query<{id:string;occurred_at:string;action:string;before_data:Record<string,unknown>|null;after_data:Record<string,unknown>|null;actor:string|null}>(
   `SELECT audit.id,audit.occurred_at::text,audit.action,audit.before_data,audit.after_data,actor.display_name actor
    FROM audit_log audit LEFT JOIN users actor ON actor.id=audit.actor_user_id
    WHERE audit.tenant_id=$1 AND app.has_project_permission($1,$3,$2,'projects.read')
      AND (audit.entity_id=$2 OR audit.after_data->>'projectId'=$2::text OR audit.metadata->>'projectId'=$2::text
        OR audit.entity_id IN (SELECT id FROM units WHERE tenant_id=$1 AND project_id=$2))
    ORDER BY audit.occurred_at DESC,audit.id DESC LIMIT 50`,[input.tenantId,input.projectId,input.membershipId]);
  return result.rows.map(row=>mapTimeline(row));
 });}
}
function mapTimeline(row:{id:string;occurred_at:string;action:string;before_data:Record<string,unknown>|null;after_data:Record<string,unknown>|null;actor:string|null}):TimelineItem{const labels:Record<string,[string,string]>={"unit.updated":["Upraveny údaje jednotky","history"],"unit.floorplan_changed":["Změněn půdorys jednotky","document"],"unit.commercial_status_changed":["Změněn obchodní stav","contract"],"unit.interest_recorded":["Zaznamenán zájem o jednotku","history"],"unit.price_recorded":["Zaznamenána nová cena","price"],"accessory.assigned":["Přiřazeno příslušenství","history"],"accessory.removed":["Uvolněno příslušenství","history"]};const [title,icon]=labels[row.action]??[row.action.replaceAll("."," "),"history"];return{id:row.id,date:row.occurred_at,title,detail:`${row.actor??"Systém"} · auditní událost`,icon,action:row.action};}

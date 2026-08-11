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
      AND (
        audit.entity_id=unit.id OR audit.after_data->>'unitId'=unit.id::text OR audit.metadata->>'unitId'=unit.id::text
        OR (audit.entity_type='unit_interest' AND EXISTS(SELECT 1 FROM unit_interests interest WHERE interest.tenant_id=audit.tenant_id AND interest.id=audit.entity_id AND interest.unit_id=unit.id))
        OR (audit.entity_type='unit_hold' AND EXISTS(SELECT 1 FROM unit_holds hold WHERE hold.tenant_id=audit.tenant_id AND hold.id=audit.entity_id AND hold.unit_id=unit.id))
        OR (audit.entity_type='contract' AND EXISTS(SELECT 1 FROM contracts contract WHERE contract.tenant_id=audit.tenant_id AND contract.id=audit.entity_id AND contract.unit_id=unit.id))
        OR (audit.entity_type='contract_version' AND EXISTS(SELECT 1 FROM contract_versions version JOIN contracts contract ON contract.tenant_id=version.tenant_id AND contract.id=version.contract_id WHERE version.tenant_id=audit.tenant_id AND version.id=audit.entity_id AND contract.unit_id=unit.id))
        OR (audit.entity_type='payment_obligation' AND EXISTS(SELECT 1 FROM payment_obligations obligation WHERE obligation.tenant_id=audit.tenant_id AND obligation.id=audit.entity_id AND obligation.unit_id=unit.id))
        OR (audit.entity_type='payment_transaction' AND EXISTS(SELECT 1 FROM payment_allocations allocation JOIN payment_obligations obligation ON obligation.tenant_id=allocation.tenant_id AND obligation.id=allocation.obligation_id WHERE allocation.tenant_id=audit.tenant_id AND allocation.transaction_id=audit.entity_id AND obligation.unit_id=unit.id))
        OR (audit.entity_type='task' AND EXISTS(SELECT 1 FROM tasks task WHERE task.tenant_id=audit.tenant_id AND task.id=audit.entity_id AND task.unit_id=unit.id))
        OR (audit.entity_type='client_change' AND EXISTS(SELECT 1 FROM client_changes change WHERE change.tenant_id=audit.tenant_id AND change.id=audit.entity_id AND change.unit_id=unit.id))
        OR (audit.entity_type='unit_handover' AND EXISTS(SELECT 1 FROM unit_handovers handover WHERE handover.tenant_id=audit.tenant_id AND handover.id=audit.entity_id AND handover.unit_id=unit.id))
      )
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
function mapTimeline(row:{id:string;occurred_at:string;action:string;before_data:Record<string,unknown>|null;after_data:Record<string,unknown>|null;actor:string|null}):TimelineItem{const labels:Record<string,[string,string]>={
 "unit.updated":["Upraveny údaje jednotky","history"],"unit.floorplan_changed":["Změněn půdorys jednotky","document"],"unit.commercial_status_changed":["Změněn obchodní stav","contract"],
 "unit.interest_recorded":["Zaznamenán zájem o jednotku","history"],"hold.created":["Vytvořena předrezervace nebo rezervace","contract"],"hold.converted":["Předrezervace převedena na rezervaci","contract"],"hold.cancelled":["Rezervace byla zrušena","contract"],
 "hold.created_by_rs_signature":["Podpisem RS vznikla rezervace","contract"],"hold.converted_by_rs_signature":["Podpisem RS byla potvrzena rezervace","contract"],"rs.signature_reservation_activated":["Obchodní proces přešel do rezervace","contract"],
 "contract.created":["Vytvořena smlouva","contract"],"contract.version_created":["Vytvořena nová verze smlouvy","document"],"contract.status_changed":["Změněn stav smlouvy","contract"],"contract.party_signed":["Zaznamenán podpis smlouvy","contract"],"contract.signed":["Smlouva byla podepsána","contract"],
 "payment.obligation_created":["Vznikla platební povinnost","payment"],"payment.recorded":["Zaznamenána úhrada","payment"],"payment.reversed":["Úhrada byla stornována","payment"],
 "task.created":["Vytvořen úkol","history"],"task.completed":["Úkol byl dokončen","history"],"task.reopened":["Úkol byl znovu otevřen","history"],"task.archived":["Úkol byl archivován","history"],
 "client_change.created":["Založena klientská změna","history"],"client_change.archived":["Klientská změna byla archivována","history"],
 "handover.scheduled":["Naplánováno předání jednotky","history"],"handover.updated":["Upraveno předání jednotky","history"],
 "unit.price_recorded":["Zaznamenána nová cena","price"],"unit.price_proposed":["Navržena změna ceny","price"],"unit.price_proposal_decided":["Rozhodnuto o změně ceny","price"],
 "accessory.assigned":["Přiřazeno příslušenství","history"],"accessory.removed":["Uvolněno příslušenství","history"]};
 const [title,icon]=labels[row.action]??["Aktualizovány související údaje","history"];
 const amount=typeof row.after_data?.amount==="number"?` · ${new Intl.NumberFormat("cs-CZ",{style:"currency",currency:"CZK",maximumFractionDigits:0}).format(row.after_data.amount)}`:"";
 return{id:row.id,date:row.occurred_at,title,detail:`${row.actor??"Systém"}${amount}`,icon,action:row.action};}

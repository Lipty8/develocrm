import type {Database} from "../database.js";
type Context={tenantId:string;userId:string;membershipId:string};
export type HandoverItem={id:string;projectId:string;project:string;unitId:string;unit:string;scheduledAt:string;client:string;owner:string;salesCaseId:string|null;status:string;readiness:number;attention:string|null;place:string|null;note:string|null;completedAt:string|null;participants:Array<{partyId:string;name:string;role:string}>;history:Array<{id:string;type:string;occurredAt:string;previousScheduledAt:string|null;scheduledAt:string|null;actor:string|null}>};
export class HandoverRepository{
  constructor(private readonly database:Database){}
  list(input:Context&{projectId?:string;unitId?:string;status?:string;ownerId?:string;query?:string;sort?:string;direction?:"asc"|"desc"}){
    return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>{
      const direction=input.direction==="desc"?"DESC":"ASC";
      const sort=({project:"project.name",unit:"unit.code",status:"handover.status",owner:"owner.display_name"} as Record<string,string>)[input.sort??""]??"handover.scheduled_at";
      const result=await client.query<HandoverItem>(`SELECT handover.id,handover.project_id "projectId",project.name project,handover.unit_id "unitId",unit.code unit,
        handover.scheduled_at "scheduledAt",COALESCE(buyers.names,'Bez přiřazeného klienta') client,owner.display_name owner,
        handover.sales_case_id "salesCaseId",handover.status,handover.readiness_percent readiness,handover.attention,
        handover.place,handover.note,handover.completed_at "completedAt",COALESCE(participants.items,'[]'::jsonb) participants,
        COALESCE(history.items,'[]'::jsonb) history
       FROM unit_handovers handover JOIN projects project ON project.tenant_id=handover.tenant_id AND project.id=handover.project_id
       JOIN units unit ON unit.tenant_id=handover.tenant_id AND unit.id=handover.unit_id
       JOIN tenant_memberships owner_membership ON owner_membership.tenant_id=handover.tenant_id AND owner_membership.id=handover.responsible_membership_id
       JOIN users owner ON owner.id=owner_membership.user_id
       LEFT JOIN LATERAL(SELECT string_agg(DISTINCT party.display_name,' a ' ORDER BY party.display_name) names FROM sales_cases sales_case
         JOIN sales_case_parties participant ON participant.tenant_id=sales_case.tenant_id AND participant.sales_case_id=sales_case.id AND participant.participant_role IN ('buyer','co_buyer')
         JOIN parties party ON party.tenant_id=participant.tenant_id AND party.id=participant.party_id
         WHERE sales_case.tenant_id=handover.tenant_id AND sales_case.unit_id=handover.unit_id AND sales_case.status='active') buyers ON true
       LEFT JOIN LATERAL(SELECT jsonb_agg(jsonb_build_object('partyId',participant.party_id,'name',party.display_name,'role',participant.participant_role) ORDER BY party.display_name) items
         FROM unit_handover_participants participant JOIN parties party ON party.tenant_id=participant.tenant_id AND party.id=participant.party_id
         WHERE participant.tenant_id=handover.tenant_id AND participant.handover_id=handover.id) participants ON true
       LEFT JOIN LATERAL(SELECT jsonb_agg(jsonb_build_object('id',event.id,'type',event.event_type,'occurredAt',event.recorded_at,
         'previousScheduledAt',event.previous_scheduled_at,'scheduledAt',event.scheduled_at,'actor',actor.display_name) ORDER BY event.recorded_at DESC,event.id DESC) items
         FROM unit_handover_events event
         LEFT JOIN tenant_memberships actor_membership ON actor_membership.tenant_id=event.tenant_id AND actor_membership.id=event.recorded_by_membership_id
         LEFT JOIN users actor ON actor.id=actor_membership.user_id
         WHERE event.tenant_id=handover.tenant_id AND event.handover_id=handover.id) history ON true
       WHERE handover.tenant_id=$1 AND project.archived_at IS NULL AND unit.archived_at IS NULL
         AND app.has_project_permission(handover.tenant_id,$2,handover.project_id,'handovers.read')
         AND ($3::uuid IS NULL OR handover.project_id=$3) AND ($4::uuid IS NULL OR handover.unit_id=$4) AND ($5::text IS NULL OR handover.status=$5)
         AND ($6::uuid IS NULL OR handover.responsible_membership_id=$6)
         AND ($7::text IS NULL OR unit.code ILIKE '%'||$7||'%' OR COALESCE(buyers.names,'') ILIKE '%'||$7||'%')
       ORDER BY ${sort} ${direction},handover.id ASC`,[input.tenantId,input.membershipId,input.projectId??null,input.unitId??null,input.status??null,input.ownerId??null,input.query??null]);
      return result.rows;
    });
  }
  schedule(input:Context&{unitId:string;scheduledAt:string;responsibleMembershipId:string;place?:string|null;note?:string|null;idempotencyKey:string}){
    return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>(await client.query<{id:string}>("SELECT app.schedule_unit_handover_v2($1,$2,$3,$4,$5,$6,$7,$8) id",[input.tenantId,input.unitId,input.scheduledAt,input.responsibleMembershipId,input.place??null,input.note??null,input.idempotencyKey,input.membershipId])).rows[0]);
  }
  update(input:Context&{handoverId:string;scheduledAt:string;responsibleMembershipId:string;status:string;readiness:number;attention?:string|null;place?:string|null;note?:string|null;completedAt?:string|null}){
    return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>(await client.query<{id:string}>("SELECT app.update_unit_handover_v2($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) id",[input.tenantId,input.handoverId,input.scheduledAt,input.responsibleMembershipId,input.status,input.readiness,input.attention??null,input.place??null,input.note??null,input.completedAt??null,input.membershipId])).rows[0]);
  }
}

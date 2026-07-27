import type {Database} from "../database.js";
type Context={tenantId:string;userId:string;membershipId:string};
export type HandoverItem={id:string;projectId:string;project:string;unitId:string;unit:string;scheduledAt:string;client:string;owner:string;status:string;readiness:number;attention:string|null};
export class HandoverRepository{
  constructor(private readonly database:Database){}
  list(input:Context&{projectId?:string;status?:string;ownerId?:string;query?:string;sort?:string;direction?:"asc"|"desc"}){
    return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>{
      const direction=input.direction==="desc"?"DESC":"ASC";
      const sort=({project:"project.name",unit:"unit.code",status:"handover.status",owner:"owner.display_name"} as Record<string,string>)[input.sort??""]??"handover.scheduled_at";
      const result=await client.query<HandoverItem>(`SELECT handover.id,handover.project_id "projectId",project.name project,handover.unit_id "unitId",unit.code unit,
        handover.scheduled_at "scheduledAt",COALESCE(buyers.names,'Bez přiřazeného klienta') client,owner.display_name owner,
        handover.status,handover.readiness_percent readiness,handover.attention
       FROM unit_handovers handover JOIN projects project ON project.tenant_id=handover.tenant_id AND project.id=handover.project_id
       JOIN units unit ON unit.tenant_id=handover.tenant_id AND unit.id=handover.unit_id
       JOIN tenant_memberships owner_membership ON owner_membership.tenant_id=handover.tenant_id AND owner_membership.id=handover.responsible_membership_id
       JOIN users owner ON owner.id=owner_membership.user_id
       LEFT JOIN LATERAL(SELECT string_agg(DISTINCT party.display_name,' a ' ORDER BY party.display_name) names FROM sales_cases sales_case
         JOIN sales_case_parties participant ON participant.tenant_id=sales_case.tenant_id AND participant.sales_case_id=sales_case.id AND participant.role IN ('buyer','co_buyer')
         JOIN parties party ON party.tenant_id=participant.tenant_id AND party.id=participant.party_id
         WHERE sales_case.tenant_id=handover.tenant_id AND sales_case.unit_id=handover.unit_id AND sales_case.status='active') buyers ON true
       WHERE handover.tenant_id=$1 AND app.has_project_permission(handover.tenant_id,$2,handover.project_id,'handover.read')
         AND ($3::uuid IS NULL OR handover.project_id=$3) AND ($4::text IS NULL OR handover.status=$4)
         AND ($5::uuid IS NULL OR handover.responsible_membership_id=$5)
         AND ($6::text IS NULL OR unit.code ILIKE '%'||$6||'%' OR COALESCE(buyers.names,'') ILIKE '%'||$6||'%')
       ORDER BY ${sort} ${direction},handover.id ASC`,[input.tenantId,input.membershipId,input.projectId??null,input.status??null,input.ownerId??null,input.query??null]);
      return result.rows;
    });
  }
}

import type {Database} from "../database.js";

type Context={tenantId:string;userId:string;membershipId:string};
type ComplaintRow={id:string;project_id:string;project_name:string;unit_id:string;unit_code:string;party_id:string;party_name:string;assignee_membership_id:string|null;assignee_name:string|null;title:string;description:string;status:string;due_at:string|null;created_at:string;updated_at:string;history:Array<{id:string;fromStatus:string|null;toStatus:string;note:string|null;actor:string;occurredAt:string}>};
const select=`SELECT complaint.id,complaint.project_id,project.name project_name,complaint.unit_id,unit.code unit_code,
 complaint.party_id,party.display_name party_name,complaint.assignee_membership_id,assignee_user.display_name assignee_name,
 complaint.title,complaint.description,complaint.status,complaint.due_at::text,complaint.created_at::text,complaint.updated_at::text,
 COALESCE(history.events,'[]'::jsonb) history
 FROM complaints complaint
 JOIN projects project ON project.tenant_id=complaint.tenant_id AND project.id=complaint.project_id
 JOIN units unit ON unit.tenant_id=complaint.tenant_id AND unit.id=complaint.unit_id
 JOIN parties party ON party.tenant_id=complaint.tenant_id AND party.id=complaint.party_id
 LEFT JOIN tenant_memberships assignee ON assignee.tenant_id=complaint.tenant_id AND assignee.id=complaint.assignee_membership_id
 LEFT JOIN users assignee_user ON assignee_user.id=assignee.user_id
 LEFT JOIN LATERAL(SELECT jsonb_agg(jsonb_build_object('id',event.id,'fromStatus',event.from_status,'toStatus',event.to_status,'note',event.note,'occurredAt',event.occurred_at,'actor',actor.display_name) ORDER BY event.occurred_at DESC,event.id DESC) events
   FROM complaint_events event JOIN tenant_memberships member ON member.tenant_id=event.tenant_id AND member.id=event.actor_membership_id
   JOIN users actor ON actor.id=member.user_id WHERE event.tenant_id=complaint.tenant_id AND event.complaint_id=complaint.id) history ON true`;
function dto(row:ComplaintRow){return{id:row.id,projectId:row.project_id,projectName:row.project_name,unitId:row.unit_id,unitCode:row.unit_code,partyId:row.party_id,partyName:row.party_name,assigneeMembershipId:row.assignee_membership_id,assigneeName:row.assignee_name,title:row.title,description:row.description,status:row.status,dueAt:row.due_at,createdAt:row.created_at,updatedAt:row.updated_at,history:row.history};}

export class ComplaintRepository {
  constructor(private readonly database:Database){}
  list(input:Context&{projectId?:string;unitId?:string}){return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>{
    const result=await client.query<ComplaintRow>(`${select} WHERE complaint.tenant_id=$1 AND ($2::uuid IS NULL OR complaint.project_id=$2) AND ($3::uuid IS NULL OR complaint.unit_id=$3) AND app.has_project_permission(complaint.tenant_id,$4,complaint.project_id,'complaints.read') ORDER BY complaint.created_at DESC,complaint.id DESC`,[input.tenantId,input.projectId??null,input.unitId??null,input.membershipId]);
    return result.rows.map(dto);
  });}
  create(input:Context&{projectId:string;unitId:string;partyId:string;title:string;description:string;assigneeMembershipId?:string|null;dueAt?:string|null;idempotencyKey:string}){return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>{
    const created=await client.query<{id:string}>("SELECT app.create_complaint($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) id",[input.tenantId,input.projectId,input.unitId,input.partyId,input.title,input.description,input.assigneeMembershipId??null,input.dueAt??null,input.idempotencyKey,input.membershipId]);
    const result=await client.query<ComplaintRow>(`${select} WHERE complaint.tenant_id=$1 AND complaint.id=$2`,[input.tenantId,created.rows[0].id]);return dto(result.rows[0]);
  });}
  transition(input:Context&{complaintId:string;status:string;note?:string;assigneeMembershipId?:string|null;dueAt?:string|null;idempotencyKey:string}){return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>{
    await client.query("SELECT app.transition_complaint($1,$2,$3,$4,$5,$6,$7,$8)",[input.tenantId,input.complaintId,input.status,input.note??"",input.assigneeMembershipId??null,input.dueAt??null,input.idempotencyKey,input.membershipId]);
    const result=await client.query<ComplaintRow>(`${select} WHERE complaint.tenant_id=$1 AND complaint.id=$2`,[input.tenantId,input.complaintId]);return dto(result.rows[0]);
  });}
}

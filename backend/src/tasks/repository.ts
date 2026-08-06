import type {Database} from "../database.js";

type TaskRow={id:string;title:string;description:string|null;project_id:string|null;unit_id:string|null;party_id:string|null;contract_id:string|null;priority:string;due_at:string|null;status:string;assigned_to_membership_id:string;assignee_name:string;project_name:string|null;unit_code:string|null;party_name:string|null;contract_type:string|null;updated_at:string};

function taskDto(row:TaskRow){
  const objectType=row.unit_id?"unit":row.party_id?"party":row.contract_id?"contract":"project";
  const objectId=row.unit_id??row.party_id??row.contract_id??row.project_id??"";
  const objectLabel=row.unit_code?`Jednotka ${row.unit_code}`:row.party_name?`Klient · ${row.party_name}`:row.contract_type?`Smlouva ${row.contract_type}`:row.project_name?`Projekt · ${row.project_name}`:"Bez vazby";
  return{id:row.id,title:row.title,description:row.description,objectType,objectId,objectLabel,projectId:row.project_id,projectName:row.project_name,assignedToUserId:row.assigned_to_membership_id,assigneeName:row.assignee_name,priority:row.priority,dueAt:row.due_at,state:row.status,updatedAt:row.updated_at};
}

const taskSelect=`SELECT task.id,task.title,task.description,task.project_id,task.unit_id,task.party_id,task.contract_id,task.priority,task.due_at::text,task.status,task.assigned_to_membership_id,task.updated_at::text,
 assignee_user.display_name assignee_name,project.name project_name,unit.code unit_code,party.display_name party_name,contract.contract_type contract_type
 FROM tasks task
 JOIN tenant_memberships assignee ON assignee.tenant_id=task.tenant_id AND assignee.id=task.assigned_to_membership_id
 JOIN users assignee_user ON assignee_user.id=assignee.user_id
 LEFT JOIN projects project ON project.tenant_id=task.tenant_id AND project.id=task.project_id
 LEFT JOIN units unit ON unit.tenant_id=task.tenant_id AND unit.id=task.unit_id
 LEFT JOIN parties party ON party.tenant_id=task.tenant_id AND party.id=task.party_id
 LEFT JOIN contracts contract ON contract.tenant_id=task.tenant_id AND contract.id=task.contract_id`;

export class TaskRepository{constructor(private readonly database:Database){}
 async list(input:{tenantId:string;userId:string;membershipId:string;scope:"mine"|"all"|"completed"}){return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>{
   const result=await client.query<TaskRow>(`${taskSelect} WHERE task.tenant_id=$1 AND ($2='all' OR ($2='mine' AND task.assigned_to_membership_id=$3 AND task.status='open') OR ($2='completed' AND task.status='completed')) AND task.status<>'cancelled' AND (task.project_id IS NULL OR app.has_project_permission(task.tenant_id,$3,task.project_id,'tasks.read')) ORDER BY task.status,task.due_at NULLS LAST,task.created_at DESC`,[input.tenantId,input.scope,input.membershipId]);
   return result.rows.map(taskDto);
 });}
 async create(input:{tenantId:string;userId:string;membershipId:string;projectId?:string;unitId?:string;partyId?:string;contractId?:string;title:string;description?:string;priority:string;dueAt?:string;assigneeMembershipId:string}){return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>{
   if(!input.projectId)throw new Error("projectId is required");
   const allowed=await client.query("SELECT app.has_project_permission($1,$2,$3,'tasks.manage') allowed",[input.tenantId,input.membershipId,input.projectId]);if(!allowed.rows[0]?.allowed)throw new Error("tasks.manage permission required");
   const assignee=await client.query("SELECT 1 FROM tenant_memberships WHERE tenant_id=$1 AND id=$2 AND status='active'",[input.tenantId,input.assigneeMembershipId]);if(!assignee.rows.length)throw new Error("assignee must be an active membership");
   const result=await client.query<{id:string}>(`INSERT INTO tasks(tenant_id,project_id,unit_id,party_id,contract_id,title,description,priority,due_at,assigned_to_membership_id,created_by_membership_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,[input.tenantId,input.projectId,input.unitId??null,input.partyId??null,input.contractId??null,input.title,input.description??null,input.priority,input.dueAt??null,input.assigneeMembershipId,input.membershipId]);
   await client.query("INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data,metadata) VALUES($1,$2,'task.created','task',$3,$4,$5)",[input.tenantId,input.userId,result.rows[0].id,JSON.stringify({title:input.title,status:"open"}),JSON.stringify({projectId:input.projectId,unitId:input.unitId??null})]);
   const created=await client.query<TaskRow>(`${taskSelect} WHERE task.tenant_id=$1 AND task.id=$2`,[input.tenantId,result.rows[0].id]);return taskDto(created.rows[0]);
 });}
 async complete(input:{tenantId:string;userId:string;membershipId:string;taskId:string;completed:boolean}){return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>{const found=await client.query<{project_id:string|null;assigned_to_membership_id:string}>("SELECT project_id,assigned_to_membership_id FROM tasks WHERE tenant_id=$1 AND id=$2 FOR UPDATE",[input.tenantId,input.taskId]);const task=found.rows[0];if(!task)throw new Error("task not found");if(task.assigned_to_membership_id!==input.membershipId&&task.project_id){const allowed=await client.query("SELECT app.has_project_permission($1,$2,$3,'tasks.manage') allowed",[input.tenantId,input.membershipId,task.project_id]);if(!allowed.rows[0]?.allowed)throw new Error("tasks.manage permission required");}await client.query("UPDATE tasks SET status=$3,completed_at=CASE WHEN $3='completed' THEN now() ELSE NULL END,completed_by_membership_id=CASE WHEN $3='completed' THEN $4::uuid ELSE NULL END WHERE tenant_id=$1 AND id=$2",[input.tenantId,input.taskId,input.completed?"completed":"open",input.membershipId]);await client.query("INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data) VALUES($1,$2,$3,'task',$4,$5)",[input.tenantId,input.userId,input.completed?"task.completed":"task.reopened",input.taskId,JSON.stringify({completed:input.completed})]);return{id:input.taskId,completed:input.completed};});}
 async archive(input:{tenantId:string;userId:string;membershipId:string;taskId:string}){return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>{const found=await client.query<{project_id:string|null}>("SELECT project_id FROM tasks WHERE tenant_id=$1 AND id=$2 FOR UPDATE",[input.tenantId,input.taskId]);const task=found.rows[0];if(!task)throw new Error("task not found");if(task.project_id){const allowed=await client.query("SELECT app.has_project_permission($1,$2,$3,'tasks.manage') allowed",[input.tenantId,input.membershipId,task.project_id]);if(!allowed.rows[0]?.allowed)throw new Error("tasks.manage permission required");}await client.query("UPDATE tasks SET status='cancelled',completed_at=NULL,completed_by_membership_id=NULL WHERE tenant_id=$1 AND id=$2",[input.tenantId,input.taskId]);await client.query("INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data) VALUES($1,$2,'task.archived','task',$3,$4)",[input.tenantId,input.userId,input.taskId,JSON.stringify({status:"cancelled"})]);return{id:input.taskId,archived:true};});}
}

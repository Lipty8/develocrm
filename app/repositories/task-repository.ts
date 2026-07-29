import type { TaskRecord } from "../crm-data";
import { apiFetch } from "../lib/api-client";

type ApiTask = { id:string;title:string;description:string|null;objectType:string;objectId:string;assignedToUserId:string|null;assigneeName?:string;priority:string;dueAt:string|null;state:string;updatedAt?:string };
const priorityLabel:Record<string,string>={high:"Vysoká",medium:"Střední",low:"Nízká"};
function map(row:ApiTask, owner:string):TaskRecord{return{id:row.id,title:row.title,description:row.description??undefined,object:`${row.objectId} · ${row.description||"Ručně vytvořený úkol"}`,objectType:row.objectType,objectId:row.objectId,project:"Rezidence Dejvice",due:row.dueAt?new Date(`${row.dueAt}T00:00:00`).toLocaleDateString("cs-CZ"):"Bez termínu",dueAt:row.dueAt,priority:priorityLabel[row.priority]??row.priority,owner:row.assigneeName??owner,assigneeId:row.assignedToUserId,done:row.state==="completed",updatedAt:row.updatedAt};}

export const taskRepository={
  async list(scope:"mine"|"all"|"completed",owner:string,signal?:AbortSignal){const response=await apiFetch(`/api/tasks?scope=${scope}`,{signal,cache:"no-store"});if(!response.ok)throw new Error("Úkoly se nepodařilo načíst");const payload=await response.json() as {tasks:ApiTask[]};return payload.tasks.map(row=>map(row,owner));},
  async create(input:{title:string;description:string;objectType:string;objectId:string;assignedToUserId?:string|null;assigneeName?:string;priority:"low"|"medium"|"high";dueAt:string},owner:string){const response=await apiFetch("/api/tasks",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(input)});const payload=await response.json() as {task?:ApiTask;error?:string};if(!response.ok||!payload.task)throw new Error(payload.error||"Úkol se nepodařilo vytvořit");return map(payload.task,owner);},
  async complete(id:string|number,completed:boolean){const response=await apiFetch("/api/tasks",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:String(id),completed})});if(!response.ok){const payload=await response.json().catch(()=>({})) as {error?:string};throw new Error(payload.error||"Úkol nelze aktualizovat");}},
};

import {forwardBackendMutation} from "../../../../../../lib/backend-proxy";

export async function POST(request:Request,context:{params:Promise<{projectId:string}>}){
  const {projectId}=await context.params;
  return forwardBackendMutation(request,{method:"POST",target:`/v1/projects/${encodeURIComponent(projectId)}/inventory-imports/preview`,unavailableMessage:"Kontrola importu vyžaduje připojený backend"});
}

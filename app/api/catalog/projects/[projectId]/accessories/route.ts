import { browserFallbackResponse, serverDataMode } from "../../../../../lib/data-mode";
import { forwardBackendMutation } from "../../../../../lib/backend-proxy";

export async function POST(request:Request,context:{params:Promise<{projectId:string}>}){
  if(serverDataMode()==="browser")return browserFallbackResponse({error:"Vývojový browser adapter"},{status:503});
  const {projectId}=await context.params;
  return forwardBackendMutation(request,{method:"POST",target:`/v1/projects/${projectId}/accessories`,unavailableMessage:"Vytvoření příslušenství vyžaduje připojený backend"});
}

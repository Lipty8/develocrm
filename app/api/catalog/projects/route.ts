import { browserFallbackResponse, serverDataMode } from "../../../lib/data-mode";
import { forwardBackendMutation } from "../../../lib/backend-proxy";

export async function POST(request:Request) {
  if(serverDataMode()==="browser")return browserFallbackResponse({error:"Vývojový browser adapter"},{status:503});
  return forwardBackendMutation(request,{method:"POST",target:"/v1/projects",unavailableMessage:"Založení projektu vyžaduje připojený backend"});
}

import { browserFallbackResponse, serverDataMode } from "../../../../lib/data-mode";
import { forwardBackendMutation } from "../../../../lib/backend-proxy";

export async function PATCH(request:Request,context:{params:Promise<{accessoryId:string}>}){
  if(serverDataMode()==="browser")return browserFallbackResponse({error:"Vývojový browser adapter"},{status:503});
  const {accessoryId}=await context.params;
  return forwardBackendMutation(request,{method:"PATCH",target:`/v1/accessories/${encodeURIComponent(accessoryId)}`,unavailableMessage:"Úprava příslušenství vyžaduje připojený backend"});
}

export async function DELETE(request:Request,context:{params:Promise<{accessoryId:string}>}){
  if(serverDataMode()==="browser")return browserFallbackResponse({error:"Vývojový browser adapter"},{status:503});
  const {accessoryId}=await context.params;
  return forwardBackendMutation(request,{method:"DELETE",target:`/v1/accessories/${encodeURIComponent(accessoryId)}`,unavailableMessage:"Odstranění příslušenství vyžaduje připojený backend"});
}

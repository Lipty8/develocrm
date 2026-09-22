import {forwardBackendMutation} from "../../../../lib/backend-proxy";

export async function PATCH(request:Request,context:{params:Promise<{changeId:string}>}){
  const {changeId}=await context.params;
  return forwardBackendMutation(request,{method:"PATCH",target:`/v1/client-changes/${encodeURIComponent(changeId)}/status`,unavailableMessage:"Stav klientské změny se nepodařilo uložit"});
}

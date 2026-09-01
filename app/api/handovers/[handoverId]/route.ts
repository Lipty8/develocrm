import {forwardBackendMutation} from "../../../lib/backend-proxy";

export async function PATCH(request:Request,{params}:{params:Promise<{handoverId:string}>}){
  const {handoverId}=await params;
  return forwardBackendMutation(request,{method:"PATCH",target:`/v1/handovers/${encodeURIComponent(handoverId)}`,unavailableMessage:"Úprava předání vyžaduje připojený backend"});
}

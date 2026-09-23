import {forwardBackendMutation} from "../../../../lib/backend-proxy";

export async function PATCH(request:Request,context:{params:Promise<{obligationId:string}>}){
  const {obligationId}=await context.params;
  return forwardBackendMutation(request,{method:"PATCH",target:`/v1/payment-obligations/${encodeURIComponent(obligationId)}/due-date`,unavailableMessage:"Změna splatnosti vyžaduje připojený backend"});
}

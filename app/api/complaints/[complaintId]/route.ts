import {forwardBackendMutation} from "../../../lib/backend-proxy";

export async function PATCH(request:Request,context:{params:Promise<{complaintId:string}>}){
  const {complaintId}=await context.params;
  return forwardBackendMutation(request,{method:"PATCH",target:`/v1/complaints/${encodeURIComponent(complaintId)}`,unavailableMessage:"Reklamaci se nepodařilo upravit"});
}

import {forwardBackendMutation} from "../../../../../lib/backend-proxy";

export async function POST(request:Request,context:{params:Promise<{proposalId:string}>}){
  const {proposalId}=await context.params;
  return forwardBackendMutation(request,{method:"POST",target:`/v1/price-proposals/${encodeURIComponent(proposalId)}/decision`,unavailableMessage:"Schvalování cen vyžaduje připojený backend"});
}

import {forwardBackendMutation} from "../../../../../lib/backend-proxy";

export async function POST(request:Request,context:{params:Promise<{salesCaseId:string}>}){
  const {salesCaseId}=await context.params;
  return forwardBackendMutation(request,{method:"POST",target:`/v1/sales-cases/${encodeURIComponent(salesCaseId)}/buyer`,unavailableMessage:"Změna kupujícího vyžaduje připojený backend"});
}

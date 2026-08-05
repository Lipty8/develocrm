import {forwardBackendMutation} from "../../../../../lib/backend-proxy";

export async function POST(request:Request,context:{params:Promise<{contractPartyId:string}>}){
  const {contractPartyId}=await context.params;
  return forwardBackendMutation(request,{method:"POST",target:`/v1/contract-parties/${encodeURIComponent(contractPartyId)}/sign`,unavailableMessage:"Záznam podpisu vyžaduje připojený backend"});
}

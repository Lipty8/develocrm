import {forwardBackendMutation} from "../../../../../lib/backend-proxy";

export async function POST(request:Request,context:{params:Promise<{unitId:string}>}){
  const {unitId}=await context.params;
  return forwardBackendMutation(request,{method:"POST",target:`/v1/units/${encodeURIComponent(unitId)}/next-contract`,unavailableMessage:"Vytvoření smlouvy vyžaduje připojený backend"});
}

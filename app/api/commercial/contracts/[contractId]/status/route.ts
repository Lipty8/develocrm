import {forwardBackendMutation} from "../../../../../lib/backend-proxy";

export async function POST(request:Request,context:{params:Promise<{contractId:string}>}){const {contractId}=await context.params;return forwardBackendMutation(request,{method:"POST",target:`/v1/contracts/${encodeURIComponent(contractId)}/status`,unavailableMessage:"Smluvní operace vyžaduje připojený backend"});}

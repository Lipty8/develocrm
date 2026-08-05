import {forwardBackendMutation} from "../../../../../lib/backend-proxy";

export async function POST(request:Request,context:{params:Promise<{holdId:string}>}){const {holdId}=await context.params;return forwardBackendMutation(request,{method:"POST",target:`/v1/holds/${encodeURIComponent(holdId)}/cancel`,unavailableMessage:"Obchodní operace vyžaduje připojený backend"});}

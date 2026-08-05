import {forwardBackendMutation} from "../../../../../lib/backend-proxy";

export async function POST(request:Request,context:{params:Promise<{holdId:string}>}){return forward(request,context,"convert");}
async function forward(request:Request,context:{params:Promise<{holdId:string}>},action:string){const {holdId}=await context.params;return forwardBackendMutation(request,{method:"POST",target:`/v1/holds/${encodeURIComponent(holdId)}/${action}`,unavailableMessage:"Obchodní operace vyžaduje připojený backend"});}

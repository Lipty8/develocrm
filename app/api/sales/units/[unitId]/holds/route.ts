import {forwardBackendMutation} from "../../../../../lib/backend-proxy";

export async function POST(request:Request,context:{params:Promise<{unitId:string}>}){return forward(request,context,"holds");}
async function forward(request:Request,context:{params:Promise<{unitId:string}>},segment:string){const {unitId}=await context.params;return forwardBackendMutation(request,{method:"POST",target:`/v1/units/${encodeURIComponent(unitId)}/${segment}`,unavailableMessage:"Obchodní operace vyžaduje připojený backend"});}

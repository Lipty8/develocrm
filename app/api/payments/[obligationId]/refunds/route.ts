import {forwardBackendMutation} from "../../../../lib/backend-proxy";
export async function POST(request:Request,context:{params:Promise<{obligationId:string}>}){const {obligationId}=await context.params;return forwardBackendMutation(request,{method:"POST",target:`/v1/payments/${encodeURIComponent(obligationId)}/refunds`,unavailableMessage:"Vytvoření vratky vyžaduje připojený backend"});}

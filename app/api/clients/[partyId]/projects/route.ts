import {forwardBackendMutation} from "../../../../lib/backend-proxy";
export async function POST(request:Request,context:{params:Promise<{partyId:string}>}){const {partyId}=await context.params;return forwardBackendMutation(request,{method:"POST",target:`/v1/parties/${encodeURIComponent(partyId)}/projects`,unavailableMessage:"Propojení klienta s projektem vyžaduje připojený backend"});}

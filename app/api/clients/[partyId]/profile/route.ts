import {forwardBackendMutation} from "../../../../lib/backend-proxy";

export async function PATCH(request:Request,context:{params:Promise<{partyId:string}>}){return forward(request,context,"profile","PATCH");}
async function forward(request:Request,context:{params:Promise<{partyId:string}>},segment:string,method:"PATCH"){const {partyId}=await context.params;return forwardBackendMutation(request,{method,target:`/v1/parties/${encodeURIComponent(partyId)}/${segment}`,unavailableMessage:"Editace vyžaduje připojený backend"});}

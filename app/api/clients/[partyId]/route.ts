import {forwardBackendMutation} from "../../../lib/backend-proxy";

export async function PATCH(request:Request,context:{params:Promise<{partyId:string}>}){return forward(request,context,"PATCH",false);}
export async function POST(request:Request,context:{params:Promise<{partyId:string}>}){return forward(request,context,"POST",true);}
async function forward(request:Request,context:{params:Promise<{partyId:string}>},method:"POST"|"PATCH",contact:boolean){const {partyId}=await context.params;const target=contact?`/v1/parties/${encodeURIComponent(partyId)}/contacts`:`/v1/parties/${encodeURIComponent(partyId)}`;return forwardBackendMutation(request,{method,target,unavailableMessage:"Editace vyžaduje připojený backend"});}

import {forwardBackendMutation} from "../../../lib/backend-proxy";

export async function POST(request:Request){const body=await request.json() as Record<string,unknown>;const unitId=String(body.unitId??"");if(!unitId)return Response.json({error:"Chybí jednotka"},{status:400});return forwardBackendMutation(request,{method:"POST",target:`/v1/units/${encodeURIComponent(unitId)}/prices`,body:JSON.stringify(body),unavailableMessage:"Editace vyžaduje připojený backend"});}

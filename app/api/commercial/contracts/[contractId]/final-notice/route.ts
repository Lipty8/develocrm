import {backendAuthorization,forwardBackendMutation} from '../../../../../lib/backend-proxy';
export async function GET(request:Request,context:{params:Promise<{contractId:string}>}){
  const base=process.env.DEVELOCRM_API_URL?.replace(/\/$/,'');const tenant=process.env.DEVELOCRM_TENANT_ID;const auth=backendAuthorization(request.headers.get('authorization'));
  if(!base||!tenant||!auth)return Response.json({error:'Backend není připojen'},{status:503});
  const {contractId}=await context.params;
  const response=await fetch(new URL(`/v1/contracts/${encodeURIComponent(contractId)}/final-notice`,base),{headers:{authorization:auth,'x-tenant-id':tenant,'x-correlation-id':request.headers.get('x-correlation-id')||crypto.randomUUID()},cache:'no-store'});
  return new Response(await response.arrayBuffer(),{status:response.status,headers:{'content-type':response.headers.get('content-type')||'application/json','cache-control':'no-store'}});
}
export async function POST(request:Request,context:{params:Promise<{contractId:string}>}){
  const {contractId}=await context.params;
  return forwardBackendMutation(request,{method:'POST',target:`/v1/contracts/${encodeURIComponent(contractId)}/final-notice`,unavailableMessage:'Evidence doručení vyžaduje připojený backend'});
}

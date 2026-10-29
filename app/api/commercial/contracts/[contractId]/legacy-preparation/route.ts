import {forwardBackendMutation} from '../../../../../lib/backend-proxy';
import {apiUnavailable} from '../../../../../lib/data-mode';

export async function GET(request:Request,context:{params:Promise<{contractId:string}>}){
  const base=process.env.DEVELOCRM_API_URL?.trim().replace(/\/$/,''),tenant=process.env.DEVELOCRM_TENANT_ID,auth=request.headers.get('authorization');
  const supplied=request.headers.get('x-correlation-id');
  const correlationId=supplied&&/^[a-zA-Z0-9._:-]{1,100}$/.test(supplied)?supplied:crypto.randomUUID();
  if(!base||!tenant||!auth)return apiUnavailable('Příprava smlouvy vyžaduje připojený backend.',correlationId);
  const {contractId}=await context.params;
  try{
    const response=await fetch(new URL(`/v1/contracts/${encodeURIComponent(contractId)}/legacy-preparation`,base),{
      headers:{authorization:auth,'x-tenant-id':tenant,'x-correlation-id':correlationId},cache:'no-store',redirect:'manual',signal:request.signal});
    if(response.status>=300&&response.status<400)return apiUnavailable('Náhled smlouvy se nepodařilo načíst.',correlationId);
    return new Response(await response.arrayBuffer(),{status:response.status,headers:{'content-type':response.headers.get('content-type')??'application/json','cache-control':'no-store','x-correlation-id':response.headers.get('x-correlation-id')??correlationId}});
  }catch(error){
    console.warn(JSON.stringify({event:'bff.contract_preparation.read_failed',correlationId,errorName:error instanceof Error?error.name:'Error'}));
    return apiUnavailable('Náhled smlouvy se nepodařilo načíst.',correlationId);
  }
}
export async function POST(request:Request,context:{params:Promise<{contractId:string}>}){
  const {contractId}=await context.params;
  return forwardBackendMutation(request,{method:'POST',target:`/v1/contracts/${encodeURIComponent(contractId)}/legacy-preparation`,unavailableMessage:'Příprava smlouvy vyžaduje připojený backend.'});
}

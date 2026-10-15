export async function GET(request:Request){
  const backendUrl=process.env.DEVELOCRM_API_URL?.replace(/\/$/,'');const tenantId=process.env.DEVELOCRM_TENANT_ID;const authorization=request.headers.get('authorization');
  if(!backendUrl||!tenantId||!authorization)return Response.json({error:'Aktivitu nelze načíst bez přihlášení.'},{status:401});
  const response=await fetch(`${backendUrl}/v1/activity`,{headers:{authorization,'x-tenant-id':tenantId,'x-correlation-id':request.headers.get('x-correlation-id')??crypto.randomUUID()},cache:'no-store',signal:request.signal});
  return new Response(await response.text(),{status:response.status,headers:{'content-type':'application/json','x-correlation-id':response.headers.get('x-correlation-id')??''}});
}

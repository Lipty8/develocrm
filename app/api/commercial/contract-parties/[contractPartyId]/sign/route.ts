export async function POST(request:Request,context:{params:Promise<{contractPartyId:string}>}){
  const backendUrl=process.env.DEVELOCRM_API_URL?.replace(/\/$/,"");const tenantId=process.env.DEVELOCRM_TENANT_ID;const authorization=request.headers.get("authorization");
  if(!backendUrl||!tenantId||!authorization)return Response.json({error:"Záznam podpisu vyžaduje připojený backend"},{status:503});
  const {contractPartyId}=await context.params;
  const response=await fetch(`${backendUrl}/v1/contract-parties/${encodeURIComponent(contractPartyId)}/sign`,{method:"POST",headers:{authorization,"x-tenant-id":tenantId,"content-type":"application/json"},body:await request.text(),cache:"no-store"});
  return new Response(await response.text(),{status:response.status,headers:{"content-type":"application/json"}});
}

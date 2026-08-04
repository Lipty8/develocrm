export async function POST(request:Request){
  const backendUrl=process.env.DEVELOCRM_API_URL?.replace(/\/$/,"");const tenantId=process.env.DEVELOCRM_TENANT_ID;const authorization=request.headers.get("authorization");
  if(!backendUrl||!tenantId||!authorization)return Response.json({error:"Vytvoření smlouvy vyžaduje připojený backend"},{status:503});
  const response=await fetch(`${backendUrl}/v1/contracts`,{method:"POST",headers:{authorization,"x-tenant-id":tenantId,"content-type":"application/json"},body:await request.text()});
  return new Response(await response.text(),{status:response.status,headers:{"content-type":"application/json"}});
}

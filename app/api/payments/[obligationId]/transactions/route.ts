export async function POST(request:Request,context:{params:Promise<{obligationId:string}>}){
  const base=process.env.DEVELOCRM_API_URL?.replace(/\/$/,"");const tenant=process.env.DEVELOCRM_TENANT_ID;const auth=request.headers.get("authorization");
  if(!base||!tenant||!auth)return Response.json({error:"Preview adapter"},{status:503});
  const {obligationId}=await context.params;const response=await fetch(`${base}/v1/payment-obligations/${obligationId}/payments`,{method:"POST",headers:{authorization:auth,"x-tenant-id":tenant,"content-type":"application/json"},body:await request.text()});
  return new Response(await response.text(),{status:response.status,headers:{"content-type":"application/json"}});
}

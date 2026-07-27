export async function PATCH(request:Request,context:{params:Promise<{roleId:string}>}){
  const {roleId}=await context.params;const backendUrl=process.env.DEVELOCRM_API_URL?.replace(/\/$/,"");const tenantId=process.env.DEVELOCRM_TENANT_ID;const authorization=request.headers.get("authorization");
  if(!backendUrl||!tenantId||!authorization)return Response.json({error:"Preview adapter"},{status:503});
  const response=await fetch(`${backendUrl}/v1/admin/roles/${roleId}`,{method:"PATCH",headers:{authorization,"x-tenant-id":tenantId,"content-type":"application/json"},body:await request.text()});
  return new Response(await response.text(),{status:response.status,headers:{"content-type":"application/json"}});
}

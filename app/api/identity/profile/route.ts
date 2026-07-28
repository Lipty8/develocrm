export async function PATCH(request:Request){
  const base=process.env.DEVELOCRM_API_URL?.replace(/\/$/,""),tenant=process.env.DEVELOCRM_TENANT_ID,auth=request.headers.get("authorization");
  if(!base||!tenant||!auth)return Response.json({error:"Profil používá preview adapter"},{status:503});
  const response=await fetch(`${base}/v1/profile`,{method:"PATCH",headers:{authorization:auth,"x-tenant-id":tenant,"content-type":"application/json"},body:await request.text()});
  return new Response(await response.text(),{status:response.status,headers:{"content-type":"application/json"}});
}

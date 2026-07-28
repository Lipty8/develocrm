export async function GET(request:Request){
  const base=process.env.DEVELOCRM_API_URL?.replace(/\/$/,"");const tenant=process.env.DEVELOCRM_TENANT_ID;const auth=request.headers.get("authorization");
  if(!base||!tenant||!auth)return Response.json({error:"Preview adapter"},{status:503});
  const target=new URL("/v1/payments",base);new URL(request.url).searchParams.forEach((value,key)=>target.searchParams.set(key,value));
  const response=await fetch(target,{headers:{authorization:auth,"x-tenant-id":tenant},cache:"no-store"});
  return new Response(await response.text(),{status:response.status,headers:{"content-type":"application/json"}});
}

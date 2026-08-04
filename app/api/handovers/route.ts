import type {HandoverRecord} from "../../repositories/handover-repository";
export async function GET(request:Request){
  const backendUrl=process.env.DEVELOCRM_API_URL?.replace(/\/$/,"");const tenantId=process.env.DEVELOCRM_TENANT_ID;const authorization=request.headers.get("authorization");
  if(!backendUrl||!tenantId||!authorization)return Response.json({error:"Preview adapter"},{status:503});
  const target=new URL("/v1/handovers",backendUrl);new URL(request.url).searchParams.forEach((value,key)=>target.searchParams.set(key,value));
  const response=await fetch(target,{headers:{authorization,"x-tenant-id":tenantId},cache:"no-store"});if(!response.ok)return Response.json({error:"Předání nelze načíst"},{status:response.status});
  return Response.json({handovers:await response.json() as HandoverRecord[]});
}
export async function POST(request:Request){
  const backendUrl=process.env.DEVELOCRM_API_URL?.replace(/\/$/,"");const tenantId=process.env.DEVELOCRM_TENANT_ID;const authorization=request.headers.get("authorization");
  if(!backendUrl||!tenantId||!authorization)return Response.json({error:"Plánování předání vyžaduje připojený backend"},{status:503});
  const response=await fetch(`${backendUrl}/v1/handovers`,{method:"POST",headers:{authorization,"x-tenant-id":tenantId,"content-type":"application/json"},body:await request.text()});
  return new Response(await response.text(),{status:response.status,headers:{"content-type":"application/json"}});
}

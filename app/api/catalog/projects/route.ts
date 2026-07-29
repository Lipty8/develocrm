import { apiUnavailable, browserFallbackResponse, serverDataMode } from "../../../lib/data-mode";

export async function POST(request:Request) {
  const backendUrl=process.env.DEVELOCRM_API_URL?.replace(/\/$/,"");
  const tenantId=process.env.DEVELOCRM_TENANT_ID;
  const authorization=request.headers.get("authorization");
  if(!backendUrl||!tenantId||!authorization) {
    return serverDataMode()==="browser"
      ? browserFallbackResponse({error:"Vývojový browser adapter"},{status:503})
      : apiUnavailable("Založení projektu vyžaduje připojený backend");
  }
  const response=await fetch(`${backendUrl}/v1/projects`,{
    method:"POST",
    headers:{authorization,"x-tenant-id":tenantId,"content-type":"application/json"},
    body:await request.text(),
  });
  const headers=new Headers({"content-type":"application/json"});
  const correlationId=response.headers.get("x-correlation-id");
  if(correlationId)headers.set("x-correlation-id",correlationId);
  return new Response(await response.text(),{status:response.status,headers});
}

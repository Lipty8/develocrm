import { apiUnavailable, browserFallbackResponse, serverDataMode } from "../../lib/data-mode";

export async function forwardCatalogMutation(
  request:Request,
  context:{params:Promise<Record<string,string>>},
  method:string,
  kind:string,
) {
  const backendUrl=process.env.DEVELOCRM_API_URL?.replace(/\/$/,"");
  const tenantId=process.env.DEVELOCRM_TENANT_ID;
  const authorization=request.headers.get("authorization");
  if(!backendUrl||!tenantId||!authorization) {
    return serverDataMode()==="browser"
      ? browserFallbackResponse({error:"Vývojový browser adapter"},{status:503})
      : apiUnavailable("Editace vyžaduje připojený backend");
  }
  const p=await context.params;
  const target=kind==="project"?`/v1/projects/${p.projectId}`
    :kind==="project-construction"?`/v1/projects/${p.projectId}/construction-status`
    :kind==="unit"?`/v1/units/${p.unitId}`
    :kind==="unit-accessory"?`/v1/units/${p.unitId}/accessories`
    :`/v1/accessory-assignments/${p.assignmentId}`;
  const response=await fetch(`${backendUrl}${target}`,{
    method,
    headers:{authorization,"x-tenant-id":tenantId,"content-type":"application/json"},
    body:method==="DELETE"?undefined:await request.text(),
  });
  const headers=new Headers({"content-type":"application/json"});
  const correlationId=response.headers.get("x-correlation-id");
  if(correlationId)headers.set("x-correlation-id",correlationId);
  return new Response(await response.text(),{status:response.status,headers});
}

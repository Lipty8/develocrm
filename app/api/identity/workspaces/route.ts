import { getChatGPTUser } from "../../../chatgpt-auth";
import { prototypeSession } from "../../../repositories/identity-repository";
import { apiUnavailable, browserFallbackResponse, serverDataMode } from "../../../lib/data-mode";

export async function GET(request:Request){
  const backendUrl=process.env.DEVELOCRM_API_URL?.replace(/\/$/,"");const authorization=request.headers.get("authorization");
  if(backendUrl&&authorization){const response=await fetch(`${backendUrl}/v1/session/workspaces`,{headers:{authorization},cache:"no-store"});if(response.ok)return new Response(response.body,{status:response.status,headers:{"content-type":"application/json"}});}
  if(serverDataMode()!=="browser")return apiUnavailable("Pracovní prostory nejsou dostupné bez společného backendu");
  await getChatGPTUser();
  return browserFallbackResponse({workspaces:[{tenantId:prototypeSession.workspace.tenantId,tenantName:prototypeSession.workspace.tenantName,tenantSlug:"develo-group"}]});
}

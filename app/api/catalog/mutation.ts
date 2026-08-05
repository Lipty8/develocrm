import { browserFallbackResponse, serverDataMode } from "../../lib/data-mode";
import { forwardBackendMutation, type BackendMutationMethod } from "../../lib/backend-proxy";

export async function forwardCatalogMutation(
  request:Request,
  context:{params:Promise<Record<string,string>>},
  method:BackendMutationMethod,
  kind:string,
) {
  if(serverDataMode()==="browser")return browserFallbackResponse({error:"Vývojový browser adapter"},{status:503});
  const p=await context.params;
  const target=kind==="project"?`/v1/projects/${p.projectId}`
    :kind==="project-construction"?`/v1/projects/${p.projectId}/construction-status`
    :kind==="unit"?`/v1/units/${p.unitId}`
    :kind==="unit-accessory"?`/v1/units/${p.unitId}/accessories`
    :`/v1/accessory-assignments/${p.assignmentId}`;
  return forwardBackendMutation(request,{method,target,unavailableMessage:"Editace vyžaduje připojený backend"});
}

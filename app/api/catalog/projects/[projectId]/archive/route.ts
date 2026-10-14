import {forwardBackendMutation} from "../../../../../lib/backend-proxy";
export async function PATCH(request:Request,context:{params:Promise<{projectId:string}>}){
 const {projectId}=await context.params;
 return forwardBackendMutation(request,{method:"PATCH",target:`/v1/projects/${encodeURIComponent(projectId)}/archive`,unavailableMessage:"Viditelnost projektu nelze změnit bez připojeného backendu."});
}

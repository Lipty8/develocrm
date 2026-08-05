import {forwardBackendMutation} from "../../../../../lib/backend-proxy";

export async function PATCH(request:Request,context:{params:Promise<{roleId:string}>}){
  const {roleId}=await context.params;return forwardBackendMutation(request,{method:"PATCH",target:`/v1/admin/roles/${encodeURIComponent(roleId)}`,unavailableMessage:"Správa rolí vyžaduje připojený backend"});
}

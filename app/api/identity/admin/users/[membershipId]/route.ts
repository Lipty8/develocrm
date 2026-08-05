import {forwardBackendMutation} from "../../../../../lib/backend-proxy";

export async function PATCH(request:Request,context:{params:Promise<{membershipId:string}>}){
  const {membershipId}=await context.params;return forwardBackendMutation(request,{method:"PATCH",target:`/v1/admin/users/${encodeURIComponent(membershipId)}`,unavailableMessage:"Správa uživatelů vyžaduje připojený backend"});
}

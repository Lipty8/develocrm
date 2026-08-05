import {forwardBackendMutation} from "../../../lib/backend-proxy";

export async function PATCH(request:Request){
  return forwardBackendMutation(request,{method:"PATCH",target:"/v1/profile",unavailableMessage:"Profil používá preview adapter"});
}

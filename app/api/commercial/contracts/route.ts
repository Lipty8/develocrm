import {forwardBackendMutation} from "../../../lib/backend-proxy";

export async function POST(request:Request){
  return forwardBackendMutation(request,{method:"POST",target:"/v1/contracts",unavailableMessage:"Vytvoření smlouvy vyžaduje připojený backend"});
}

import {forwardBackendMutation} from "../../../../lib/backend-proxy";

export async function POST(request:Request,context:{params:Promise<{obligationId:string}>}){
  const {obligationId}=await context.params;return forwardBackendMutation(request,{method:"POST",target:`/v1/payment-obligations/${encodeURIComponent(obligationId)}/payments`,unavailableMessage:"Platba vyžaduje připojený backend"});
}

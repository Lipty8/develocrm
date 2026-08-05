import {forwardBackendMutation} from "../../../../lib/backend-proxy";

export async function POST(request:Request,context:{params:Promise<{transactionId:string}>}){
  const {transactionId}=await context.params;return forwardBackendMutation(request,{method:"POST",target:`/v1/payment-transactions/${encodeURIComponent(transactionId)}/reversal`,unavailableMessage:"Storno platby vyžaduje připojený backend"});
}

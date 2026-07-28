import type {Database} from "../database.js";
type Context={tenantId:string;userId:string;membershipId:string};
export class PaymentService{
  constructor(private readonly database:Database){}
  createObligation(input:Context&{projectId:string;unitId:string;partyId:string;salesCaseId:string;contractId:string;type:string;label:string;amount:number;dueAt:string;variableSymbol?:string;idempotencyKey:string}){
    return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>(await client.query<{id:string}>("SELECT app.create_payment_obligation($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) id",[input.tenantId,input.projectId,input.unitId,input.partyId??null,input.salesCaseId,input.contractId??null,input.type,input.label,input.amount,input.dueAt,input.variableSymbol??null,input.idempotencyKey,input.membershipId])).rows[0]);
  }
  record(input:Context&{obligationId:string;amount:number;paidAt:string;variableSymbol?:string;counterpartyAccount?:string;bankTransactionId?:string;note?:string}){
    return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>(await client.query<{id:string}>("SELECT app.record_payment($1,$2,$3,$4,$5,$6,$7,$8,$9) id",[input.tenantId,input.obligationId,input.amount,input.paidAt,input.variableSymbol??null,input.counterpartyAccount??null,input.bankTransactionId??null,input.note??null,input.membershipId])).rows[0]);
  }
  reverse(input:Context&{transactionId:string;reason:string}){
    return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>(await client.query<{id:string}>("SELECT app.reverse_payment($1,$2,$3,$4) id",[input.tenantId,input.transactionId,input.reason,input.membershipId])).rows[0]);
  }
}

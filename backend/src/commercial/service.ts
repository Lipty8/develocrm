import type {Database} from "../database.js";
import type {QueryResultRow} from "pg";
type Context={tenantId:string;userId:string;membershipId:string};
export class CommercialService{
  constructor(private readonly database:Database){}
  private command<T extends QueryResultRow>(context:Context,sql:string,parameters:unknown[]){return this.database.withContext({tenantId:context.tenantId,userId:context.userId},async client=>(await client.query<T>(sql,parameters)).rows[0]);}
  recordPrice(input:Context&{unitId:string;priceType:string;amount:number;currency:string;validFrom:string;reason:string;approverMembershipId?:string}){return this.command<{id:string}>(input,"SELECT app.record_unit_price($1,$2,$3,$4,$5,$6,$7,$8,$9) id",[input.tenantId,input.unitId,input.priceType,input.amount,input.currency,input.validFrom,input.reason,input.membershipId,input.approverMembershipId??null]);}
  createContract(input:Context&{salesCaseId:string;type:string;reference:string;title:string;parentContractId?:string}){return this.command<{id:string}>(input,"SELECT app.create_contract($1,$2,$3,$4,$5,$6,$7) id",[input.tenantId,input.salesCaseId,input.type,input.reference,input.title,input.membershipId,input.parentContractId??null]);}
  createVersion(input:Context&{contractId:string;name:string;source:string;basedOnVersionId?:string;generationPayload?:unknown}){return this.command<{id:string}>(input,"SELECT app.create_contract_version($1,$2,$3,$4,$5,$6,$7::jsonb) id",[input.tenantId,input.contractId,input.name,input.source,input.membershipId,input.basedOnVersionId??null,JSON.stringify(input.generationPayload??{})]);}
  transition(input:Context&{contractId:string;to:string;reason:string}){return this.command<{id:string}>(input,"SELECT app.transition_contract_status($1,$2,$3,$4,$5) id",[input.tenantId,input.contractId,input.to,input.reason,input.membershipId]);}
  sign(input:Context&{contractPartyId:string;versionId:string;reason:string}){return this.command<{completed:boolean}>(input,"SELECT app.record_contract_party_signature($1,$2,$3,$4,$5) completed",[input.tenantId,input.contractPartyId,input.versionId,input.membershipId,input.reason]);}
}

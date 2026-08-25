import type {Database} from "../database.js";
import type {QueryResultRow} from "pg";
import {contextualContractIdentity,getNextContractAction,type ContractWorkflowFact,type NextContractAction} from "../shared/next-contract-action.js";
type Context={tenantId:string;userId:string;membershipId:string};
export class CommercialService{
  constructor(private readonly database:Database){}
  private command<T extends QueryResultRow>(context:Context,sql:string,parameters:unknown[]){return this.database.withContext({tenantId:context.tenantId,userId:context.userId},async client=>(await client.query<T>(sql,parameters)).rows[0]);}
  recordPrice(input:Context&{unitId:string;priceType:string;amount:number;currency:string;validFrom:string;reason:string}){return this.command<{id:string}>(input,"SELECT app.propose_unit_price($1,$2,$3,$4,$5,$6,$7,$8) id",[input.tenantId,input.unitId,input.priceType,input.amount,input.currency,input.validFrom,input.reason,input.membershipId]);}
  decidePrice(input:Context&{proposalId:string;decision:"approved"|"rejected";reason:string}){return this.command<{id:string|null}>(input,"SELECT app.decide_unit_price_proposal($1,$2,$3,$4,$5) id",[input.tenantId,input.proposalId,input.decision,input.reason,input.membershipId]);}
  createContract(input:Context&{salesCaseId:string;type:string;reference:string;title:string;parentContractId?:string;idempotencyKey:string;paymentCalculationType?:"percentage"|"fixed";paymentInputValue?:number;paymentDueAt?:string}){return this.command<{id:string;versionId:string;paymentObligationId:string|null;paymentAmount:number|null}>(input,`SELECT contract_id id,version_id "versionId",payment_obligation_id "paymentObligationId",payment_amount::float8 "paymentAmount"
    FROM app.create_contract_with_payment($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[input.tenantId,input.salesCaseId,input.type,input.reference,input.title,input.membershipId,input.parentContractId??null,input.idempotencyKey,input.paymentCalculationType??null,input.paymentInputValue??null,input.paymentDueAt??null]);}
  async nextContractAction(input:Context&{unitId:string}):Promise<NextContractAction&{unitId:string;unitCode:string;salesCaseId:string|null;buyerNames:string[]} >{
    return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>{
      const unit=(await client.query<{id:string;code:string;sales_case_id:string|null}>(`SELECT unit.id,unit.code,
        (SELECT sales_case.id FROM sales_cases sales_case WHERE sales_case.tenant_id=unit.tenant_id AND sales_case.unit_id=unit.id AND sales_case.status='active' ORDER BY sales_case.opened_at DESC LIMIT 1) sales_case_id
        FROM units unit WHERE unit.tenant_id=$1 AND unit.id=$2 AND unit.archived_at IS NULL
          AND app.has_project_permission(unit.tenant_id,$3,unit.project_id,'contract.read')`,[input.tenantId,input.unitId,input.membershipId])).rows[0];
      if(!unit)throw new Error("unit not found or contract.read permission required");
      const contracts=unit.sales_case_id?(await client.query<ContractWorkflowFact>(`SELECT id,contract_type type,current_status status FROM contracts
        WHERE tenant_id=$1 AND sales_case_id=$2 AND contract_type IN ('rs','sbk','ks') ORDER BY created_at DESC,id DESC`,[input.tenantId,unit.sales_case_id])).rows:[];
      const buyers=unit.sales_case_id?(await client.query<{name:string}>(`SELECT party.display_name name FROM sales_case_parties participant JOIN parties party ON party.tenant_id=participant.tenant_id AND party.id=participant.party_id
        WHERE participant.tenant_id=$1 AND participant.sales_case_id=$2 AND participant.left_at IS NULL AND participant.participant_role IN ('buyer','co_buyer') ORDER BY participant.is_primary DESC,participant.joined_at`,[input.tenantId,unit.sales_case_id])).rows.map(row=>row.name):[];
      return{...getNextContractAction({hasActiveSalesCase:Boolean(unit.sales_case_id),contracts}),unitId:unit.id,unitCode:unit.code,salesCaseId:unit.sales_case_id,buyerNames:buyers};
    });
  }
  async createNextContract(input:Context&{unitId:string;idempotencyKey:string;paymentCalculationType?:"percentage"|"fixed";paymentInputValue?:number;paymentDueAt?:string}){
    return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>{
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`${input.tenantId}:${input.unitId}:next-contract`]);
      const unit=(await client.query<{code:string;sales_case_id:string|null}>(`SELECT unit.code,
        (SELECT sales_case.id FROM sales_cases sales_case WHERE sales_case.tenant_id=unit.tenant_id AND sales_case.unit_id=unit.id AND sales_case.status='active' ORDER BY sales_case.opened_at DESC LIMIT 1) sales_case_id
        FROM units unit WHERE unit.tenant_id=$1 AND unit.id=$2 AND unit.archived_at IS NULL
          AND app.has_project_permission(unit.tenant_id,$3,unit.project_id,'contract.manage') FOR UPDATE`,[input.tenantId,input.unitId,input.membershipId])).rows[0];
      if(!unit?.sales_case_id)throw new Error("active sales case and contract.manage permission required");
      const contracts=(await client.query<ContractWorkflowFact>(`SELECT id,contract_type type,current_status status FROM contracts WHERE tenant_id=$1 AND sales_case_id=$2 AND contract_type IN ('rs','sbk','ks') ORDER BY created_at DESC,id DESC`,[input.tenantId,unit.sales_case_id])).rows;
      const action=getNextContractAction({hasActiveSalesCase:true,contracts});
      if(action.kind!=="create_contract")throw new Error("Další smlouvu nyní nelze vytvořit");
      const identity=contextualContractIdentity(action.contractType,unit.code);
      const hasPayment=action.contractType==="rs"||action.contractType==="sbk";
      if(hasPayment&&(!input.paymentCalculationType||!input.paymentInputValue||!input.paymentDueAt))throw new Error("payment terms are required for the next contract");
      const created=(await client.query<{id:string;versionId:string;paymentObligationId:string|null;paymentAmount:number|null}>(`SELECT contract_id id,version_id "versionId",payment_obligation_id "paymentObligationId",payment_amount::float8 "paymentAmount" FROM app.create_contract_with_payment($1,$2,$3,$4,$5,$6,NULL,$7,$8,$9,$10)`,[input.tenantId,unit.sales_case_id,action.contractType,identity.reference,identity.title,input.membershipId,input.idempotencyKey,input.paymentCalculationType??null,input.paymentInputValue??null,input.paymentDueAt??null])).rows[0];
      return{...created,type:action.contractType,reference:identity.reference,title:identity.title};
    });
  }
  async createContractAssignment(input:Context&{unitId:string;buyers?:Array<{partyId:string;role:"buyer"|"co_buyer";isPrimary:boolean;share?:number|null}>;newParty?:{kind:"individual"|"organization";salutation?:string;firstName?:string;lastName?:string;legalName?:string;registrationNumber?:string;email?:string;phone?:string;duplicateOverride?:boolean};effectiveAt:string;note?:string;idempotencyKey:string}){
    return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>{
      let buyers=input.buyers??[];
      if(input.newParty){
        const project=(await client.query<{project_id:string}>("SELECT project_id FROM units WHERE tenant_id=$1 AND id=$2 AND archived_at IS NULL",[input.tenantId,input.unitId])).rows[0]?.project_id;
        if(!project)throw new Error("unit not found");
        await client.query("SELECT set_config('app.party_duplicate_override',$1,true)",[input.newParty.duplicateOverride?"on":"off"]);
        const created=(await client.query<{id:string}>("SELECT app.create_party_for_project($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) id",[
          input.tenantId,project,input.newParty.kind,input.newParty.salutation??null,input.newParty.firstName??null,input.newParty.lastName??null,
          input.newParty.legalName??null,input.newParty.registrationNumber??null,input.newParty.email??null,input.newParty.phone??null,input.membershipId,
        ])).rows[0];
        buyers=[{partyId:created.id,role:"buyer",isPrimary:true,share:null}];
      }
      if(!buyers.length)throw new Error("at least one assignee is required");
      return (await client.query<{contractId:string;versionId:string;type:string;parentContractId:string}>(`SELECT contract_id "contractId",version_id "versionId",contract_type type,parent_contract_id "parentContractId"
        FROM app.create_contract_assignment($1,$2,$3::jsonb,$4,$5,$6,$7)`,[
        input.tenantId,input.unitId,JSON.stringify(buyers),input.membershipId,input.effectiveAt,input.note??null,input.idempotencyKey,
      ])).rows[0];
    });
  }
  createVersion(input:Context&{contractId:string;name:string;source:string;basedOnVersionId?:string;generationPayload?:unknown}){const source=["manual","generated","imported"].includes(input.source)?input.source:"manual";return this.command<{id:string}>(input,"SELECT app.create_contract_version($1,$2,$3,$4,$5,$6,$7::jsonb) id",[input.tenantId,input.contractId,input.name,source,input.membershipId,input.basedOnVersionId??null,JSON.stringify(input.generationPayload??{})]);}
  transition(input:Context&{contractId:string;to:string;reason:string}){const reason=input.reason.trim()||"Změna stavu smlouvy";return this.command<{id:string}>(input,"SELECT app.transition_contract_status($1,$2,$3,$4,$5) id",[input.tenantId,input.contractId,input.to,reason,input.membershipId]);}
  sign(input:Context&{contractPartyId:string;versionId:string;reason:string}){return this.command<{completed:boolean}>(input,"SELECT app.record_contract_party_signature($1,$2,$3,$4,$5) completed",[input.tenantId,input.contractPartyId,input.versionId,input.membershipId,input.reason]);}
  signContract(input:Context&{contractId:string;versionId:string;signedAt:string;note?:string}){return this.command<{completed:boolean;alreadySigned:boolean;versionId:string}>(input,`SELECT completed,"already_signed" "alreadySigned","version_id" "versionId"
    FROM app.sign_contract_externally($1,$2,$3,$4,$5,$6)`,[input.tenantId,input.contractId,input.versionId,input.signedAt,input.membershipId,input.note??null]);}
}

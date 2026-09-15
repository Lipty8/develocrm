import type {Database} from "../database.js";

type Context={tenantId:string;userId:string;membershipId:string};
export type PaymentListInput=Context&{projectId?:string;unitId?:string;partyId?:string;contractId?:string;salesCaseId?:string;status?:string;query?:string;sort?:string;direction?:"asc"|"desc"};

export class PaymentRepository{
  constructor(private readonly database:Database){}
  list(input:PaymentListInput){
    return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>{
      const hasRefunds=Boolean((await client.query("SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='payment_refunds'")).rowCount);
      const direction=input.direction==="desc"?"DESC":"ASC";
      const sort=({unit:"unit.code",client:"party.display_name",label:"obligation.label",dueAt:"obligation.due_at",amount:"obligation.amount",paid:"paid",status:"status"} as Record<string,string>)[input.sort??""]??"obligation.due_at";
      const result=await client.query(`SELECT obligation.id,obligation.project_id "projectId",project.name project,
        obligation.unit_id "unitId",unit.code unit,obligation.party_id "partyId",COALESCE(party.display_name,'Bez přiřazeného klienta') client,
        obligation.sales_case_id "salesCaseId",obligation.contract_id "contractId",contract.reference "contractReference",contract.contract_type "contractType",contract.current_status "contractStatus",
        obligation.obligation_type "type",obligation.label,obligation.amount::float8 amount,obligation.currency,
        obligation.due_at "dueAt",obligation.variable_symbol "variableSymbol",
        app.payment_obligation_paid(obligation.tenant_id,obligation.id)::float8 paid,
        app.payment_obligation_status(obligation.tenant_id,obligation.id,now()) status,
        ${hasRefunds?"COALESCE(refunds.total,0)::float8":"0::float8"} refunded,
        COALESCE(transactions.items,'[]'::json) transactions,COALESCE(events.items,'[]'::json) events
       FROM payment_obligations obligation
       JOIN projects project ON project.tenant_id=obligation.tenant_id AND project.id=obligation.project_id
       JOIN units unit ON unit.tenant_id=obligation.tenant_id AND unit.id=obligation.unit_id
       LEFT JOIN parties party ON party.tenant_id=obligation.tenant_id AND party.id=obligation.party_id
       LEFT JOIN contracts contract ON contract.tenant_id=obligation.tenant_id AND contract.id=obligation.contract_id
       LEFT JOIN LATERAL(SELECT json_agg(json_build_object('id',transaction.id,'amount',allocation.amount::float8,'paidAt',transaction.paid_at,
         'variableSymbol',transaction.variable_symbol,'counterpartyAccount',transaction.counterparty_account,'bankTransactionId',transaction.bank_transaction_id,
         'note',transaction.note,'sourceType',transaction.source_type,'reversedAt',reversal.reversed_at,'reversalReason',reversal.reason,
         'refunds',${hasRefunds?"COALESCE(transaction_refunds.items,'[]'::json)":"'[]'::json"}) ORDER BY transaction.paid_at DESC) items
         FROM payment_allocations allocation JOIN payment_transactions transaction ON transaction.tenant_id=allocation.tenant_id AND transaction.id=allocation.transaction_id
         LEFT JOIN payment_reversals reversal ON reversal.tenant_id=transaction.tenant_id AND reversal.transaction_id=transaction.id
         ${hasRefunds?"LEFT JOIN LATERAL(SELECT json_agg(json_build_object('id',refund.id,'amount',refund.amount::float8,'refundedAt',refund.refunded_at,'reason',refund.reason) ORDER BY refund.refunded_at DESC,refund.id DESC) items FROM payment_refunds refund WHERE refund.tenant_id=transaction.tenant_id AND refund.obligation_id=obligation.id AND refund.source_transaction_id=transaction.id) transaction_refunds ON true":""}
         WHERE allocation.tenant_id=obligation.tenant_id AND allocation.obligation_id=obligation.id) transactions ON true
       ${hasRefunds?"LEFT JOIN LATERAL(SELECT sum(refund.amount) total FROM payment_refunds refund WHERE refund.tenant_id=obligation.tenant_id AND refund.obligation_id=obligation.id) refunds ON true":""}
       LEFT JOIN LATERAL(SELECT json_agg(json_build_object('id',event.id,'type',event.event_type,'at',event.recorded_at,'payload',event.payload) ORDER BY event.recorded_at DESC) items
         FROM payment_events event WHERE event.tenant_id=obligation.tenant_id AND event.obligation_id=obligation.id) events ON true
       WHERE obligation.tenant_id=$1 AND project.archived_at IS NULL AND unit.archived_at IS NULL
        AND app.has_project_permission(obligation.tenant_id,$2,obligation.project_id,'payments.read')
        AND ($3::uuid IS NULL OR obligation.project_id=$3) AND ($4::uuid IS NULL OR obligation.unit_id=$4)
        AND ($5::uuid IS NULL OR obligation.party_id=$5) AND ($6::uuid IS NULL OR obligation.contract_id=$6)
        AND ($7::uuid IS NULL OR obligation.sales_case_id=$7)
        AND ($8::text IS NULL OR app.payment_obligation_status(obligation.tenant_id,obligation.id,now())=$8)
        AND ($9::text IS NULL OR unit.code ILIKE '%'||$9||'%' OR COALESCE(party.display_name,'') ILIKE '%'||$9||'%' OR obligation.label ILIKE '%'||$9||'%')
       ORDER BY ${sort} ${direction},obligation.id ASC`,
       [input.tenantId,input.membershipId,input.projectId??null,input.unitId??null,input.partyId??null,input.contractId??null,input.salesCaseId??null,input.status??null,input.query??null]);
      return {payments:result.rows,source:"postgresql"};
    });
  }
}

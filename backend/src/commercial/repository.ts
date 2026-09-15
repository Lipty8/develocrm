import type { Database } from "../database.js";
import { contractStatusLabel, recommendedContractAction } from "../shared/contract-workflow.js";

export type PriceItem={id:string;unit:string;type:string;amount:number;amountNet?:number;currency:string;validFrom:string;validTo:string|null;reason:string;author:string;approver:string|null};
export type ContractHistoryItem={id:string;fromStatus:string|null;toStatus:string;occurredAt:string;actor:string;note:string;source:"manual"|"automation"|"signature"|"import"};
export type ContractNoteItem={id:string;text:string;author:string;createdAt:string;archivedAt:string|null;archiveReason:string|null};
export type ContractItem={id:string;salesCaseId:string;unit:string;projectId:string;project:string;client:string;type:string;typeCode:string;state:string;statusCode:string;updated:string;updatedAt:string;owner:string;action:string;title:string;reference:string;parentContractId:string|null;parentReference:string|null;assignmentEffectiveAt:string|null;amendmentNumber:number|null;baseContractType:string|null;history:ContractHistoryItem[];notes:ContractNoteItem[];parties:Array<{id:string;partyId:string;name:string;role:string;signatureStatus:string;isCurrent:boolean;effectiveFrom:string;effectiveTo:string|null;assignmentReason:string|null;isPrimaryBuyer:boolean;ownershipShare:number|null}>;versions:Array<{id:string;number:number;name:string;status:string;basedOnVersionId:string|null;source:string;createdAt:string;signedAt:string|null}>};
export type CommercialSnapshot={currentPrices:Record<string,number>;priceBreakdowns:Record<string,{unitPrice:number|null;accessoryPrice:number;totalPrice:number|null}>;priceHistories:Record<string,PriceItem[]>;priceProposals:Array<{id:string;unit:string;priceType:string;currentAmount:number;proposedAmount:number;validFrom:string;reason:string;status:string;proposer:string;decider:string|null}>;contracts:ContractItem[];contractSummary:Record<string,number>};
type Context={tenantId:string;userId:string;membershipId:string};

export class CommercialRepository {
  constructor(private readonly database:Database){}

  async getSnapshot(input:Context&{projectId?:string}):Promise<CommercialSnapshot>{
    return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async(client)=>{
      const prices=await client.query<{id:string;unit:string;type:string;amount:number;amount_net:number|null;currency:string;valid_from:string;valid_to:string|null;reason:string;author:string;approver:string|null}>(
        `SELECT price.id,unit.code unit,price.price_type type,price.amount::float8 amount,price.amount_net::float8 amount_net,price.currency,
          price.valid_from,price.valid_to,price.reason,author.display_name author,approver.display_name approver
         FROM unit_price_intervals price JOIN units unit ON unit.tenant_id=price.tenant_id AND unit.id=price.unit_id
         JOIN tenant_memberships author_membership ON author_membership.tenant_id=price.tenant_id AND author_membership.id=price.recorded_by_membership_id
         JOIN users author ON author.id=author_membership.user_id
         LEFT JOIN tenant_memberships approver_membership ON approver_membership.tenant_id=price.tenant_id AND approver_membership.id=price.approved_by_membership_id
         LEFT JOIN users approver ON approver.id=approver_membership.user_id
         WHERE price.tenant_id=$1 AND unit.archived_at IS NULL
           AND EXISTS(SELECT 1 FROM projects active_project WHERE active_project.tenant_id=price.tenant_id AND active_project.id=price.project_id AND active_project.archived_at IS NULL)
           AND app.has_project_permission(price.tenant_id,$2,price.project_id,'price.read')
           AND ($3::uuid IS NULL OR price.project_id=$3)
         ORDER BY unit.code,price.valid_from DESC,price.recorded_at DESC`,[input.tenantId,input.membershipId,input.projectId??null]);
      const hasBuyerAssignments=Boolean((await client.query("SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='buyer_assignment_events'")).rowCount);
      const hasAssignmentPartyColumns=Boolean((await client.query("SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='contract_parties' AND column_name='is_primary_buyer'")).rowCount);
      const hasContractAssignmentColumns=Boolean((await client.query("SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='contracts' AND column_name='assignment_effective_at'")).rowCount);
      const hasAddendumColumns=Boolean((await client.query("SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='contracts' AND column_name='amendment_number'")).rowCount);
      const hasContractNotes=Boolean((await client.query("SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='contract_notes'")).rowCount);
      const partyProjection=hasBuyerAssignments&&hasAssignmentPartyColumns
        ?`jsonb_build_object('id',participant.id,'partyId',participant.party_id,'name',party.display_name,'role',participant.participant_role,'signatureStatus',participant.signature_status,'isCurrent',participant.effective_to IS NULL,'effectiveFrom',participant.effective_from,'effectiveTo',participant.effective_to,'assignmentReason',assignment.reason,'isPrimaryBuyer',participant.is_primary_buyer,'ownershipShare',participant.ownership_share)`
        :`jsonb_build_object('id',participant.id,'partyId',participant.party_id,'name',party.display_name,'role',participant.participant_role,'signatureStatus',participant.signature_status,'isCurrent',true,'effectiveFrom',participant.created_at,'effectiveTo',NULL,'assignmentReason',NULL,'isPrimaryBuyer',false,'ownershipShare',NULL)`;
      const partyOrder=hasBuyerAssignments?"(participant.effective_to IS NULL) DESC,participant.effective_from DESC,party.display_name":"party.display_name";
      const assignmentJoin=hasBuyerAssignments&&hasAssignmentPartyColumns?"LEFT JOIN buyer_assignment_events assignment ON assignment.tenant_id=participant.tenant_id AND assignment.id=COALESCE(participant.ended_by_assignment_event_id,participant.assignment_event_id)":"";
      const assignmentEffectiveProjection=hasContractAssignmentColumns?"contract.assignment_effective_at":"NULL::timestamptz";
      const addendumProjection=hasAddendumColumns?"contract.amendment_number,contract.base_contract_type":"NULL::integer amendment_number,NULL::text base_contract_type";
      const notesProjection=hasContractNotes?`COALESCE(notes.items,'[]'::jsonb) notes`:`'[]'::jsonb notes`;
      const notesJoin=hasContractNotes?`LEFT JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object('id',note.id,'text',note.text,'author',author.display_name,'createdAt',note.created_at,'archivedAt',note.archived_at,'archiveReason',note.archive_reason) ORDER BY note.created_at DESC,note.id DESC) items
           FROM contract_notes note JOIN users author ON author.id=note.author_user_id
           WHERE note.tenant_id=contract.tenant_id AND note.contract_id=contract.id) notes ON true`:"";
      const contracts=await client.query<{id:string;sales_case_id:string;unit:string;project_id:string;project:string;type:string;status:string;updated_at:string;title:string;reference:string;owner:string;parent_contract_id:string|null;parent_reference:string|null;assignment_effective_at:string|null;amendment_number:number|null;base_contract_type:string|null;parties:ContractItem["parties"];versions:ContractItem["versions"];history:ContractHistoryItem[];notes:ContractNoteItem[]}>(
        `SELECT contract.id,contract.sales_case_id,unit.code unit,contract.project_id,project.name project,contract.contract_type type,contract.current_status status,
          contract.updated_at,contract.title,contract.reference,creator.display_name owner,contract.parent_contract_id,parent_contract.reference parent_reference,${assignmentEffectiveProjection} assignment_effective_at,${addendumProjection},
          COALESCE(parties.items,'[]'::jsonb) parties,COALESCE(versions.items,'[]'::jsonb) versions,
          COALESCE(history.items,'[]'::jsonb) history,${notesProjection}
         FROM contracts contract JOIN units unit ON unit.tenant_id=contract.tenant_id AND unit.id=contract.unit_id
         JOIN projects project ON project.tenant_id=contract.tenant_id AND project.id=contract.project_id
         JOIN tenant_memberships membership ON membership.tenant_id=contract.tenant_id AND membership.id=contract.created_by_membership_id
         JOIN users creator ON creator.id=membership.user_id
         LEFT JOIN contracts parent_contract ON parent_contract.tenant_id=contract.tenant_id AND parent_contract.id=contract.parent_contract_id
         LEFT JOIN LATERAL (SELECT jsonb_agg(${partyProjection} ORDER BY ${partyOrder}) items
           FROM contract_parties participant JOIN parties party ON party.tenant_id=participant.tenant_id AND party.id=participant.party_id
           ${assignmentJoin}
           WHERE participant.tenant_id=contract.tenant_id AND participant.contract_id=contract.id) parties ON true
         LEFT JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object('id',version.id,'number',version.version_number,'name',version.display_name,'status',version.version_status,'basedOnVersionId',version.based_on_version_id,'source',version.source_type,'createdAt',version.created_at,'signedAt',version.signed_at) ORDER BY version.version_number DESC) items
           FROM contract_versions version WHERE version.tenant_id=contract.tenant_id AND version.contract_id=contract.id) versions ON true
         LEFT JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object('id',event.id,'fromStatus',event.from_status,'toStatus',event.to_status,'occurredAt',event.recorded_at,'actor',actor.display_name,'note',event.reason,'source',COALESCE(event.source,'manual')) ORDER BY event.recorded_at DESC,event.id DESC) items
           FROM contract_status_events event
           JOIN tenant_memberships event_membership ON event_membership.tenant_id=event.tenant_id AND event_membership.id=event.recorded_by_membership_id
           JOIN users actor ON actor.id=event_membership.user_id
           WHERE event.tenant_id=contract.tenant_id AND event.contract_id=contract.id) history ON true
         ${notesJoin}
         WHERE contract.tenant_id=$1 AND project.archived_at IS NULL AND unit.archived_at IS NULL
           AND app.has_project_permission(contract.tenant_id,$2,contract.project_id,'contract.read')
           AND ($3::uuid IS NULL OR contract.project_id=$3)
         ORDER BY contract.updated_at DESC`,[input.tenantId,input.membershipId,input.projectId??null]);
      const hasProposalTable=Boolean((await client.query("SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='unit_price_proposals'")).rowCount);
      const proposals=hasProposalTable?await client.query<{id:string;unit:string;price_type:string;current_amount:number;proposed_amount:number;valid_from:string;reason:string;status:string;proposer:string;decider:string|null}>(`SELECT proposal.id,unit.code unit,proposal.price_type,proposal.current_amount::float8 current_amount,proposal.proposed_amount::float8 proposed_amount,proposal.valid_from,proposal.reason,proposal.status,proposer.display_name proposer,decider.display_name decider
        FROM unit_price_proposals proposal JOIN units unit ON unit.tenant_id=proposal.tenant_id AND unit.id=proposal.unit_id
        JOIN tenant_memberships proposer_membership ON proposer_membership.tenant_id=proposal.tenant_id AND proposer_membership.id=proposal.proposed_by_membership_id JOIN users proposer ON proposer.id=proposer_membership.user_id
        LEFT JOIN tenant_memberships decider_membership ON decider_membership.tenant_id=proposal.tenant_id AND decider_membership.id=proposal.decided_by_membership_id LEFT JOIN users decider ON decider.id=decider_membership.user_id
        WHERE proposal.tenant_id=$1 AND unit.archived_at IS NULL
          AND EXISTS(SELECT 1 FROM projects active_project WHERE active_project.tenant_id=proposal.tenant_id AND active_project.id=proposal.project_id AND active_project.archived_at IS NULL)
          AND app.has_project_permission(proposal.tenant_id,$2,proposal.project_id,'prices.read')
          AND ($3::uuid IS NULL OR proposal.project_id=$3) ORDER BY proposal.proposed_at DESC`,[input.tenantId,input.membershipId,input.projectId??null]):{rows:[]};
      const priceHistories:Record<string,PriceItem[]>={};
      for(const row of prices.rows)(priceHistories[row.unit]??=[]).push({id:row.id,unit:row.unit,type:row.type,amount:row.amount,...(row.amount_net===null?{}:{amountNet:row.amount_net}),currency:row.currency,validFrom:row.valid_from,validTo:row.valid_to,reason:row.reason,author:row.author,approver:row.approver});
      const hasAccessoryPriceProjection=Boolean((await client.query("SELECT 1 FROM pg_proc procedure JOIN pg_namespace namespace ON namespace.oid=procedure.pronamespace WHERE namespace.nspname='app' AND procedure.proname='current_unit_accessory_price'")).rowCount);
      const breakdownRows=await client.query<{unit:string;unit_price:number|null;accessory_price:number;total_price:number|null}>(hasAccessoryPriceProjection
        ?`SELECT unit.code unit,
            CASE WHEN EXISTS(SELECT 1 FROM unit_price_history price WHERE price.tenant_id=unit.tenant_id AND price.unit_id=unit.id AND price.valid_from<=now()) THEN app.current_unit_price(unit.tenant_id,unit.id,now())::float8 ELSE NULL END unit_price,
            app.current_unit_accessory_price(unit.tenant_id,unit.id,now())::float8 accessory_price,
            CASE WHEN EXISTS(SELECT 1 FROM unit_price_history price WHERE price.tenant_id=unit.tenant_id AND price.unit_id=unit.id AND price.valid_from<=now()) THEN app.current_unit_sales_price(unit.tenant_id,unit.id,now())::float8 ELSE NULL END total_price
          FROM units unit JOIN projects project ON project.tenant_id=unit.tenant_id AND project.id=unit.project_id
          WHERE unit.tenant_id=$1 AND unit.archived_at IS NULL AND project.archived_at IS NULL
            AND app.has_project_permission(unit.tenant_id,$2,unit.project_id,'price.read') AND ($3::uuid IS NULL OR unit.project_id=$3)`
        :`SELECT unit.code unit,
            CASE WHEN EXISTS(SELECT 1 FROM unit_price_history price WHERE price.tenant_id=unit.tenant_id AND price.unit_id=unit.id AND price.valid_from<=now()) THEN app.current_unit_price(unit.tenant_id,unit.id,now())::float8 ELSE NULL END unit_price,
            0::float8 accessory_price,
            CASE WHEN EXISTS(SELECT 1 FROM unit_price_history price WHERE price.tenant_id=unit.tenant_id AND price.unit_id=unit.id AND price.valid_from<=now()) THEN app.current_unit_price(unit.tenant_id,unit.id,now())::float8 ELSE NULL END total_price
          FROM units unit JOIN projects project ON project.tenant_id=unit.tenant_id AND project.id=unit.project_id
          WHERE unit.tenant_id=$1 AND unit.archived_at IS NULL AND project.archived_at IS NULL
            AND app.has_project_permission(unit.tenant_id,$2,unit.project_id,'price.read') AND ($3::uuid IS NULL OR unit.project_id=$3)`,[input.tenantId,input.membershipId,input.projectId??null]);
      const priceBreakdowns=Object.fromEntries(breakdownRows.rows.map(row=>[row.unit,{unitPrice:row.unit_price,accessoryPrice:row.accessory_price,totalPrice:row.total_price}]));
      const currentPrices=Object.fromEntries(breakdownRows.rows.filter(row=>row.total_price!==null).map(row=>[row.unit,row.total_price as number]));
      const mapped=contracts.rows.map(row=>({id:row.id,salesCaseId:row.sales_case_id,unit:row.unit,projectId:row.project_id,project:row.project,client:row.parties.filter(p=>p.isCurrent&&(['buyer','co_buyer','assignee'].includes(p.role))).map(p=>p.name).join(' a '),type:typeLabel(row.type),typeCode:row.type,state:contractStatusLabel(row.status),statusCode:row.status,updated:row.updated_at,updatedAt:row.updated_at,owner:row.owner.split(' ')[0]??row.owner,action:recommendedContractAction({status:row.status,type:row.type}).label,title:row.title,reference:row.reference,parentContractId:row.parent_contract_id,parentReference:row.parent_reference,assignmentEffectiveAt:row.assignment_effective_at,amendmentNumber:row.amendment_number,baseContractType:row.base_contract_type,history:row.history,notes:row.notes,parties:row.parties,versions:row.versions}));
      const contractSummary=contracts.rows.reduce<Record<string,number>>((sum,row)=>(sum[row.status]=(sum[row.status]??0)+1,sum),{});
      return {currentPrices,priceBreakdowns,priceHistories,priceProposals:proposals.rows.map(row=>({id:row.id,unit:row.unit,priceType:row.price_type,currentAmount:row.current_amount,proposedAmount:row.proposed_amount,validFrom:row.valid_from,reason:row.reason,status:row.status,proposer:row.proposer,decider:row.decider})),contracts:mapped,contractSummary};
    });
  }
}

function typeLabel(type:string){return ({rs:"RS",sbk:"SBK",ks:"KS",amendment:"Dodatek",assignment_rs:"Postoupení RS",assignment_sbk:"Postoupení SBK"} as Record<string,string>)[type]??type;}

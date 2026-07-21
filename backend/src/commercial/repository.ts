import type { Database } from "../database.js";

export type PriceItem={id:string;unit:string;type:string;amount:number;amountNet?:number;currency:string;validFrom:string;validTo:string|null;reason:string;author:string;approver:string|null};
export type ContractItem={id:string;unit:string;project:string;client:string;type:string;state:string;updated:string;owner:string;action:string;title:string;reference:string;parties:Array<{id:string;name:string;role:string;signatureStatus:string}>;versions:Array<{id:string;number:number;name:string;status:string;basedOnVersionId:string|null;source:string;createdAt:string;signedAt:string|null}>};
export type CommercialSnapshot={currentPrices:Record<string,number>;priceHistories:Record<string,PriceItem[]>;contracts:ContractItem[];contractSummary:Record<string,number>};
type Context={tenantId:string;userId:string;membershipId:string};

export class CommercialRepository {
  constructor(private readonly database:Database){}

  async getSnapshot(input:Context):Promise<CommercialSnapshot>{
    return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async(client)=>{
      const prices=await client.query<{id:string;unit:string;type:string;amount:number;amount_net:number|null;currency:string;valid_from:string;valid_to:string|null;reason:string;author:string;approver:string|null}>(
        `SELECT price.id,unit.code unit,price.price_type type,price.amount::float8 amount,price.amount_net::float8 amount_net,price.currency,
          price.valid_from,price.valid_to,price.reason,author.display_name author,approver.display_name approver
         FROM unit_price_intervals price JOIN units unit ON unit.tenant_id=price.tenant_id AND unit.id=price.unit_id
         JOIN tenant_memberships author_membership ON author_membership.tenant_id=price.tenant_id AND author_membership.id=price.recorded_by_membership_id
         JOIN users author ON author.id=author_membership.user_id
         LEFT JOIN tenant_memberships approver_membership ON approver_membership.tenant_id=price.tenant_id AND approver_membership.id=price.approved_by_membership_id
         LEFT JOIN users approver ON approver.id=approver_membership.user_id
         WHERE price.tenant_id=$1 AND app.has_project_permission(price.tenant_id,$2,price.project_id,'price.read')
         ORDER BY unit.code,price.valid_from DESC,price.recorded_at DESC`,[input.tenantId,input.membershipId]);
      const contracts=await client.query<{id:string;unit:string;project:string;type:string;status:string;updated_at:string;title:string;reference:string;owner:string;parties:ContractItem["parties"];versions:ContractItem["versions"]}>(
        `SELECT contract.id,unit.code unit,project.name project,contract.contract_type type,contract.current_status status,
          contract.updated_at,contract.title,contract.reference,creator.display_name owner,
          COALESCE(parties.items,'[]'::jsonb) parties,COALESCE(versions.items,'[]'::jsonb) versions
         FROM contracts contract JOIN units unit ON unit.tenant_id=contract.tenant_id AND unit.id=contract.unit_id
         JOIN projects project ON project.tenant_id=contract.tenant_id AND project.id=contract.project_id
         JOIN tenant_memberships membership ON membership.tenant_id=contract.tenant_id AND membership.id=contract.created_by_membership_id
         JOIN users creator ON creator.id=membership.user_id
         LEFT JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object('id',participant.id,'name',party.display_name,'role',participant.participant_role,'signatureStatus',participant.signature_status) ORDER BY party.display_name) items
           FROM contract_parties participant JOIN parties party ON party.tenant_id=participant.tenant_id AND party.id=participant.party_id
           WHERE participant.tenant_id=contract.tenant_id AND participant.contract_id=contract.id) parties ON true
         LEFT JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object('id',version.id,'number',version.version_number,'name',version.display_name,'status',version.version_status,'basedOnVersionId',version.based_on_version_id,'source',version.source_type,'createdAt',version.created_at,'signedAt',version.signed_at) ORDER BY version.version_number DESC) items
           FROM contract_versions version WHERE version.tenant_id=contract.tenant_id AND version.contract_id=contract.id) versions ON true
         WHERE contract.tenant_id=$1 AND app.has_project_permission(contract.tenant_id,$2,contract.project_id,'contract.read')
         ORDER BY contract.updated_at DESC`,[input.tenantId,input.membershipId]);
      const priceHistories:Record<string,PriceItem[]>={};
      for(const row of prices.rows)(priceHistories[row.unit]??=[]).push({id:row.id,unit:row.unit,type:row.type,amount:row.amount,...(row.amount_net===null?{}:{amountNet:row.amount_net}),currency:row.currency,validFrom:row.valid_from,validTo:row.valid_to,reason:row.reason,author:row.author,approver:row.approver});
      const currentPrices=Object.fromEntries(await Promise.all(Object.keys(priceHistories).map(async unit=>{
        const unitId=(await client.query<{id:string}>("SELECT id FROM units WHERE tenant_id=$1 AND code=$2",[input.tenantId,unit])).rows[0]?.id;
        const amount=unitId?(await client.query<{amount:number}>("SELECT app.current_unit_price($1,$2)::float8 amount",[input.tenantId,unitId])).rows[0]?.amount:0;
        return [unit,amount??0];
      })));
      const mapped=contracts.rows.map(row=>({id:row.id,unit:row.unit,project:row.project,client:row.parties.filter(p=>p.role==='buyer'||p.role==='co_buyer').map(p=>p.name).join(' a '),type:typeLabel(row.type),state:statusLabel(row.status),updated:new Date(row.updated_at).toLocaleDateString('cs-CZ'),owner:row.owner.split(' ')[0]??row.owner,action:actionLabel(row.status),title:row.title,reference:row.reference,parties:row.parties,versions:row.versions}));
      const contractSummary=contracts.rows.reduce<Record<string,number>>((sum,row)=>(sum[row.status]=(sum[row.status]??0)+1,sum),{});
      return {currentPrices,priceHistories,contracts:mapped,contractSummary};
    });
  }
}

function typeLabel(type:string){return ({rs:"RS",sbk:"SBK",ks:"KS",amendment:"Dodatek"} as Record<string,string>)[type]??type;}
function statusLabel(status:string){return ({draft:"V přípravě",sent:"Odeslána",negotiation:"Ve vyjednávání",approved:"Schválena",signing:"K podpisu",signed:"Podepsána",cancelled:"Zrušena",terminated:"Ukončena"} as Record<string,string>)[status]??status;}
function actionLabel(status:string){return ({draft:"Pokračovat v přípravě",sent:"Zkontrolovat reakci",negotiation:"Zapracovat připomínky",approved:"Předat k podpisu",signing:"Zkontrolovat podpisy",signed:"Bez akce",cancelled:"Bez akce",terminated:"Bez akce"} as Record<string,string>)[status]??"Otevřít";}

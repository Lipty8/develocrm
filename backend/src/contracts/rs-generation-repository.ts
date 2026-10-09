import type {Database} from "../database.js";
import type {DocumentContext} from "../documents/repository.js";

export type RsBuyer={id:string;partyType:"individual"|"organization";displayName:string;salutation:string|null;firstName:string|null;lastName:string|null;
  birthDate:string|null;registrationNumber:string|null;address:string|null;email:string|null;phone:string|null;dataBox:string|null};
export type RsAccessory={code:string;type:string;amount:number;floorLabel:string|null;description:string|null};
export type RsSource={contractId:string;projectId:string;projectName:string;projectCode:string;completionYear:string|null;unitId:string;unitCode:string;
  layout:string|null;floorLabel:string|null;areaM2:number;balconyM2:number|null;gardenM2:number|null;unitPrice:number|null;totalPrice:number|null;
  reservationFee:number|null;reservationFeeDueDays:number;reservationPeriodDays:number;settings:null|{name:string;registrationNumber:string;address:string;registryEntry:string;
    representative:string;email:string;dataBox:string;bankAccount:string;bankName:string};salesCaseId:string;reference:string;status:string;buyers:RsBuyer[];accessories:RsAccessory[];
  templateVersionId:string|null;templateHash:string|null;documentId:string|null;documentVersionId:string|null;webUrl:string|null;contractVersion:number|null};

export class RsGenerationRepository{
  constructor(private readonly database:Database){}

  async load(input:DocumentContext&{contractId:string;permission:"contract.read"|"contract.manage"}):Promise<RsSource|null>{
    return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>{
      const row=(await client.query<Record<string,unknown>>(`
        SELECT contract.id contract_id,contract.project_id,project.name project_name,project.code project_code,
          extract(year from project.planned_handover_from)::text completion_year,contract.unit_id,unit.code unit_code,unit.layout,unit.floor_label,
          unit.area_m2,unit.balcony_m2,unit.garden_m2,contract.unit_price_snapshot,contract.total_price_snapshot,
          contract.reservation_fee_amount,contract.reservation_fee_due_days,COALESCE(settings.reservation_period_days,30) reservation_period_days,
          CASE WHEN settings.project_id IS NULL THEN NULL ELSE jsonb_build_object('name',settings.seller_name,'registrationNumber',settings.seller_registration_number,
            'address',settings.seller_address,'registryEntry',settings.seller_registry_entry,'representative',settings.seller_representative,
            'email',settings.seller_email,'dataBox',settings.seller_data_box,'bankAccount',settings.seller_bank_account,'bankName',settings.seller_bank_name) END settings,
          contract.sales_case_id,contract.reference,contract.current_status,
          COALESCE((SELECT jsonb_agg(jsonb_build_object('id',party.id,'partyType',party.party_type,'displayName',party.display_name,
            'salutation',detail.salutation,'firstName',detail.first_name,'lastName',detail.last_name,'birthDate',detail.date_of_birth,
            'registrationNumber',organization.registration_number,
            'address',(SELECT concat_ws(', ',address.line1,NULLIF(address.line2,''),concat_ws(' ',address.postal_code,address.city)) FROM party_addresses address
              WHERE address.tenant_id=party.tenant_id AND address.party_id=party.id AND address.valid_to IS NULL ORDER BY address.is_primary DESC,address.created_at DESC LIMIT 1),
            'email',(SELECT contact.value FROM party_contacts contact WHERE contact.tenant_id=party.tenant_id AND contact.party_id=party.id AND contact.contact_type='email' AND contact.archived_at IS NULL ORDER BY contact.is_primary DESC,contact.created_at LIMIT 1),
            'phone',(SELECT contact.value FROM party_contacts contact WHERE contact.tenant_id=party.tenant_id AND contact.party_id=party.id AND contact.contact_type='phone' AND contact.archived_at IS NULL ORDER BY contact.is_primary DESC,contact.created_at LIMIT 1),
            'dataBox',(SELECT contact.value FROM party_contacts contact WHERE contact.tenant_id=party.tenant_id AND contact.party_id=party.id AND contact.contact_type='data_box' AND contact.archived_at IS NULL ORDER BY contact.is_primary DESC,contact.created_at LIMIT 1))
            ORDER BY contract_party.is_primary_buyer DESC,contract_party.created_at)
            FROM contract_parties contract_party JOIN parties party ON party.tenant_id=contract_party.tenant_id AND party.id=contract_party.party_id
            LEFT JOIN party_individual_details detail ON detail.tenant_id=party.tenant_id AND detail.party_id=party.id
            LEFT JOIN party_organization_details organization ON organization.tenant_id=party.tenant_id AND organization.party_id=party.id
            WHERE contract_party.tenant_id=contract.tenant_id AND contract_party.contract_id=contract.id
              AND contract_party.participant_role IN('buyer','co_buyer') AND contract_party.effective_to IS NULL),'[]'::jsonb) buyers,
          COALESCE((SELECT jsonb_agg(item||jsonb_build_object('floorLabel',accessory.floor_label,'description',accessory.description) ORDER BY item->>'type',item->>'code')
            FROM jsonb_array_elements(contract.accessory_price_snapshot) item LEFT JOIN accessories accessory ON accessory.tenant_id=contract.tenant_id AND accessory.id=(item->>'accessoryId')::uuid),'[]'::jsonb) accessories,
          template_version.id template_version_id,template_version.content_hash template_hash,
          latest.document_id,latest.document_version_id,document.web_url,latest.version_number contract_version
        FROM contracts contract JOIN projects project ON project.tenant_id=contract.tenant_id AND project.id=contract.project_id
        JOIN units unit ON unit.tenant_id=contract.tenant_id AND unit.id=contract.unit_id
        LEFT JOIN project_contract_settings settings ON settings.tenant_id=contract.tenant_id AND settings.project_id=contract.project_id
        LEFT JOIN LATERAL(SELECT version.id,version.content_hash FROM document_template_versions version
          JOIN document_templates template ON template.tenant_id=version.tenant_id AND template.id=version.template_id
          WHERE version.tenant_id=contract.tenant_id AND version.project_id=contract.project_id AND template.contract_type='rs' AND template.status='active'
            AND version.approval_status='approved' AND version.effective_from<=CURRENT_DATE ORDER BY version.effective_from DESC,version.created_at DESC LIMIT 1) template_version ON true
        LEFT JOIN LATERAL(SELECT version.document_id,version.document_version_id,version.version_number FROM contract_versions version
          WHERE version.tenant_id=contract.tenant_id AND version.contract_id=contract.id AND version.document_id IS NOT NULL ORDER BY version.version_number DESC LIMIT 1) latest ON true
        LEFT JOIN documents document ON document.tenant_id=contract.tenant_id AND document.id=latest.document_id
        WHERE contract.tenant_id=$1 AND contract.id=$3 AND contract.contract_type='rs' AND contract.current_status NOT IN('signed','cancelled','terminated')
          AND app.has_project_permission(contract.tenant_id,$2,contract.project_id,$4)`,[input.tenantId,input.membershipId,input.contractId,input.permission])).rows[0];
      return row?mapSource(row):null;
    });
  }

  async bind(input:DocumentContext&{contractId:string;operationId:string;documentId:string;documentVersionId:string;templateVersionId:string;snapshot:Record<string,string>}):Promise<{versionId:string;versionNumber:number}>{
    return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>{
        const existing=(await client.query<{id:string;version_number:number}>(`SELECT id,version_number FROM contract_versions WHERE tenant_id=$1 AND generation_operation_id=$2`,[input.tenantId,input.operationId])).rows[0];
        if(existing)return{versionId:existing.id,versionNumber:existing.version_number};
        const contract=(await client.query<{project_id:string;reference:string}>(`SELECT project_id,reference FROM contracts WHERE tenant_id=$1 AND id=$3 AND contract_type='rs' AND current_status NOT IN('signed','cancelled','terminated')
          AND app.has_project_permission(tenant_id,$2,project_id,'contract.manage') FOR UPDATE`,[input.tenantId,input.membershipId,input.contractId])).rows[0];
        if(!contract)throw new Error("contract.manage permission required");
        const previous=(await client.query<{id:string;version_number:number;source_type:string;document_id:string|null}>(`SELECT id,version_number,source_type,document_id FROM contract_versions WHERE tenant_id=$1 AND contract_id=$2 ORDER BY version_number DESC LIMIT 1 FOR UPDATE`,[input.tenantId,input.contractId])).rows[0];
        let versionId:string;let versionNumber:number;
        if(previous&&previous.version_number===1&&previous.source_type==='manual'&&!previous.document_id){
          const updated=(await client.query<{id:string;version_number:number}>(`UPDATE contract_versions SET source_type='generated',display_name=$3,generation_payload=$4,
            document_id=$5,document_version_id=$6,template_version_id=$7,generation_operation_id=$8
            WHERE tenant_id=$1 AND id=$2 RETURNING id,version_number`,[input.tenantId,previous.id,`${contract.reference}_v01`,input.snapshot,input.documentId,input.documentVersionId,input.templateVersionId,input.operationId])).rows[0];
          versionId=updated.id;versionNumber=updated.version_number;
        }else{
          await client.query(`UPDATE contract_versions SET version_status='superseded' WHERE tenant_id=$1 AND contract_id=$2 AND version_status IN('working','approved_for_signing')`,[input.tenantId,input.contractId]);
          versionNumber=(previous?.version_number??0)+1;
          const created=(await client.query<{id:string}>(`INSERT INTO contract_versions(tenant_id,project_id,contract_id,version_number,based_on_version_id,source_type,display_name,generation_payload,created_by_membership_id,
            document_id,document_version_id,template_version_id,generation_operation_id) VALUES($1,$3,$4,$5,$6,'generated',$7,$8,$2,$9,$10,$11,$12) RETURNING id`,
            [input.tenantId,input.membershipId,contract.project_id,input.contractId,versionNumber,previous?.id??null,`${contract.reference}_v${String(versionNumber).padStart(2,'0')}`,input.snapshot,input.documentId,input.documentVersionId,input.templateVersionId,input.operationId])).rows[0];
          versionId=created.id;
        }
        await client.query(`INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data)
          SELECT $1,m.user_id,'contract.rs_generated','contract_version',$3,jsonb_build_object('contractId',$4::uuid,'documentId',$5::uuid,'documentVersionId',$6::uuid,'templateVersionId',$7::uuid,'versionNumber',$8::integer)
          FROM tenant_memberships m WHERE m.tenant_id=$1 AND m.id=$2`,[input.tenantId,input.membershipId,versionId,input.contractId,input.documentId,input.documentVersionId,input.templateVersionId,versionNumber]);
        await client.query(`INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload) VALUES($1,'contract',$2,'contract.rs_generated.v1',jsonb_build_object('contractId',$2::uuid,'contractVersionId',$3::uuid,'documentId',$4::uuid))`,[input.tenantId,input.contractId,versionId,input.documentId]);
        return{versionId,versionNumber};
    });
  }
}

function mapSource(row:Record<string,unknown>):RsSource{
  const settings=row.settings as Record<string,string>|null;
  return{contractId:String(row.contract_id),projectId:String(row.project_id),projectName:String(row.project_name),projectCode:String(row.project_code),completionYear:row.completion_year?String(row.completion_year):null,
    unitId:String(row.unit_id),unitCode:String(row.unit_code),layout:row.layout?String(row.layout):null,floorLabel:row.floor_label?String(row.floor_label):null,areaM2:Number(row.area_m2),balconyM2:row.balcony_m2==null?null:Number(row.balcony_m2),gardenM2:row.garden_m2==null?null:Number(row.garden_m2),
    unitPrice:row.unit_price_snapshot==null?null:Number(row.unit_price_snapshot),totalPrice:row.total_price_snapshot==null?null:Number(row.total_price_snapshot),reservationFee:row.reservation_fee_amount==null?null:Number(row.reservation_fee_amount),reservationFeeDueDays:Number(row.reservation_fee_due_days),reservationPeriodDays:Number(row.reservation_period_days),
    settings:settings?{name:settings.name,registrationNumber:settings.registrationNumber,address:settings.address,registryEntry:settings.registryEntry,representative:settings.representative,email:settings.email,dataBox:settings.dataBox,bankAccount:settings.bankAccount,bankName:settings.bankName}:null,
    salesCaseId:String(row.sales_case_id),reference:String(row.reference),status:String(row.current_status),buyers:(row.buyers as RsBuyer[])??[],accessories:((row.accessories as Array<Record<string,unknown>>)??[]).map(item=>({code:String(item.code),type:String(item.type),amount:Number(item.amount),floorLabel:item.floorLabel?String(item.floorLabel):null,description:item.description?String(item.description):null})),
    templateVersionId:row.template_version_id?String(row.template_version_id):null,templateHash:row.template_hash?String(row.template_hash):null,documentId:row.document_id?String(row.document_id):null,documentVersionId:row.document_version_id?String(row.document_version_id):null,webUrl:row.web_url?String(row.web_url):null,contractVersion:row.contract_version==null?null:Number(row.contract_version)};
}

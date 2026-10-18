import type {Database} from "../database.js";
import type {DocumentContext} from "../documents/repository.js";
import type {ProjectContractSettings} from '../shared/project-contract-settings.js';

export type RsBuyer={id:string;partyType:"individual"|"organization";displayName:string;salutation:string|null;firstName:string|null;lastName:string|null;
  birthDate:string|null;registrationNumber:string|null;address:string|null;email:string|null;phone:string|null;dataBox:string|null;deliveryAddress?:string|null};
export type RsAccessory={code:string;type:string;amount:number;floorLabel:string|null;description:string|null};
export type RsSource={contractId:string;projectId:string;projectName:string;projectCode:string;completionYear:string|null;unitId:string;unitCode:string;
  contractType?:'rs'|'sbk';floorNumber?:number|null;templateVariant?:string;templateApprovalStatus?:string;approvedTemplateCount?:number;
  variableSymbol?:string|null;signedRsCount?:number;paidReservationFee?:number|null;
  layout:string|null;floorLabel:string|null;areaM2:number;balconyM2:number|null;gardenM2:number|null;unitPrice:number|null;totalPrice:number|null;
  reservationFee:number|null;reservationFeeDueDays:number;reservationPeriodDays:number;settings:null|{name:string;registrationNumber:string;address:string;registryEntry:string;
    representative:string;email:string;dataBox:string;bankAccount:string;bankName:string}&Pick<ProjectContractSettings,'signatureName'|'clientChangesBankAccount'|'deliveryAddress'>;salesCaseId:string;reference:string;status:string;buyers:RsBuyer[];accessories:RsAccessory[];
  caseStatus?:string;terraceM2?:number|null;templateName?:string|null;templateVersionLabel?:string|null;templateEffectiveFrom?:string|null;contractVersionId?:string|null;
  templateVersionId:string|null;templateHash:string|null;documentId:string|null;documentVersionId:string|null;documentMimeType?:string|null;webUrl:string|null;contractVersion:number|null};

export class RsGenerationRepository{
  constructor(private readonly database:Database){}

  async completedGeneration(input:DocumentContext&{contractId:string;idempotencyKey:string}){
    return this.database.withContext(input,async client=>(await client.query<{operationId:string;documentId:string;documentVersionId:string;templateVersionId:string;snapshot:Record<string,string>}>(`
      SELECT g.id "operationId",g.output_document_id "documentId",g.output_document_version_id "documentVersionId",g.template_version_id "templateVersionId",g.generation_snapshot snapshot
      FROM document_generation_operations g JOIN contracts c ON c.tenant_id=g.tenant_id AND c.id=g.contract_id
      WHERE g.tenant_id=$1 AND g.contract_id=$3 AND g.idempotency_key=$4 AND g.state='completed'
        AND app.has_project_permission(c.tenant_id,$2,c.project_id,'contract.manage')`,
      [input.tenantId,input.membershipId,input.contractId,input.idempotencyKey])).rows[0]??null);
  }

  async load(input:DocumentContext&{contractId:string;permission:"contract.read"|"contract.manage"}):Promise<RsSource|null>{
    return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>{
      const row=(await client.query<Record<string,unknown>>(`
        SELECT contract.id contract_id,contract.contract_type,contract.project_id,project.name project_name,project.code project_code,unit.floor_number,
          extract(year from project.planned_handover_from)::text completion_year,contract.unit_id,unit.code unit_code,unit.layout,unit.floor_label,
          unit.area_m2,unit.balcony_m2,unit.terrace_m2,unit.garden_m2,contract.unit_price_snapshot,contract.total_price_snapshot,
          CASE WHEN contract.contract_type='sbk' THEN preceding_rs.reservation_fee_amount ELSE contract.reservation_fee_amount END reservation_fee_amount,
          contract.reservation_fee_due_days,COALESCE(settings.reservation_period_days,30) reservation_period_days,
          preceding_rs.signed_count,preceding_rs.paid_reservation_fee,
          (SELECT CASE WHEN count(DISTINCT NULLIF(btrim(obligation.variable_symbol),''))=1 THEN min(NULLIF(btrim(obligation.variable_symbol),'')) END
             FROM payment_obligations obligation WHERE obligation.tenant_id=contract.tenant_id AND obligation.contract_id=contract.id
               AND obligation.project_id=contract.project_id AND obligation.sales_case_id=contract.sales_case_id AND obligation.cancelled_at IS NULL) variable_symbol,
          CASE WHEN settings.project_id IS NULL THEN NULL ELSE jsonb_build_object('name',settings.seller_name,'registrationNumber',settings.seller_registration_number,
            'address',settings.seller_address,'registryEntry',settings.seller_registry_entry,'representative',settings.seller_representative,
            'email',settings.seller_email,'dataBox',settings.seller_data_box,'bankAccount',settings.seller_bank_account,'bankName',settings.seller_bank_name,
            'signatureName',to_jsonb(settings)->>'seller_signature_name','clientChangesBankAccount',to_jsonb(settings)->>'seller_client_changes_bank_account','deliveryAddress',to_jsonb(settings)->>'seller_delivery_address') END settings,
          contract.sales_case_id,sales_case.status case_status,contract.reference,contract.current_status,
          COALESCE((SELECT jsonb_agg(jsonb_build_object('id',party.id,'partyType',party.party_type,'displayName',party.display_name,
            'salutation',detail.salutation,'firstName',detail.first_name,'lastName',detail.last_name,'birthDate',detail.date_of_birth,
            'registrationNumber',organization.registration_number,
            'address',(SELECT concat_ws(', ',address.line1,NULLIF(address.line2,''),concat_ws(' ',address.postal_code,address.city)) FROM party_addresses address
              WHERE address.tenant_id=party.tenant_id AND address.party_id=party.id AND address.valid_to IS NULL
                AND address.address_type=CASE WHEN party.party_type='individual' THEN 'residence' ELSE 'registered_office' END
                AND length(btrim(address.line1))>0 AND length(btrim(address.city))>0
                ORDER BY address.is_primary DESC,address.created_at DESC LIMIT 1),
            'deliveryAddress',(SELECT concat_ws(', ',address.line1,NULLIF(address.line2,''),concat_ws(' ',address.postal_code,address.city)) FROM party_addresses address
              WHERE address.tenant_id=party.tenant_id AND address.party_id=party.id AND address.valid_to IS NULL AND address.address_type='correspondence'
                AND length(btrim(address.line1))>0 AND length(btrim(address.city))>0
                ORDER BY address.is_primary DESC,address.created_at DESC LIMIT 1),
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
          template_version.id template_version_id,template_version.content_hash template_hash,template_version.name template_name,template_version.version_label,template_version.effective_from,
          template_version.variant_key,template_version.approval_status,template_version.approved_count,
          latest.id contract_version_id,latest.document_id,latest.document_version_id,document.mime_type document_mime_type,document.web_url,latest.version_number contract_version
        FROM contracts contract JOIN projects project ON project.tenant_id=contract.tenant_id AND project.id=contract.project_id
        JOIN units unit ON unit.tenant_id=contract.tenant_id AND unit.id=contract.unit_id
        JOIN sales_cases sales_case ON sales_case.tenant_id=contract.tenant_id AND sales_case.id=contract.sales_case_id AND sales_case.unit_id=contract.unit_id AND sales_case.project_id=contract.project_id
        LEFT JOIN project_contract_settings settings ON settings.tenant_id=contract.tenant_id AND settings.project_id=contract.project_id
        LEFT JOIN LATERAL(SELECT count(*) signed_count,max(rs.reservation_fee_amount) reservation_fee_amount,
          sum((SELECT COALESCE(sum(app.payment_obligation_paid(obligation.tenant_id,obligation.id)),0) FROM payment_obligations obligation
            WHERE obligation.tenant_id=rs.tenant_id AND obligation.contract_id=rs.id AND obligation.obligation_type='reservation_fee' AND obligation.cancelled_at IS NULL)) paid_reservation_fee
          FROM contracts rs WHERE rs.tenant_id=contract.tenant_id AND rs.project_id=contract.project_id AND rs.unit_id=contract.unit_id
            AND rs.sales_case_id=contract.sales_case_id AND rs.contract_type='rs' AND rs.current_status='signed') preceding_rs ON true
        LEFT JOIN LATERAL(SELECT version.id,version.content_hash,template.name,version.version_label,version.effective_from,template.variant_key,version.approval_status,
          count(*) FILTER(WHERE version.approval_status='approved' AND version.effective_from<=CURRENT_DATE) OVER() approved_count
          FROM document_template_versions version
          JOIN document_templates template ON template.tenant_id=version.tenant_id AND template.id=version.template_id
          WHERE version.tenant_id=contract.tenant_id AND version.project_id=contract.project_id AND template.contract_type=contract.contract_type
            AND template.variant_key IN ('default','dejvice-original-dob-full-v1') AND template.status='active'
            AND version.approval_status IN ('draft','validated','approved')
          ORDER BY (version.approval_status='approved' AND version.effective_from<=CURRENT_DATE) DESC,
            version.effective_from DESC,version.created_at DESC,version.id DESC LIMIT 1) template_version ON true
        LEFT JOIN LATERAL(SELECT version.id,version.document_id,version.document_version_id,version.version_number FROM contract_versions version
          WHERE version.tenant_id=contract.tenant_id AND version.contract_id=contract.id AND version.document_id IS NOT NULL ORDER BY version.version_number DESC LIMIT 1) latest ON true
        LEFT JOIN documents document ON document.tenant_id=contract.tenant_id AND document.id=latest.document_id
        WHERE contract.tenant_id=$1 AND contract.id=$3 AND contract.contract_type IN ('rs','sbk') AND contract.current_status NOT IN('signed','cancelled','terminated')
          AND app.has_project_permission(contract.tenant_id,$2,contract.project_id,$4)`,[input.tenantId,input.membershipId,input.contractId,input.permission])).rows[0];
      return row?mapSource(row):null;
    });
  }

  async bind(input:DocumentContext&{contractId:string;operationId:string;documentId:string;documentVersionId:string;templateVersionId:string;snapshot:Record<string,string>}):Promise<{versionId:string;versionNumber:number}>{
    return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>{
        await client.query("SELECT app.lock_workflow_unit($1,(SELECT unit_id FROM contracts WHERE tenant_id=$1 AND id=$2))",[input.tenantId,input.contractId]);
        const existing=(await client.query<{id:string;version_number:number}>(`SELECT id,version_number FROM contract_versions WHERE tenant_id=$1 AND generation_operation_id=$2`,[input.tenantId,input.operationId])).rows[0];
        if(existing)return{versionId:existing.id,versionNumber:existing.version_number};
        const contract=(await client.query<{project_id:string;reference:string;current_status:string}>(`SELECT project_id,reference,current_status FROM contracts WHERE tenant_id=$1 AND id=$3 AND contract_type='rs' AND current_status NOT IN('signed','cancelled','terminated')
          AND app.has_project_permission(tenant_id,$2,project_id,'contract.manage')
          AND EXISTS(SELECT 1 FROM sales_cases s WHERE s.tenant_id=contracts.tenant_id AND s.id=contracts.sales_case_id AND s.status='active' AND s.closed_at IS NULL) FOR UPDATE`,[input.tenantId,input.membershipId,input.contractId])).rows[0];
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
        if(['approved','signing'].includes(contract.current_status)){
          await client.query("SELECT set_config('app.contract_status_command','on',true)");
          await client.query("UPDATE contracts SET current_status='draft' WHERE tenant_id=$1 AND id=$2",[input.tenantId,input.contractId]);
          await client.query(`INSERT INTO contract_status_events(tenant_id,project_id,contract_id,from_status,to_status,command,reason,recorded_by_membership_id,source)
            VALUES($1,$2,$3,$4,'draft','documentRegenerated','Nová verze dokumentu vyžaduje schválení',$5,'automation')`,[input.tenantId,contract.project_id,input.contractId,contract.current_status,input.membershipId]);
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
    settings:settings?{name:settings.name,registrationNumber:settings.registrationNumber,address:settings.address,registryEntry:settings.registryEntry,representative:settings.representative,email:settings.email,dataBox:settings.dataBox,bankAccount:settings.bankAccount,bankName:settings.bankName,
      signatureName:settings.signatureName??undefined,clientChangesBankAccount:settings.clientChangesBankAccount??undefined,deliveryAddress:settings.deliveryAddress??undefined}:null,
    contractType:row.contract_type==='sbk'?'sbk':'rs',floorNumber:row.floor_number==null?null:Number(row.floor_number),templateVariant:row.variant_key?String(row.variant_key):'default',templateApprovalStatus:row.approval_status?String(row.approval_status):undefined,approvedTemplateCount:Number(row.approved_count??0),
    signedRsCount:Number(row.signed_count??0),paidReservationFee:row.paid_reservation_fee==null?null:Number(row.paid_reservation_fee),variableSymbol:row.variable_symbol?String(row.variable_symbol):null,
    caseStatus:row.case_status?String(row.case_status):undefined,terraceM2:row.terrace_m2==null?null:Number(row.terrace_m2),templateName:row.template_name?String(row.template_name):null,templateVersionLabel:row.version_label?String(row.version_label):null,templateEffectiveFrom:row.effective_from?String(row.effective_from):null,contractVersionId:row.contract_version_id?String(row.contract_version_id):null,
    salesCaseId:String(row.sales_case_id),reference:String(row.reference),status:String(row.current_status),buyers:(row.buyers as RsBuyer[])??[],accessories:((row.accessories as Array<Record<string,unknown>>)??[]).map(item=>({code:String(item.code),type:String(item.type),amount:Number(item.amount),floorLabel:item.floorLabel?String(item.floorLabel):null,description:item.description?String(item.description):null})),
    templateVersionId:row.template_version_id?String(row.template_version_id):null,templateHash:row.template_hash?String(row.template_hash):null,documentMimeType:row.document_mime_type?String(row.document_mime_type):null,documentId:row.document_id?String(row.document_id):null,documentVersionId:row.document_version_id?String(row.document_version_id):null,webUrl:row.web_url?String(row.web_url):null,contractVersion:row.contract_version==null?null:Number(row.contract_version)};
}

import type {SqlClient} from '../database.js';
import {isOriginalContractVariant} from '../documents/template-catalog.js';

/** One selection for preparation, creation and generation. The outer query
 * supplies an authorized `contract` alias with tenant/project/type. */
export const projectContractTemplateSelectionSql=`SELECT version.id,version.content_hash,template.name,version.version_label,version.effective_from,template.variant_key,version.approval_status,
  count(*) FILTER(WHERE version.approval_status='approved' AND version.effective_from<=CURRENT_DATE) OVER() approved_count
  FROM document_template_versions version
  JOIN document_templates template ON template.tenant_id=version.tenant_id AND template.id=version.template_id
  WHERE version.tenant_id=contract.tenant_id AND version.project_id=contract.project_id AND template.contract_type=contract.contract_type
    AND template.variant_key IN ('default','dejvice-original-dob-full-v1','dejvice-original-dob-delivery-v2') AND template.status='active'
    AND version.approval_status IN ('draft','validated','approved')
  ORDER BY (version.approval_status='approved' AND version.effective_from<=CURRENT_DATE) DESC,
    version.effective_from DESC,version.created_at DESC,version.id DESC LIMIT 1`;

export type ContractPaymentTiming='fixed_date'|'signature';
export async function projectContractPaymentTimings(client:SqlClient,input:{tenantId:string;projectId:string;membershipId:string}):Promise<Record<'rs'|'sbk',ContractPaymentTiming|null>>{
  const rows=(await client.query<{contract_type:'rs'|'sbk';variant_key:string|null;approved_count:string|number|null}>(`
    SELECT contract.contract_type,selection.variant_key,selection.approved_count
    FROM (SELECT $1::uuid tenant_id,$2::uuid project_id,unnest(ARRAY['rs','sbk']) contract_type) contract
    LEFT JOIN LATERAL(${projectContractTemplateSelectionSql}) selection ON true
    WHERE app.has_project_permission(contract.tenant_id,$3,contract.project_id,'contract.read')`,
    [input.tenantId,input.projectId,input.membershipId])).rows;
  if(rows.length!==2)throw new Error('contract.read permission required');
  const result:Record<'rs'|'sbk',ContractPaymentTiming|null>={rs:'fixed_date',sbk:'fixed_date'};
  for(const row of rows){
    result[row.contract_type]=Number(row.approved_count??0)>1?null:isOriginalContractVariant(row.variant_key)?'signature':'fixed_date';
  }
  return result;
}

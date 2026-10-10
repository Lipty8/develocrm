import type {Database} from "../database.js";
import type {DocumentContext} from "./repository.js";
import type {PlaceholderSchema} from "./template-generation-repository.js";

type TemplateContext=DocumentContext&{correlationId?:string};

export type TemplateLifecycle="draft"|"validated"|"approved"|"retired";
export type TemplateValidationReport={valid:boolean;tokens:string[];unknownTokens:string[];missingTokens:string[];malformedTokens:string[];legacyMarkers:string[];errors:string[]};
export type TemplateVersionView={id:string;versionLabel:string;contentHash:string;schema:PlaceholderSchema;status:TemplateLifecycle;effectiveFrom:string;
  validation:TemplateValidationReport;createdAt:string;validatedAt:string|null;approvedAt:string|null;retiredAt:string|null;actor:string|null;
  sourceDocumentId:string;sourceDocumentVersionId:string;sourceWebUrl:string|null;sourceFileName:string;externalVersionId:string|null;driveId:string;itemId:string};
export type TemplateView={id:string;projectId:string;projectName:string;code:string;name:string;outputTypeCode:string;contractType:string|null;variantKey:string;status:string;
  canManage:boolean;canApprove:boolean;versions:TemplateVersionView[]};

type TemplateRow=Record<string,unknown>;
export class DocumentTemplateManagementRepository{
  constructor(private readonly database:Database){}

  async list(input:TemplateContext&{projectId?:string;outputTypeCode?:string;templateId?:string}):Promise<TemplateView[]>{
    return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>{
      const rows=(await client.query<TemplateRow>(`SELECT t.id template_id,t.project_id,p.name project_name,t.code,t.name,t.output_type_code,t.contract_type,t.variant_key,t.status template_status,
          tv.id version_id,tv.version_label,tv.content_hash,tv.placeholder_schema,tv.approval_status,tv.effective_from,tv.validation_result,
          tv.created_at,tv.validated_at,tv.approved_at,tv.retired_at,u.display_name actor,d.id source_document_id,d.name source_file_name,d.web_url,
          d.external_drive_id,d.external_item_id,dv.id source_document_version_id,dv.external_version_id,
          app.has_project_permission(t.tenant_id,$2,t.project_id,'documents.upload') can_manage,
          app.has_project_permission(t.tenant_id,$2,t.project_id,'documents.review') can_approve
        FROM document_templates t JOIN projects p ON p.tenant_id=t.tenant_id AND p.id=t.project_id
        LEFT JOIN document_template_versions tv ON tv.tenant_id=t.tenant_id AND tv.template_id=t.id
        LEFT JOIN documents d ON d.tenant_id=tv.tenant_id AND d.id=tv.source_document_id
        LEFT JOIN document_versions dv ON dv.tenant_id=tv.tenant_id AND dv.id=tv.source_document_version_id
        LEFT JOIN tenant_memberships m ON m.tenant_id=tv.tenant_id AND m.id=tv.created_by_membership_id
        LEFT JOIN users u ON u.id=m.user_id
        WHERE t.tenant_id=$1 AND app.has_project_permission(t.tenant_id,$2,t.project_id,'documents.view')
          AND ($3::uuid IS NULL OR t.project_id=$3) AND ($4::text IS NULL OR t.output_type_code=$4) AND ($5::uuid IS NULL OR t.id=$5)
        ORDER BY p.name,t.name,tv.created_at DESC`,[input.tenantId,input.membershipId,input.projectId??null,input.outputTypeCode??null,input.templateId??null])).rows;
      return groupRows(rows);
    });
  }

  async assertUploadAllowed(input:TemplateContext&{projectId:string;code:string;outputTypeCode:string;contractType:string|null;variantKey:string}):Promise<void>{
    await this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>{
      const allowed=(await client.query<{allowed:boolean}>(`SELECT app.has_project_permission($1,$2,$3,'documents.upload') allowed`,[input.tenantId,input.membershipId,input.projectId])).rows[0]?.allowed;
      if(!allowed)throw new Error("documents.upload permission required");
      const existing=(await client.query<{output_type_code:string;contract_type:string|null;variant_key:string}>(`SELECT output_type_code,contract_type,variant_key FROM document_templates
        WHERE tenant_id=$1 AND project_id=$2 AND code=$3`,[input.tenantId,input.projectId,input.code])).rows[0];
      if(existing&&(existing.output_type_code!==input.outputTypeCode||existing.contract_type!==input.contractType||existing.variant_key!==input.variantKey))throw new Error("template metadata conflict");
    });
  }

  async createDraft(input:TemplateContext&{projectId:string;code:string;name:string;outputTypeCode:string;contractType:string|null;variantKey:string;versionLabel:string;
    sourceDocumentId:string;sourceDocumentVersionId:string;contentHash:string;schema:PlaceholderSchema;effectiveFrom:string;validation:TemplateValidationReport}):Promise<{templateId:string;templateVersionId:string;replayed:boolean}>{
    return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>{
      const template=(await client.query<{id:string}>(`INSERT INTO document_templates AS existing(tenant_id,project_id,code,name,output_type_code,contract_type,variant_key,created_by_membership_id)
        SELECT $1,$3,$4,$5,$6,$7,$8,$2 WHERE app.has_project_permission($1,$2,$3,'documents.upload')
        ON CONFLICT(tenant_id,project_id,code) DO UPDATE SET name=EXCLUDED.name,status='active'
          WHERE existing.output_type_code=EXCLUDED.output_type_code
            AND existing.contract_type IS NOT DISTINCT FROM EXCLUDED.contract_type
            AND existing.variant_key=EXCLUDED.variant_key
        RETURNING id`,[input.tenantId,input.membershipId,input.projectId,input.code,input.name,input.outputTypeCode,input.contractType,input.variantKey])).rows[0];
      if(!template)throw new Error("documents.upload permission required or template metadata conflict");
      let version=(await client.query<{id:string}>(`INSERT INTO document_template_versions(tenant_id,project_id,template_id,source_document_id,source_document_version_id,
          version_label,content_hash,placeholder_schema,approval_status,effective_from,validation_result,created_by_membership_id)
        VALUES($1,$3,$4,$5,$6,$7,$8,$9,'draft',$10,$11,$2)
        ON CONFLICT(tenant_id,template_id,version_label) DO NOTHING RETURNING id`,[input.tenantId,input.membershipId,input.projectId,template.id,input.sourceDocumentId,input.sourceDocumentVersionId,input.versionLabel,input.contentHash,input.schema,input.effectiveFrom,input.validation])).rows[0];
      let replayed=false;
      if(!version){version=(await client.query<{id:string}>(`SELECT id FROM document_template_versions WHERE tenant_id=$1 AND template_id=$2 AND version_label=$3
          AND source_document_id=$4 AND source_document_version_id=$5 AND content_hash=$6`,[input.tenantId,template.id,input.versionLabel,input.sourceDocumentId,input.sourceDocumentVersionId,input.contentHash])).rows[0];
        if(!version)throw new Error("template version conflict");replayed=true;}
      if(!replayed){const versionCount=Number((await client.query<{count:string}>(`SELECT count(*)::text count FROM document_template_versions WHERE tenant_id=$1 AND template_id=$2`,[input.tenantId,template.id])).rows[0]?.count??0);
        if(versionCount===1)await this.audit(client,input,"document_template.created",template.id,{projectId:input.projectId,templateId:template.id,contentHash:input.contentHash});
        await this.audit(client,input,"document_template.version_uploaded",version.id,{projectId:input.projectId,templateId:template.id,contentHash:input.contentHash,valid:input.validation.valid});}
      return{templateId:template.id,templateVersionId:version.id,replayed};
    });
  }

  async source(input:TemplateContext&{templateId:string;versionId:string;permission:"documents.view"|"documents.upload"}):Promise<TemplateVersionView|null>{
    const templates=await this.list({...input,templateId:input.templateId});
    const template=templates[0];if(!template)return null;
    if(input.permission==="documents.upload"&&!template.canManage)return null;
    return template.versions.find(version=>version.id===input.versionId)??null;
  }

  async recordValidation(input:TemplateContext&{templateId:string;versionId:string;contentHash:string;validation:TemplateValidationReport}):Promise<void>{
    await this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>{
      const current=(await client.query<{approval_status:TemplateLifecycle;validation_result:TemplateValidationReport}>(`SELECT approval_status,validation_result FROM document_template_versions
        WHERE tenant_id=$1 AND template_id=$3 AND id=$4 AND app.has_project_permission(tenant_id,$2,project_id,'documents.upload')`,[input.tenantId,input.membershipId,input.templateId,input.versionId])).rows[0];
      if(current?.approval_status==="validated"&&JSON.stringify(current.validation_result)===JSON.stringify(input.validation))return;
      if(!current||current.approval_status!=="draft")throw new Error("draft template version not found or documents.upload permission required");
      const result=await client.query(`UPDATE document_template_versions tv SET validation_result=$5,
          approval_status=CASE WHEN ($5->>'valid')::boolean THEN 'validated' ELSE 'draft' END,
          validated_at=CASE WHEN ($5->>'valid')::boolean THEN now() ELSE NULL END,
          validated_by_membership_id=CASE WHEN ($5->>'valid')::boolean THEN $2 ELSE NULL END
        FROM document_templates t WHERE tv.tenant_id=$1 AND tv.id=$4 AND tv.template_id=$3 AND t.tenant_id=tv.tenant_id AND t.id=tv.template_id
          AND tv.approval_status='draft' AND app.has_project_permission(tv.tenant_id,$2,tv.project_id,'documents.upload')`,
        [input.tenantId,input.membershipId,input.templateId,input.versionId,input.validation]);
      if(!result.rowCount)throw new Error("draft template version not found or documents.upload permission required");
      await this.audit(client,input,input.validation.valid?"document_template.version_validated":"document_template.validation_failed",input.versionId,{templateId:input.templateId,contentHash:input.contentHash,valid:input.validation.valid,errors:input.validation.errors});
    });
  }

  async approve(input:TemplateContext&{templateId:string;versionId:string}):Promise<void>{
    await this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>{
      const target=(await client.query<{project_id:string;content_hash:string;approval_status:TemplateLifecycle}>(`SELECT tv.project_id,tv.content_hash,tv.approval_status FROM document_template_versions tv
        WHERE tv.tenant_id=$1 AND tv.template_id=$3 AND tv.id=$4
          AND app.has_project_permission(tv.tenant_id,$2,tv.project_id,'documents.review') FOR UPDATE`,[input.tenantId,input.membershipId,input.templateId,input.versionId])).rows[0];
      if(target?.approval_status==="approved")return;
      if(!target||target.approval_status!=="validated")throw new Error("validated template version not found or documents.review permission required");
      await client.query(`UPDATE document_template_versions SET approval_status='retired',retired_at=now(),retired_by_membership_id=$2
        WHERE tenant_id=$1 AND template_id=$3 AND approval_status='approved' AND id<>$4`,[input.tenantId,input.membershipId,input.templateId,input.versionId]);
      await client.query(`UPDATE document_template_versions SET approval_status='approved',approved_at=now(),approved_by_membership_id=$2
        WHERE tenant_id=$1 AND template_id=$3 AND id=$4 AND approval_status='validated'`,[input.tenantId,input.membershipId,input.templateId,input.versionId]);
      await this.audit(client,input,"document_template.version_approved",input.versionId,{templateId:input.templateId,contentHash:target.content_hash});
      await client.query(`INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
        VALUES($1,'document_template',$2,'document_template.version_approved.v1',jsonb_build_object('templateId',$2::uuid,'versionId',$3::uuid))`,[input.tenantId,input.templateId,input.versionId]);
    });
  }

  async retire(input:TemplateContext&{templateId:string;versionId:string}):Promise<void>{
    await this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>{
      const current=(await client.query<{approval_status:TemplateLifecycle;content_hash:string}>(`SELECT approval_status,content_hash FROM document_template_versions
        WHERE tenant_id=$1 AND template_id=$3 AND id=$4 AND app.has_project_permission(tenant_id,$2,project_id,'documents.review') FOR UPDATE`,[input.tenantId,input.membershipId,input.templateId,input.versionId])).rows[0];
      if(current?.approval_status==="retired")return;
      if(!current)throw new Error("template version not found or documents.review permission required");
      const result=await client.query(`UPDATE document_template_versions tv SET approval_status='retired',retired_at=now(),retired_by_membership_id=$2
        FROM document_templates t WHERE tv.tenant_id=$1 AND tv.template_id=$3 AND tv.id=$4 AND tv.approval_status<>'retired'
          AND t.tenant_id=tv.tenant_id AND t.id=tv.template_id AND app.has_project_permission(tv.tenant_id,$2,tv.project_id,'documents.review')`,
        [input.tenantId,input.membershipId,input.templateId,input.versionId]);
      if(!result.rowCount)throw new Error("template version not found or documents.review permission required");
      await this.audit(client,input,"document_template.version_retired",input.versionId,{templateId:input.templateId,contentHash:current.content_hash});
      await client.query(`INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
        VALUES($1,'document_template',$2,'document_template.version_retired.v1',jsonb_build_object('templateId',$2::uuid,'versionId',$3::uuid))`,[input.tenantId,input.templateId,input.versionId]);
    });
  }

  async auditFailure(input:TemplateContext&{projectId:string;action:string;details:Record<string,unknown>}):Promise<void>{
    await this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>this.audit(client,input,input.action,input.projectId,input.details));
  }

  private async audit(client:{query:(sql:string,values?:unknown[])=>Promise<unknown>},input:TemplateContext,action:string,entityId:string,afterData:Record<string,unknown>):Promise<void>{
    await client.query(`INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data)
      SELECT $1,m.user_id,$3,'document_template_version',$4,$5 FROM tenant_memberships m WHERE m.tenant_id=$1 AND m.id=$2`,
      [input.tenantId,input.membershipId,action,entityId,{...afterData,correlationId:input.correlationId??null}]);
  }
}

function groupRows(rows:TemplateRow[]):TemplateView[]{const result=new Map<string,TemplateView>();for(const row of rows){const id=String(row.template_id);let template=result.get(id);if(!template){template={id,projectId:String(row.project_id),projectName:String(row.project_name),code:String(row.code),name:String(row.name),outputTypeCode:String(row.output_type_code),contractType:row.contract_type?String(row.contract_type):null,variantKey:String(row.variant_key),status:String(row.template_status),canManage:Boolean(row.can_manage),canApprove:Boolean(row.can_approve),versions:[]};result.set(id,template);}if(row.version_id)template.versions.push({id:String(row.version_id),versionLabel:String(row.version_label),contentHash:String(row.content_hash),schema:row.placeholder_schema as PlaceholderSchema,status:String(row.approval_status) as TemplateLifecycle,effectiveFrom:String(row.effective_from),validation:row.validation_result as TemplateValidationReport,createdAt:String(row.created_at),validatedAt:stringOrNull(row.validated_at),approvedAt:stringOrNull(row.approved_at),retiredAt:stringOrNull(row.retired_at),actor:stringOrNull(row.actor),sourceDocumentId:String(row.source_document_id),sourceDocumentVersionId:String(row.source_document_version_id),sourceWebUrl:stringOrNull(row.web_url),sourceFileName:String(row.source_file_name),externalVersionId:stringOrNull(row.external_version_id),driveId:String(row.external_drive_id),itemId:String(row.external_item_id)});}return[...result.values()];}
function stringOrNull(value:unknown):string|null{return value==null?null:String(value);}

import type { Database } from "../database.js";
import type { DocumentContext } from "./repository.js";

export type PlaceholderSchema={fields:Record<string,{required:boolean}>};
export type TemplateSource={templateId:string;templateVersionId:string;projectId:string;templateCode:string;templateName:string;outputTypeCode:string;
  versionLabel:string;contentHash:string;schema:PlaceholderSchema;driveId:string;itemId:string;externalVersionId:string|null};
export type GenerationOperation={id:string;state:"reserved"|"completed";projectId:string;template:TemplateSource;snapshot:Record<string,string>;
  outputDocumentId:string|null;outputDocumentVersionId:string|null;unitId:string|null;partyId:string|null;salesCaseId:string|null;contractId:string|null;createdAt:string};

export class DocumentTemplateGenerationRepository{
  constructor(private readonly database:Database){}

  async sourceForRegistration(input:DocumentContext&{projectId:string;sourceDocumentId:string;sourceDocumentVersionId:string}):Promise<Omit<TemplateSource,"templateId"|"templateVersionId"|"templateCode"|"templateName"|"outputTypeCode"|"versionLabel"|"schema">|null>{
    return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>{
      const row=(await client.query<{project_id:string;external_drive_id:string;external_item_id:string;external_version_id:string|null;content_hash:string}>(`
        SELECT d.project_id,d.external_drive_id,d.external_item_id,v.external_version_id,v.content_hash
        FROM documents d JOIN document_versions v ON v.tenant_id=d.tenant_id AND v.project_id=d.project_id AND v.document_id=d.id
        WHERE d.tenant_id=$1 AND d.project_id=$3 AND d.id=$4 AND v.id=$5 AND d.storage_provider='sharepoint' AND d.archived_at IS NULL
          AND app.has_project_permission(d.tenant_id,$2,d.project_id,'documents.upload')`,[input.tenantId,input.membershipId,input.projectId,input.sourceDocumentId,input.sourceDocumentVersionId])).rows[0];
      return row?{projectId:row.project_id,driveId:row.external_drive_id,itemId:row.external_item_id,externalVersionId:row.external_version_id,contentHash:row.content_hash}:null;
    });
  }

  async register(input:DocumentContext&{projectId:string;code:string;name:string;outputTypeCode:string;versionLabel:string;sourceDocumentId:string;sourceDocumentVersionId:string;contentHash:string;schema:PlaceholderSchema}):Promise<{templateId:string;templateVersionId:string}>{
    return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>{
      const template=(await client.query<{id:string}>(`INSERT INTO document_templates(tenant_id,project_id,code,name,output_type_code,created_by_membership_id)
        SELECT $1::uuid,$3::uuid,$4::text,$5::text,$6::text,$2::uuid
        WHERE app.has_project_permission($1::uuid,$2::uuid,$3::uuid,'documents.upload')
        ON CONFLICT(tenant_id,project_id,code) DO UPDATE SET name=EXCLUDED.name
        RETURNING id`,[input.tenantId,input.membershipId,input.projectId,input.code,input.name,input.outputTypeCode])).rows[0];
      if(!template)throw new Error("documents.upload permission required");
      const version=(await client.query<{id:string}>(`INSERT INTO document_template_versions(tenant_id,project_id,template_id,source_document_id,source_document_version_id,version_label,content_hash,placeholder_schema,created_by_membership_id)
        VALUES($1,$3,$4,$5,$6,$7,$8,$9,$2) RETURNING id`,[input.tenantId,input.membershipId,input.projectId,template.id,input.sourceDocumentId,input.sourceDocumentVersionId,input.versionLabel,input.contentHash,input.schema])).rows[0];
      await client.query(`INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data)
        SELECT $1,m.user_id,'document_template.version_registered','document_template_version',$3,
          jsonb_build_object('projectId',$4::uuid,'templateId',$5::uuid,'contentHash',$6::text)
        FROM tenant_memberships m WHERE m.tenant_id=$1 AND m.id=$2`,[input.tenantId,input.membershipId,version.id,input.projectId,template.id,input.contentHash]);
      return{templateId:template.id,templateVersionId:version.id};
    });
  }

  async getTemplate(input:DocumentContext&{templateVersionId:string;projectId:string}):Promise<TemplateSource|null>{
    return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>{
      const row=(await client.query<Record<string,unknown>>(`SELECT t.id template_id,tv.id template_version_id,t.project_id,t.code,t.name,t.output_type_code,
          tv.version_label,tv.content_hash,tv.placeholder_schema,d.external_drive_id,d.external_item_id,v.external_version_id
        FROM document_template_versions tv JOIN document_templates t ON t.tenant_id=tv.tenant_id AND t.id=tv.template_id
        JOIN documents d ON d.tenant_id=tv.tenant_id AND d.project_id=tv.project_id AND d.id=tv.source_document_id
        JOIN document_versions v ON v.tenant_id=tv.tenant_id AND v.id=tv.source_document_version_id
        WHERE tv.tenant_id=$1 AND tv.id=$4 AND tv.project_id=$3 AND t.status='active'
          AND app.has_project_permission(tv.tenant_id,$2,tv.project_id,'documents.upload')`,[input.tenantId,input.membershipId,input.projectId,input.templateVersionId])).rows[0];
      return row?mapTemplate(row):null;
    });
  }

  async reserve(input:DocumentContext&{projectId:string;template:TemplateSource;idempotencyKey:string;requestHash:string;unitId?:string;partyId?:string;salesCaseId?:string;contractId?:string}):Promise<GenerationOperation>{
    return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>{
      const existing=(await client.query<Record<string,unknown>>(`SELECT * FROM document_generation_operations WHERE tenant_id=$1 AND idempotency_key=$2`,[input.tenantId,input.idempotencyKey])).rows[0];
      if(existing){if(existing.request_hash!==input.requestHash)throw new Error("idempotency key payload mismatch");return mapOperation(existing,input.template);}
      const data=(await client.query<{project_name:string;project_code:string;unit_code:string|null;party_name:string|null;total_price:string|null}>(`
        SELECT p.name project_name,p.code project_code,u.code unit_code,party.display_name party_name,
          CASE WHEN u.id IS NULL THEN NULL ELSE app.current_unit_sales_price($1,u.id,now())::text END total_price
        FROM projects p LEFT JOIN units u ON u.tenant_id=p.tenant_id AND u.project_id=p.id AND u.id=$4
        LEFT JOIN parties party ON party.tenant_id=p.tenant_id AND party.id=$5
        WHERE p.tenant_id=$1 AND p.id=$3 AND p.archived_at IS NULL AND app.has_project_permission($1,$2,p.id,'documents.upload')
          AND ($4::uuid IS NULL OR u.id IS NOT NULL)
          AND ($5::uuid IS NULL OR EXISTS(SELECT 1 FROM party_project_links l WHERE l.tenant_id=$1 AND l.project_id=p.id AND l.party_id=$5 AND l.valid_to IS NULL)
            OR EXISTS(SELECT 1 FROM sales_case_parties sp JOIN sales_cases sc ON sc.tenant_id=sp.tenant_id AND sc.id=sp.sales_case_id WHERE sp.tenant_id=$1 AND sp.party_id=$5 AND sp.left_at IS NULL AND sc.project_id=p.id))`,
        [input.tenantId,input.membershipId,input.projectId,input.unitId??null,input.partyId??null])).rows[0];
      if(!data)throw new Error("generation business context is not accessible");
      const generatedAt=new Date().toISOString();
      const all:Record<string,string|undefined>={"project.name":data.project_name,"project.code":data.project_code,"unit.code":data.unit_code??undefined,
        "buyer.name":data.party_name??undefined,"generation.date":new Intl.DateTimeFormat("cs-CZ",{dateStyle:"medium",timeZone:"Europe/Prague"}).format(new Date(generatedAt)),
        "unit.totalPrice":data.total_price==null?undefined:new Intl.NumberFormat("cs-CZ",{style:"currency",currency:"CZK",maximumFractionDigits:0}).format(Number(data.total_price))};
      const snapshot:Record<string,string>={};for(const token of Object.keys(input.template.schema.fields)){if(all[token]!==undefined)snapshot[token]=all[token]!;}
      const snapshotHash=await sha256Json(snapshot);
      const row=(await client.query<Record<string,unknown>>(`INSERT INTO document_generation_operations(tenant_id,project_id,idempotency_key,request_hash,template_version_id,unit_id,party_id,sales_case_id,contract_id,generation_snapshot,snapshot_hash,created_by_membership_id)
        VALUES($1,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$2) RETURNING *`,[input.tenantId,input.membershipId,input.projectId,input.idempotencyKey,input.requestHash,input.template.templateVersionId,input.unitId??null,input.partyId??null,input.salesCaseId??null,input.contractId??null,snapshot,snapshotHash])).rows[0];
      return mapOperation(row,input.template);
    });
  }

  async complete(input:DocumentContext&{operationId:string;documentId:string;documentVersionId:string;renderedContentHash:string}):Promise<void>{
    await this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>{
      const result=await client.query(`UPDATE document_generation_operations SET state='completed',output_document_id=$4,output_document_version_id=$5,rendered_content_hash=$6,completed_at=now()
        WHERE tenant_id=$1 AND id=$3 AND created_by_membership_id=$2 AND state='reserved'`,[input.tenantId,input.membershipId,input.operationId,input.documentId,input.documentVersionId,input.renderedContentHash]);
      if(!result.rowCount){const done=await client.query(`SELECT 1 FROM document_generation_operations WHERE tenant_id=$1 AND id=$2 AND state='completed'`,[input.tenantId,input.operationId]);if(!done.rowCount)throw new Error("generation operation not found");}
      await client.query(`INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data)
        SELECT $1,m.user_id,'document.generated','document_version',$4,
          jsonb_build_object('generationOperationId',$3::uuid,'documentId',$5::uuid,'renderedContentHash',$6::text)
        FROM tenant_memberships m WHERE m.tenant_id=$1 AND m.id=$2 AND NOT EXISTS(SELECT 1 FROM audit_log a WHERE a.tenant_id=$1 AND a.action='document.generated' AND a.entity_id=$4)`,[input.tenantId,input.membershipId,input.operationId,input.documentVersionId,input.documentId,input.renderedContentHash]);
      if(result.rowCount)await client.query(`INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
        VALUES($1,'document',$2,'document.generated',jsonb_build_object('schemaVersion',1,'documentId',$2::uuid,'versionId',$3::uuid,'generationOperationId',$4::uuid))`,[input.tenantId,input.documentId,input.documentVersionId,input.operationId]);
    });
  }
}

function mapTemplate(r:Record<string,unknown>):TemplateSource{return{templateId:String(r.template_id),templateVersionId:String(r.template_version_id),projectId:String(r.project_id),templateCode:String(r.code),templateName:String(r.name),outputTypeCode:String(r.output_type_code),versionLabel:String(r.version_label),contentHash:String(r.content_hash),schema:r.placeholder_schema as PlaceholderSchema,driveId:String(r.external_drive_id),itemId:String(r.external_item_id),externalVersionId:r.external_version_id?String(r.external_version_id):null};}
function mapOperation(r:Record<string,unknown>,template:TemplateSource):GenerationOperation{return{id:String(r.id),state:String(r.state) as GenerationOperation["state"],projectId:String(r.project_id),template,snapshot:r.generation_snapshot as Record<string,string>,outputDocumentId:r.output_document_id?String(r.output_document_id):null,outputDocumentVersionId:r.output_document_version_id?String(r.output_document_version_id):null,unitId:r.unit_id?String(r.unit_id):null,partyId:r.party_id?String(r.party_id):null,salesCaseId:r.sales_case_id?String(r.sales_case_id):null,contractId:r.contract_id?String(r.contract_id):null,createdAt:String(r.created_at)};}
async function sha256Json(value:unknown):Promise<string>{const bytes=new TextEncoder().encode(JSON.stringify(value));return Buffer.from(await crypto.subtle.digest("SHA-256",bytes)).toString("hex");}

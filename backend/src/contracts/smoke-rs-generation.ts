import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {Database} from "../database.js";
import {inspectDocxTemplate} from "../documents/docx-template.js";
import {EntraMicrosoftGraphAdapter} from "../documents/graph-adapter.js";
import {ManagedIdentityGraphTokenProvider} from "../documents/managed-identity-token-provider.js";
import {DocumentRepository,type DocumentContext} from "../documents/repository.js";
import {RS_PLACEHOLDERS,DocumentTemplateGenerationService} from "../documents/template-generation-service.js";
import {DocumentTemplateGenerationRepository} from "../documents/template-generation-repository.js";
import {SharePointDocumentUploadService} from "../documents/upload-service.js";
import {RsGenerationRepository} from "./rs-generation-repository.js";
import {RsGenerationService} from "./rs-generation-service.js";

const databaseUrl=required("DATABASE_URL"),clientId=required("SHAREPOINT_MANAGED_IDENTITY_CLIENT_ID");
const context:DocumentContext={tenantId:required("RS_SMOKE_TENANT_ID"),userId:required("RS_SMOKE_USER_ID"),membershipId:required("RS_SMOKE_MEMBERSHIP_ID")};
const projectId=required("RS_SMOKE_PROJECT_ID"),contractId=required("RS_SMOKE_CONTRACT_ID"),release=required("RS_SMOKE_RELEASE");
const database=new Database(databaseUrl),graph=new EntraMicrosoftGraphAdapter(new ManagedIdentityGraphTokenProvider(clientId));
const documents=new DocumentRepository(database),uploads=new SharePointDocumentUploadService(documents,graph,clientId);
const templates=new DocumentTemplateGenerationRepository(database),generation=new DocumentTemplateGenerationService(templates,documents,uploads,graph);
const rs=new RsGenerationService(new RsGenerationRepository(database),generation);
let templateId:string|null=null;

try{
  await configureSeller();
  const bytes=await readFile(resolve("backend/templates/rs/rezidence-dejvice-rs-v1.docx"));
  const source=await uploads.upload({...context,projectId,contractId,idempotencyKey:`rs-template-source-${release}`,typeCode:"reservation_contract",
    documentName:`TECHNICKÁ ŠABLONA RS ${release}`,fileName:`rezervacni-smlouva-rs-${release}.docx`,mimeType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    bytes,versionLabel:"template-v1",status:"draft",note:"Technický RS smoke-test; není určen k podpisu."});
  const registered=await generation.register({...context,projectId,code:"rs-dejvice",name:"Rezervační smlouva – Rezidence Dejvice",outputTypeCode:"reservation_contract",contractType:"rs",
    versionLabel:`v1-${release}`,sourceDocumentId:source.documentId,sourceDocumentVersionId:source.documentVersionId,schema:{fields:Object.fromEntries(RS_PLACEHOLDERS.map(token=>[token,{required:true}]))},
    approvalStatus:"approved",effectiveFrom:new Date().toISOString().slice(0,10)});templateId=registered.templateId;
  const readiness=await rs.readiness({...context,contractId});if(!readiness.ready)throw new Error(`RS smoke data are not ready: ${readiness.issues.map(item=>item.code).join(",")}`);
  const key=`rs-generation-${release}`;const first=await rs.generate({...context,contractId,idempotencyKey:key}),second=await rs.generate({...context,contractId,idempotencyKey:key});
  if(!first.documentId||!first.documentVersionId)throw new Error("RS generation returned incomplete evidence");
  if(first.documentId!==second.documentId||first.documentVersionId!==second.documentVersionId||first.contractVersionId!==second.contractVersionId||!second.replayed)throw new Error("RS retry created duplicate evidence");
  const detail=await documents.getById({...context,documentId:first.documentId});if(!detail?.externalItemId)throw new Error("RS SharePoint binding missing");
  const connection=await documents.getConnectionForUpload({...context,projectId});if(!connection)throw new Error("SharePoint connection missing");
  const rendered=await graph.downloadFile({siteId:connection.siteId,driveId:connection.driveId},detail.externalItemId,detail.versions[0]?.externalVersionId??undefined);
  const inspection=inspectDocxTemplate(rendered);if(inspection.tokens.length)throw new Error("RS contains unresolved placeholders");
  const evidence=await database.withContext({tenantId:context.tenantId,userId:context.userId},async client=>(await client.query<{template_hash:string;snapshot_hash:string;version_number:number;document_version_id:string}>(`
    SELECT template.content_hash template_hash,operation.snapshot_hash,version.version_number,version.document_version_id
    FROM contract_versions version JOIN document_template_versions template ON template.tenant_id=version.tenant_id AND template.id=version.template_version_id
    JOIN document_generation_operations operation ON operation.tenant_id=version.tenant_id AND operation.id=version.generation_operation_id
    WHERE version.tenant_id=$1 AND version.contract_id=$2 AND version.id=$3`,[context.tenantId,contractId,first.contractVersionId])).rows[0]);
  if(!evidence)throw new Error("RS contract/document evidence missing");
  console.log(JSON.stringify({ok:true,ready:true,templateHash:evidence.template_hash,snapshotStored:Boolean(evidence.snapshot_hash),contractVersion:evidence.version_number,
    sharePointStored:Boolean(detail.externalItemId),documentVersionLinked:evidence.document_version_id===first.documentVersionId,noUnresolvedPlaceholders:true,idempotentReplay:second.replayed,bytes:rendered.byteLength}));
}finally{
  if(templateId&&process.env.RS_SMOKE_KEEP_TEMPLATE_ACTIVE!=="true")await archiveTemplate(templateId);
  await database.close();
}

async function configureSeller(){await database.withContext({tenantId:context.tenantId,userId:context.userId},async client=>{await client.query(`INSERT INTO project_contract_settings(
  tenant_id,project_id,seller_name,seller_registration_number,seller_address,seller_registry_entry,seller_representative,seller_email,seller_data_box,seller_bank_account,seller_bank_name,reservation_period_days,created_by_membership_id)
  SELECT $1,$2,'Rezidence Dejvice 2 s.r.o.','24106119','Rohanské nábřeží 693/10, 186 00 Praha 8 – Karlín','zapsaná v obchodním rejstříku vedeném Městským soudem v Praze, oddíl C, vložka 179591',
    'jednatelem Jaroslavem Žahourkem','jaroslav.zahourek@immobuilding.cz','nymania','178 412 7011 / 2700','UniCredit Bank Czech Republic and Slovakia a.s.',30,$3
  WHERE app.has_project_permission($1,$3,$2,'contract.manage')
  ON CONFLICT(tenant_id,project_id) DO UPDATE SET seller_name=EXCLUDED.seller_name,seller_registration_number=EXCLUDED.seller_registration_number,seller_address=EXCLUDED.seller_address,
    seller_registry_entry=EXCLUDED.seller_registry_entry,seller_representative=EXCLUDED.seller_representative,seller_email=EXCLUDED.seller_email,seller_data_box=EXCLUDED.seller_data_box,
    seller_bank_account=EXCLUDED.seller_bank_account,seller_bank_name=EXCLUDED.seller_bank_name,reservation_period_days=EXCLUDED.reservation_period_days`,[context.tenantId,projectId,context.membershipId]);});}
async function archiveTemplate(id:string){await database.withContext({tenantId:context.tenantId,userId:context.userId},async client=>{await client.query(`UPDATE document_templates SET status='archived' WHERE tenant_id=$1 AND id=$2 AND project_id=$3`,[context.tenantId,id,projectId]);await client.query(`INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data)
  SELECT $1,m.user_id,'document_template.archived_after_smoke','document_template',$2,jsonb_build_object('projectId',$3::uuid) FROM tenant_memberships m WHERE m.tenant_id=$1 AND m.id=$4`,[context.tenantId,id,projectId,context.membershipId]);});}
function required(name:string):string{const value=process.env[name]?.trim();if(!value)throw new Error(`missing ${name}`);return value;}

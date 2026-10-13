import {Database} from '../database.js';
import {InventoryRepository} from '../inventory/repository.js';
import {InventoryImportService} from '../inventory/import-service.js';
import {CommercialService} from '../commercial/service.js';
import {DocumentRepository} from '../documents/repository.js';
import {SharePointDocumentUploadService} from '../documents/upload-service.js';
import {EntraMicrosoftGraphAdapter} from '../documents/graph-adapter.js';
import {ManagedIdentityGraphTokenProvider} from '../documents/managed-identity-token-provider.js';
import {DocumentTemplateGenerationRepository} from '../documents/template-generation-repository.js';
import {DocumentTemplateGenerationService,RS_PLACEHOLDERS} from '../documents/template-generation-service.js';
import {DocumentTemplateManagementRepository} from '../documents/template-management-repository.js';
import {DocumentTemplateManagementService} from '../documents/template-management-service.js';
import {RsGenerationRepository} from './rs-generation-repository.js';
import {RsGenerationService,buildSnapshot} from './rs-generation-service.js';
import {ContractDocumentEvidenceService} from './document-evidence-service.js';
import {inspectDocxTemplate,renderDocxTemplate} from '../documents/docx-template.js';

// Explicitly invoked technical smoke only. Never a server startup hook/job.
const context={tenantId:required('EVIDENCE_SMOKE_TENANT_ID'),userId:required('EVIDENCE_SMOKE_USER_ID'),membershipId:required('EVIDENCE_SMOKE_MEMBERSHIP_ID')};
const database=new Database(required('DATABASE_URL'));const mi=required('SHAREPOINT_MANAGED_IDENTITY_CLIENT_ID');
const graph=new EntraMicrosoftGraphAdapter(new ManagedIdentityGraphTokenProvider(mi));const documents=new DocumentRepository(database);
const uploads=new SharePointDocumentUploadService(documents,graph,mi);const generationRepo=new DocumentTemplateGenerationRepository(database);
const generation=new DocumentTemplateGenerationService(generationRepo,documents,uploads,graph);
const management=new DocumentTemplateManagementService(new DocumentTemplateManagementRepository(database),generationRepo,documents,uploads,graph);
const rsRepo=new RsGenerationRepository(database),rs=new RsGenerationService(rsRepo,generation),evidence=new ContractDocumentEvidenceService(database,graph,uploads,mi);
const commercial=new CommercialService(database),inventory=new InventoryImportService(database),catalog=new InventoryRepository(database);
const mode=process.env.EVIDENCE_SMOKE_MODE??'prepare';const projectName='TECH SMOKE · Price + signed document 0057';
if(!['prepare','verify'].includes(mode))throw new Error('INVALID_SMOKE_MODE');
try{
  await database.withContext(context,async client=>{
    const runtime=(await client.query<{safe:boolean}>("SELECT NOT rolsuper AND NOT rolbypassrls AND pg_has_role(current_user,'develocrm_app','member') safe FROM pg_roles WHERE rolname=current_user")).rows[0];
    if(!runtime?.safe)throw new Error('NON_ADMIN_RUNTIME_DATABASE_REQUIRED');
  });
  const source=await database.withContext(context,async client=>(await client.query<{project_id:string;template_id:string;version_id:string}>(`
    SELECT tv.project_id,tv.template_id,tv.id version_id FROM document_template_versions tv JOIN document_templates t ON t.tenant_id=tv.tenant_id AND t.id=tv.template_id
    WHERE tv.tenant_id=$1 AND t.contract_type='rs' AND t.status='active' AND tv.approval_status='approved' AND tv.effective_from<=CURRENT_DATE
      AND t.code<>'technical-rs-0057' AND app.has_project_permission(tv.tenant_id,$2,tv.project_id,'documents.read')
    ORDER BY tv.created_at DESC LIMIT 1`,[context.tenantId,context.membershipId])).rows[0]);
  if(!source)throw new Error('APPROVED_SOURCE_RS_TEMPLATE_REQUIRED');
  let project=await database.withContext(context,async client=>(await client.query<{id:string;name:string}>("SELECT id,name FROM projects WHERE tenant_id=$1 AND code='TECH57'",[context.tenantId])).rows[0]);
  if(project&&project.name!==projectName)throw new Error('SMOKE_PROJECT_NOT_TECHNICAL');
  if(!project){if(mode!=='prepare')throw new Error('SMOKE_PROJECT_MISSING');const created=await catalog.createProject({...context,name:projectName,code:'TECH57',slug:'tech-price-document-0057',constructionStatus:'preparation',plannedHandoverFrom:'2027-12-01',defaultCurrency:'CZK',note:'Technický test. Nejde o skutečný obchod.'});project={...created,name:projectName};}
  const projectId=project.id;
  if(mode==='prepare')await database.withContext(context,async client=>{
    const copied=await client.query(`INSERT INTO project_contract_settings(tenant_id,project_id,seller_name,seller_registration_number,seller_address,seller_registry_entry,seller_representative,seller_email,seller_data_box,seller_bank_account,seller_bank_name,reservation_period_days,created_by_membership_id)
      SELECT tenant_id,$2,seller_name,seller_registration_number,seller_address,seller_registry_entry,seller_representative,seller_email,seller_data_box,seller_bank_account,seller_bank_name,reservation_period_days,$4
      FROM project_contract_settings WHERE tenant_id=$1 AND project_id=$3 ON CONFLICT(tenant_id,project_id) DO NOTHING`,[context.tenantId,projectId,source.project_id,context.membershipId]);
    if(!copied.rowCount&&!(await client.query('SELECT 1 FROM project_contract_settings WHERE tenant_id=$1 AND project_id=$2',[context.tenantId,projectId])).rowCount)throw new Error('SOURCE_SELLER_SETTINGS_REQUIRED');
  });
  const sourceFile=mode==='prepare'?await management.source({...context,templateId:source.template_id,versionId:source.version_id}):null;
  if(mode==='prepare'){
    const target=await management.upload({...context,projectId,code:'technical-rs-0057',name:'TECH SMOKE RS 0057',outputTypeCode:'reservation_contract',versionLabel:'v1',effectiveFrom:'2026-01-01',fileName:'TECH-SMOKE-RS-TEMPLATE-0057.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',bytes:sourceFile!.bytes});
    const targetContext={...context,templateId:target.templateId,versionId:target.templateVersionId};await management.validate(targetContext);await management.approve(targetContext);
  }
  const results=[];
  for(const kind of ['GEN','EXT']){
    const code=`TECH-${kind}57`,reference=`TECH57-${kind}-RS`;
    if(mode==='prepare')await inventory.createUnit({...context,projectId,idempotencyKey:`integrity-unit-${kind}-0057`,row:{rowNumber:1,code,layout:'1+kk',areaM2:30,floorLabel:'1. NP',price:5000000,commercialStatus:'available'}});
    const unit=await database.withContext(context,async client=>(await client.query<{id:string;price:number;price_count:number}>(`SELECT id,app.current_unit_price(tenant_id,id,now())::float8 price,
      (SELECT count(*)::int FROM unit_price_history h WHERE h.tenant_id=u.tenant_id AND h.unit_id=u.id) price_count FROM units u WHERE tenant_id=$1 AND project_id=$2 AND code=$3`,[context.tenantId,projectId,code])).rows[0]);
    if(!unit||unit.price!==5000000||unit.price_count!==1)throw new Error('INITIAL_PRICE_EVIDENCE_MISMATCH');
    let contract=await database.withContext(context,async client=>(await client.query<{id:string}>("SELECT id FROM contracts WHERE tenant_id=$1 AND project_id=$2 AND reference=$3",[context.tenantId,projectId,reference])).rows[0]);
    if(!contract&&mode==='prepare'){
      const hold=await database.withContext(context,async client=>(await client.query<{sales_case_id:string;party_id:string}>(`
        SELECT * FROM app.create_party_and_unit_hold($1,$2,'pre_reservation',now()+interval '48 hours',$3,$4,'TECH SMOKE – nejde o skutečný obchod','individual','pan','TECH SMOKE',$5,NULL,NULL,$6,$7)`,
        [context.tenantId,unit.id,context.membershipId,`integrity-hold-${kind}-0057`,`${kind}0057`,`tech-integrity-${kind.toLowerCase()}-0057@example.test`,kind==='GEN'?'+420000000157':'+420000000257'])).rows[0]);
      await database.withContext(context,async client=>{
        await client.query("UPDATE party_individual_details SET date_of_birth='2000-01-01' WHERE tenant_id=$1 AND party_id=$2",[context.tenantId,hold.party_id]);
        await client.query("INSERT INTO party_addresses(tenant_id,party_id,address_type,line1,city,postal_code,is_primary) VALUES($1,$2,'residence','TECHNICKÁ TESTOVACÍ ADRESA','TEST','00000',true)",[context.tenantId,hold.party_id]);
        await client.query("INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data) VALUES($1,$2,'workflow.test_fixture_prepared','party',$3,jsonb_build_object('projectId',$4::uuid,'synthetic',true))",[context.tenantId,context.userId,hold.party_id,projectId]);
      });
      contract=await commercial.createContract({...context,salesCaseId:hold.sales_case_id,type:'rs',reference,title:'TECH SMOKE RS – není skutečná smlouva',idempotencyKey:`integrity-contract-${kind}-0057`,paymentCalculationType:'fixed',paymentInputValue:100000,paymentDueAt:new Date(Date.now()+7*86400000).toISOString()});
    }
    if(!contract)throw new Error('SMOKE_CONTRACT_MISSING');
    if(mode==='prepare'){
      const status=await database.withContext(context,async client=>(await client.query<{current_status:string}>('SELECT current_status FROM contracts WHERE tenant_id=$1 AND id=$2',[context.tenantId,contract!.id])).rows[0].current_status);
      if(status!=='signed'){
        if(kind==='GEN'){
          const ready=await rs.readiness({...context,contractId:contract.id});if(!ready.ready)throw new Error(`RS_NOT_READY_${ready.issues.map(i=>i.code).join('_').toUpperCase()}`);
          const first=await rs.generate({...context,contractId:contract.id,idempotencyKey:'integrity-generation-0057'}),retry=await rs.generate({...context,contractId:contract.id,idempotencyKey:'integrity-generation-0057'});
          if(first.documentVersionId!==retry.documentVersionId||!retry.replayed)throw new Error('GENERATION_RETRY_DUPLICATED');
        }else{
          const rsSource=await rsRepo.load({...context,contractId:contract.id,permission:'contract.manage'});if(!rsSource)throw new Error('EXTERNAL_SOURCE_CONTEXT_MISSING');
          const rendered=renderDocxTemplate(sourceFile!.bytes,buildSnapshot(rsSource),{allowedTokens:[...RS_PLACEHOLDERS],requiredTokens:[...RS_PLACEHOLDERS]});
          await evidence.uploadExternal({...context,contractId:contract.id,idempotencyKey:'integrity-external-0057',fileName:'TECH-SMOKE-EXTERNAL-RS-0057.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',bytes:rendered.bytes});
        }
        const fresh=await database.withContext(context,async client=>(await client.query<{current_status:string}>('SELECT current_status FROM contracts WHERE tenant_id=$1 AND id=$2',[context.tenantId,contract!.id])).rows[0].current_status);
        for(const to of fresh==='draft'?['sent','approved']:fresh==='sent'||fresh==='negotiation'?['approved']:[])await commercial.transition({...context,contractId:contract.id,to,reason:'TECH SMOKE – simulace workflow'});
      }
    }
    const latest=await database.withContext(context,async client=>(await client.query<{id:string;signed_at:string;version_status:string}>('SELECT id,signed_at,version_status FROM contract_versions WHERE tenant_id=$1 AND contract_id=$2 ORDER BY version_number DESC LIMIT 1',[context.tenantId,contract!.id])).rows[0]);
    const exact=await evidence.exactFile({...context,contractId:contract.id,versionId:latest.id});
    if(inspectDocxTemplate(exact.bytes).tokens.length)throw new Error('UNRESOLVED_DOCUMENT_FIELDS');
    if(mode==='verify'){
      if(latest.version_status!=='signed')throw new Error('SMOKE_CONTRACT_NOT_SIGNED');
      const before=await database.withContext(context,async client=>(await client.query<{count:number}>('SELECT count(*)::int count FROM audit_log WHERE tenant_id=$1 AND entity_id=$2',[context.tenantId,contract!.id])).rows[0].count);
      const retry=await commercial.signContract({...context,contractId:contract.id,versionId:latest.id,signedAt:latest.signed_at,note:'TECH SMOKE – opakování evidence podpisu'});if(!retry.alreadySigned)throw new Error('SIGNATURE_RETRY_NOT_IDEMPOTENT');
      const state=await database.withContext(context,async client=>(await client.query<{commercial_status:string;current_stage:string;holds:number;expirable:boolean;payments:number;audit_count:number}>(`SELECT u.commercial_status,sc.current_stage,
        (SELECT count(*)::int FROM unit_holds h WHERE h.tenant_id=u.tenant_id AND h.unit_id=u.id AND h.status='active') holds,
        (SELECT bool_or(is_expirable) FROM unit_holds h WHERE h.tenant_id=u.tenant_id AND h.unit_id=u.id AND h.status='active') expirable,
        (SELECT count(*)::int FROM payment_obligations o WHERE o.tenant_id=c.tenant_id AND o.contract_id=c.id) payments,
        (SELECT count(*)::int FROM audit_log a WHERE a.tenant_id=c.tenant_id AND a.entity_id=c.id) audit_count
        FROM contracts c JOIN units u ON u.tenant_id=c.tenant_id AND u.id=c.unit_id JOIN sales_cases sc ON sc.tenant_id=c.tenant_id AND sc.id=c.sales_case_id WHERE c.tenant_id=$1 AND c.id=$2`,[context.tenantId,contract!.id])).rows[0]);
      if(state.commercial_status!=='reserved'||state.current_stage!=='reservation'||state.holds!==1||state.expirable||state.payments!==1||state.audit_count!==before)throw new Error('SIGNED_WORKFLOW_EVIDENCE_MISMATCH');
    }
    results.push({kind,projectId,unitId:unit.id,contractId:contract.id,versionId:latest.id,documentVersionId:exact.evidence.documentVersionId,initialPrice:unit.price,priceHistoryCount:unit.price_count,exactFileVerified:true,noUnresolvedFields:true,status:latest.version_status});
  }
  console.log(JSON.stringify({event:'price_document_integrity.smoke',mode,ok:true,results}));
}catch(error){const e=error as {name?:string;code?:string;message?:string;constraint?:string;status?:number};console.error(JSON.stringify({event:'price_document_integrity.smoke_failed',mode,errorName:e.name,errorCode:e.code??(/^[A-Z0-9_]+$/.test(e.message??'')?e.message:undefined),constraint:e.constraint,graphStatus:e.status}));process.exitCode=1;
}finally{await database.close();}
function required(name:string){const value=process.env[name]?.trim();if(!value)throw new Error(`MISSING_${name}`);return value;}

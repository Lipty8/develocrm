// Explicit TECH74 fixture only. No signature, generation or payment command.
import {createHash} from 'node:crypto';
import {Database} from '../dist/database.js';
import {InventoryImportService} from '../dist/inventory/import-service.js';
import {HoldService} from '../dist/sales/hold-service.js';
import {CommercialService} from '../dist/commercial/service.js';
import {DocumentRepository} from '../dist/documents/repository.js';
import {SharePointDocumentUploadService} from '../dist/documents/upload-service.js';
import {ManagedIdentityGraphTokenProvider} from '../dist/documents/managed-identity-token-provider.js';
import {EntraMicrosoftGraphAdapter} from '../dist/documents/graph-adapter.js';
import {ContractDocumentEvidenceService} from '../dist/contracts/document-evidence-service.js';

const TENANT='60bed28c-0c89-4a38-bac7-71e6cf7b9232';
const MEMBER='40b59cc5-0007-436e-82dd-b30eef82e6eb';
const PROJECT='cd3605bd-9ef7-461b-b3f2-54f0447fff60';
const UNIT='7480',KEY='technical-external-retry-v1';
const IDENTITY='134a9cd1-c2d7-4386-b47c-c59260ad460c';
const FILE='TECH80-external-upload-retry.pdf';
const assert=(condition,code)=>{if(!condition)throw new Error(code);};

export async function runExternalUploadRetrySmoke({mode,databaseUrl,pdfBase64,pdfSha256}){
  assert(['prepare','verify'].includes(mode),'TECH80_MODE_REQUIRED');
  const database=new Database(databaseUrl);
  let phase='authorize';
  try{
    const actor=await database.withContext({tenantId:TENANT},async c=>(await c.query("SELECT user_id FROM tenant_memberships WHERE tenant_id=$1 AND id=$2 AND status='active'",[TENANT,MEMBER])).rows[0],{readOnly:true});
    assert(actor,'TECH80_ACTOR_REQUIRED');
    const context={tenantId:TENANT,userId:actor.user_id,membershipId:MEMBER};
    const sql=(query,values=[])=>database.withContext(context,c=>c.query(query,values),{readOnly:true});
    const safe=(await sql("SELECT NOT rolsuper AND NOT rolbypassrls AND pg_has_role(current_user,'develocrm_app','member') safe,app.current_user_has_permission('system.manage') allowed FROM pg_roles WHERE rolname=current_user")).rows[0];
    assert(safe?.safe&&safe.allowed,'TECH80_SAFE_ROLE_REQUIRED');
    const project=(await sql("SELECT p.id FROM projects p WHERE p.tenant_id=$1 AND p.id=$2 AND p.code='TECH74' AND p.name='TECH SMOKE 0074 – approved original profiles' AND p.archived_at IS NULL AND EXISTS(SELECT 1 FROM audit_log a WHERE a.tenant_id=p.tenant_id AND a.entity_id=p.id AND a.action='workflow.technical_sbk_smoke_created' AND a.after_data->>'smokeKey'='technical-approved-original-pipeline-v1' AND a.after_data->>'actor'=$3::text)",[TENANT,PROJECT,actor.user_id])).rows[0];
    assert(project,'TECH80_OWNED_PROJECT_REQUIRED');
    phase='prepare';
    if(mode==='prepare')await database.withContext(context,async c=>{
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${TENANT}:${PROJECT}:${KEY}`]);
      const existing=(await c.query('SELECT id FROM units WHERE tenant_id=$1 AND project_id=$2 AND code=$3',[TENANT,PROJECT,UNIT])).rows[0];
      if(existing){
        assert((await c.query("SELECT 1 FROM audit_log WHERE tenant_id=$1 AND entity_id=$2 AND action='workflow.technical_external_retry_created' AND after_data->>'smokeKey'=$3 AND actor_user_id=$4",[TENANT,existing.id,KEY,actor.user_id])).rowCount===1,'TECH80_UNIT_NOT_OWNED');
        return;
      }
      // Share one atomic transaction with the existing domain services.
      const transaction={withContext:async(_context,work)=>work(c)};
      phase='create_unit';
      await new InventoryImportService(transaction).createUnit({...context,projectId:PROJECT,idempotencyKey:'tech80-unit-v1',row:{rowNumber:1,code:UNIT,layout:'1+kk',areaM2:30,price:2500000}});
      const unit=(await c.query('SELECT id FROM units WHERE tenant_id=$1 AND project_id=$2 AND code=$3',[TENANT,PROJECT,UNIT])).rows[0];
      assert(unit,'TECH80_UNIT_CREATION_FAILED');
      phase='create_hold';
      const hold=await new HoldService(transaction).createWithParty({...context,unitId:unit.id,type:'pre_reservation',expiresAt:new Date(Date.now()+48*3600000).toISOString(),idempotencyKey:'tech80-hold-v1',reason:'TECH80 neprávní test uploadu; žádný podpis',newParty:{kind:'individual',firstName:'TECH80',lastName:'UPLOAD RETRY',email:'tech80-upload-retry@example.test'}});
      phase='create_contract';
      const contract=await new CommercialService(transaction).createNextContract({...context,unitId:unit.id,type:'rs',paymentTiming:'signature',paymentCalculationType:'fixed',paymentInputValue:1,idempotencyKey:'tech80-contract-v1'});
      phase='mark_fixture';
      await c.query("INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data) VALUES($1,$2,'workflow.technical_external_retry_created','unit',$3,jsonb_build_object('smokeKey',$4::text,'contractId',$5::text,'salesCaseId',$6::text,'syntheticOnly',true))",[TENANT,actor.user_id,unit.id,KEY,contract.id,hold.sales_case_id]);
    });
    phase='read_fixture';
    const fixture=(await sql("SELECT u.id unit_id,c.id contract_id,c.current_status,c.sales_case_id FROM units u JOIN audit_log a ON a.tenant_id=u.tenant_id AND a.entity_id=u.id AND a.action='workflow.technical_external_retry_created' AND a.after_data->>'smokeKey'=$4 AND a.actor_user_id=$5 JOIN contracts c ON c.tenant_id=u.tenant_id AND c.project_id=u.project_id AND c.unit_id=u.id AND c.id=(a.after_data->>'contractId')::uuid WHERE u.tenant_id=$1 AND u.project_id=$2 AND u.code=$3",[TENANT,PROJECT,UNIT,KEY,actor.user_id])).rows[0];
    assert(fixture&&fixture.current_status==='draft','TECH80_WORKING_FIXTURE_REQUIRED');
    const facts=async()=>{
      const r=(await sql("SELECT (SELECT count(*)::int FROM contract_versions WHERE tenant_id=$1 AND contract_id=$2) contract_versions,(SELECT count(*)::int FROM document_upload_operations WHERE tenant_id=$1 AND metadata->>'contractId'=$2::text) upload_operations,(SELECT count(*)::int FROM audit_log WHERE tenant_id=$1 AND action='contract.external_document_bound' AND after_data->>'contractId'=$2::text) binding_audits,(SELECT count(*)::int FROM payment_obligations WHERE tenant_id=$1 AND contract_id=$2) obligations,(SELECT count(*)::int FROM contract_parties WHERE tenant_id=$1 AND contract_id=$2 AND signature_status='signed') signatures",[TENANT,fixture.contract_id])).rows[0];
      assert(r.signatures===0&&r.obligations===0,'TECH80_UNEXPECTED_BUSINESS_EFFECT');return r;
    };
    if(mode==='prepare')return{ok:true,mode,fixture,facts:await facts(),syntheticOnly:true};
    const bytes=Buffer.from(pdfBase64??'','base64');
    assert(bytes.length>100&&bytes.length<100000&&bytes.subarray(0,5).toString()==='%PDF-'&&createHash('sha256').update(bytes).digest('hex')===pdfSha256,'TECH80_PDF_REQUIRED');
    const operations=(await sql("SELECT idempotency_key,document_id,document_version_id,graph_item_id,state,content_hash FROM document_upload_operations WHERE tenant_id=$1 AND project_id=$2 AND metadata->>'contractId'=$3 AND original_file_name=$4",[TENANT,PROJECT,fixture.contract_id,FILE])).rows;
    assert(operations.length===1&&operations[0].state==='completed'&&operations[0].content_hash===`sha256:${pdfSha256}`,'TECH80_BROWSER_UPLOAD_REQUIRED');
    const operation=operations[0],before=await facts();
    assert(before.contract_versions===1&&before.upload_operations===1&&before.binding_audits===1,'TECH80_INITIAL_COUNT_MISMATCH');
    const graph=new EntraMicrosoftGraphAdapter(new ManagedIdentityGraphTokenProvider(IDENTITY));
    const uploads=new SharePointDocumentUploadService(new DocumentRepository(database),graph,IDENTITY);
    const evidence=new ContractDocumentEvidenceService(database,graph,uploads,IDENTITY);
    const input={...context,contractId:fixture.contract_id,idempotencyKey:operation.idempotency_key,fileName:FILE,mimeType:'application/pdf',bytes};
    const first=await evidence.uploadExternal(input),second=await evidence.uploadExternal(input);
    assert(first.replayed&&second.replayed&&first.documentVersionId===operation.document_version_id&&second.versionId===first.versionId,'TECH80_RETRY_NOT_IDEMPOTENT');
    const exact=await evidence.exactFile({...context,contractId:fixture.contract_id,versionId:first.versionId});
    assert(Buffer.from(exact.bytes).equals(bytes),'TECH80_FILE_MISMATCH');
    const connection=await new DocumentRepository(database).getConnectionForUpload({...context,projectId:PROJECT});
    assert(connection,'TECH80_CONNECTION_MISSING');
    const versions=await graph.getVersions({siteId:connection.siteId,driveId:connection.driveId},first.itemId);
    assert(versions.length===1,'TECH80_NATIVE_DUPLICATE');
    const after=await facts();assert(JSON.stringify(before)===JSON.stringify(after),'TECH80_RETRY_CHANGED_COUNTS');
    return{ok:true,mode,fixture,documentId:first.documentId,documentVersionId:first.documentVersionId,versionId:first.versionId,exactHashVerified:true,retries:2,nativeVersions:versions.length,counts:after,syntheticOnly:true};
  }catch(error){error.smokePhase=phase;throw error;}finally{await database.close();}
}

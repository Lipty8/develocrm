// Explicit synthetic TECH81 fixture in the previously owned TECH74 project.
// No signature, payment, legal generation, historical repair or cleanup.
import {createHash} from 'node:crypto';
import {Database} from '../dist/database.js';
import {InventoryImportService} from '../dist/inventory/import-service.js';
import {HoldService} from '../dist/sales/hold-service.js';
import {CommercialService} from '../dist/commercial/service.js';
import {RsGenerationRepository} from '../dist/contracts/rs-generation-repository.js';
import {DocumentRepository} from '../dist/documents/repository.js';
import {SharePointDocumentUploadService} from '../dist/documents/upload-service.js';
import {ManagedIdentityGraphTokenProvider} from '../dist/documents/managed-identity-token-provider.js';
import {EntraMicrosoftGraphAdapter} from '../dist/documents/graph-adapter.js';

const TENANT='60bed28c-0c89-4a38-bac7-71e6cf7b9232',MEMBER='40b59cc5-0007-436e-82dd-b30eef82e6eb';
const PROJECT='cd3605bd-9ef7-461b-b3f2-54f0447fff60',UNIT='7481',KEY='technical-appendix-unit-v1';
const IDENTITY='134a9cd1-c2d7-4386-b47c-c59260ad460c';
const WRONG_DOCUMENT='12c52bc9-4f08-4820-9492-28a9f230bdb0',WRONG_VERSION='7ad0a87e-00be-427f-a8cd-a03f622763de';
const WRONG_UNIT='8119784b-a00a-4ff4-936b-997231e7e70c';
const assert=(value,code)=>{if(!value)throw Error(code);};
const text=kind=>`TECH81 - NONLEGAL APPENDIX SCOPE TEST\n${kind==='unit'?'Technical unit 7481 only.':'Shared technical project document.'}\nNot a catalogue, contract, signature or payment instruction.\n`;
const hash=bytes=>`sha256:${createHash('sha256').update(bytes).digest('hex')}`;

export async function runAppendixUnitSmoke({mode,databaseUrl}){
  assert(['prepare','negative','verify'].includes(mode),'TECH81_MODE_REQUIRED');
  const database=new Database(databaseUrl);let phase='authorize';
  try{
    const actor=await database.withContext({tenantId:TENANT},async c=>(await c.query("SELECT user_id FROM tenant_memberships WHERE tenant_id=$1 AND id=$2 AND status='active'",[TENANT,MEMBER])).rows[0],{readOnly:true});
    assert(actor,'TECH81_ACTOR_REQUIRED');
    const context={tenantId:TENANT,userId:actor.user_id,membershipId:MEMBER};
    const read=(sql,values=[])=>database.withContext(context,c=>c.query(sql,values),{readOnly:true});
    const permission=(await read("SELECT NOT rolsuper AND NOT rolbypassrls AND pg_has_role(current_user,'develocrm_app','member') safe,app.current_user_has_permission('system.manage') allowed FROM pg_roles WHERE rolname=current_user")).rows[0];
    assert(permission?.safe&&permission.allowed,'TECH81_SAFE_ROLE_REQUIRED');
    const owned=(await read("SELECT 1 FROM projects p WHERE p.tenant_id=$1 AND p.id=$2 AND p.code='TECH74' AND p.name='TECH SMOKE 0074 – approved original profiles' AND p.archived_at IS NULL AND EXISTS(SELECT 1 FROM audit_log a WHERE a.tenant_id=p.tenant_id AND a.entity_id=p.id AND a.action='workflow.technical_sbk_smoke_created' AND a.after_data->>'smokeKey'='technical-approved-original-pipeline-v1' AND a.after_data->>'actor'=$3::text)",[TENANT,PROJECT,actor.user_id])).rowCount;
    assert(owned===1,'TECH81_OWNED_PROJECT_REQUIRED');
    phase='prepare';
    if(mode==='prepare')await database.withContext(context,async c=>{
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${TENANT}:${PROJECT}:${KEY}`]);
      const existing=(await c.query('SELECT id FROM units WHERE tenant_id=$1 AND project_id=$2 AND code=$3',[TENANT,PROJECT,UNIT])).rows[0];
      if(existing){assert((await c.query("SELECT 1 FROM audit_log WHERE tenant_id=$1 AND entity_id=$2 AND action='workflow.technical_appendix_scope_created' AND after_data->>'smokeKey'=$3 AND actor_user_id=$4",[TENANT,existing.id,KEY,actor.user_id])).rowCount===1,'TECH81_UNIT_NOT_OWNED');return;}
      const transaction={withContext:async(_context,work)=>work(c)};
      await new InventoryImportService(transaction).createUnit({...context,projectId:PROJECT,idempotencyKey:'tech81-unit-v1',row:{rowNumber:1,code:UNIT,layout:'1+kk',areaM2:30,price:2500000}});
      const unit=(await c.query('SELECT id FROM units WHERE tenant_id=$1 AND project_id=$2 AND code=$3',[TENANT,PROJECT,UNIT])).rows[0];
      const hold=await new HoldService(transaction).createWithParty({...context,unitId:unit.id,type:'pre_reservation',expiresAt:new Date(Date.now()+48*3600000).toISOString(),idempotencyKey:'tech81-hold-v1',reason:'TECH81 neprávní test přiřazení příloh; bez podpisu',newParty:{kind:'individual',firstName:'TECH81',lastName:'APPENDIX SCOPE',email:'tech81-appendix-scope@example.test'}});
      const contract=await new CommercialService(transaction).createNextContract({...context,unitId:unit.id,type:'rs',paymentTiming:'signature',paymentCalculationType:'fixed',paymentInputValue:1,idempotencyKey:'tech81-contract-v1'});
      await c.query("INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data) VALUES($1,$2,'workflow.technical_appendix_scope_created','unit',$3,jsonb_build_object('smokeKey',$4::text,'contractId',$5::text,'salesCaseId',$6::text,'syntheticOnly',true))",[TENANT,actor.user_id,unit.id,KEY,contract.id,hold.sales_case_id]);
    });
    phase='read_fixture';
    const fixture=(await read(`SELECT u.id unit_id,c.id contract_id,c.sales_case_id,v.id version_id FROM units u
      JOIN audit_log a ON a.tenant_id=u.tenant_id AND a.entity_id=u.id AND a.action='workflow.technical_appendix_scope_created' AND a.after_data->>'smokeKey'=$4 AND a.actor_user_id=$5
      JOIN contracts c ON c.tenant_id=u.tenant_id AND c.project_id=u.project_id AND c.unit_id=u.id AND c.id=(a.after_data->>'contractId')::uuid
      JOIN sales_cases s ON s.tenant_id=c.tenant_id AND s.id=c.sales_case_id AND s.status='active' AND s.closed_at IS NULL
      JOIN LATERAL(SELECT * FROM contract_versions WHERE tenant_id=c.tenant_id AND contract_id=c.id ORDER BY version_number DESC LIMIT 1) v ON true
      WHERE u.tenant_id=$1 AND u.project_id=$2 AND u.code=$3 AND c.current_status='draft' AND v.version_status='working' AND v.document_version_id IS NULL`,[TENANT,PROJECT,UNIT,KEY,actor.user_id])).rows[0];
    assert(fixture,'TECH81_WORKING_FIXTURE_REQUIRED');
    const facts=async()=>(await read(`SELECT
      (SELECT count(*)::int FROM contract_documents WHERE tenant_id=$1 AND contract_version_id=$2 AND appendix_number IS NOT NULL) appendices,
      (SELECT count(*)::int FROM audit_log WHERE tenant_id=$1 AND entity_id=$2 AND action='contract.appendix_updated') audits,
      (SELECT count(*)::int FROM payment_obligations WHERE tenant_id=$1 AND contract_id=$3) obligations,
      (SELECT count(*)::int FROM contract_parties WHERE tenant_id=$1 AND contract_id=$3 AND signature_status='signed') signatures`,[TENANT,fixture.version_id,fixture.contract_id])).rows[0];
    assert((await facts()).obligations===0&&(await facts()).signatures===0,'TECH81_UNEXPECTED_BUSINESS_EFFECT');
    const graph=new EntraMicrosoftGraphAdapter(new ManagedIdentityGraphTokenProvider(IDENTITY));
    const repository=new DocumentRepository(database),uploads=new SharePointDocumentUploadService(repository,graph,IDENTITY);
    phase='technical_documents';
    const documents={};
    for(const kind of ['unit','shared']){
      const name=`TECH81 ${kind==='unit'?'JEN BYT 7481':'SPOLEČNÝ TECHNICKÝ DOKUMENT'}`;
      if(mode==='prepare'){
        const uploaded=await uploads.upload({...context,projectId:PROJECT,idempotencyKey:`tech81-appendix-${kind}-v1`,typeCode:'other',documentName:name,fileName:`TECH81-appendix-${kind}.txt`,mimeType:'text/plain',bytes:Buffer.from(text(kind)),versionLabel:'TECH81-v1',status:'ready',...(kind==='unit'?{unitId:fixture.unit_id}:{})});
        documents[kind]={documentId:uploaded.documentId,documentVersionId:uploaded.documentVersionId};
      }
      else{
        const op=(await read("SELECT document_id,document_version_id FROM document_upload_operations WHERE tenant_id=$1 AND project_id=$2 AND idempotency_key=$3 AND state='completed'",[TENANT,PROJECT,`tech81-appendix-${kind}-v1`])).rows[0];
        assert(op,'TECH81_DOCUMENT_REQUIRED');documents[kind]={documentId:op.document_id,documentVersionId:op.document_version_id};
      }
    }
    if(mode==='prepare')return{ok:true,mode,fixture,documents,facts:await facts(),syntheticOnly:true};
    const wrong=(await read("SELECT 1 FROM documents d JOIN document_versions v ON v.tenant_id=d.tenant_id AND v.document_id=d.id JOIN unit_documents l ON l.tenant_id=d.tenant_id AND l.document_id=d.id WHERE d.tenant_id=$1 AND d.project_id=$2 AND d.id=$3 AND v.id=$4 AND l.unit_id=$5 AND v.content_hash=$6",[TENANT,PROJECT,WRONG_DOCUMENT,WRONG_VERSION,WRONG_UNIT,'sha256:bba833ff38479a586d456a06a3d8ede7403ff30464cff3c8cca5411900c3a2d4'])).rowCount;
    assert(wrong===1,'TECH81_KNOWN_FOREIGN_TECHNICAL_DOCUMENT_REQUIRED');
    const contracts=new RsGenerationRepository(database);
    phase='negative_selection';
    const before=await facts();let rejected=false;
    try{await contracts.setAppendix({...context,contractId:fixture.contract_id,versionId:fixture.version_id,number:99,documentId:WRONG_DOCUMENT,documentVersionId:WRONG_VERSION,expectedDocumentVersionId:null});}
    catch(error){if(error.message!=='CONTRACT_APPENDIX_UNIT_MISMATCH')throw error;rejected=true;}
    assert(rejected,'TECH81_FOREIGN_DOCUMENT_ACCEPTED');
    assert(JSON.stringify(before)===JSON.stringify(await facts()),'TECH81_FAILED_SELECTION_CHANGED_DATA');
    if(mode==='negative')return{ok:true,mode,fixture,documents,foreignRejected:true,noMutation:true,syntheticOnly:true};
    phase='verify_browser_selection';
    const links=(await read('SELECT appendix_number,document_id,document_version_id FROM contract_documents WHERE tenant_id=$1 AND contract_version_id=$2 AND appendix_number IS NOT NULL ORDER BY appendix_number',[TENANT,fixture.version_id])).rows;
    assert(links.length===2&&links[0].appendix_number===1&&links[0].document_id===documents.unit.documentId&&links[0].document_version_id===documents.unit.documentVersionId&&links[1].appendix_number===2&&links[1].document_id===documents.shared.documentId&&links[1].document_version_id===documents.shared.documentVersionId,'TECH81_BROWSER_SELECTION_REQUIRED');
    let frozen=false;
    try{await database.withContext(context,c=>c.query('SELECT app.link_document_to_unit($1,$2,$3,$4)',[TENANT,documents.unit.documentId,WRONG_UNIT,MEMBER]));}
    catch(error){if(error.message!=='CONTRACT_APPENDIX_UNIT_LINK_IN_USE')throw error;frozen=true;}
    assert(frozen,'TECH81_UNIT_ASSOCIATION_CHANGED');
    const connection=await repository.getConnectionForUpload({...context,projectId:PROJECT});assert(connection,'TECH81_CONNECTION_REQUIRED');
    for(const kind of ['unit','shared']){
      const doc=(await read('SELECT d.external_item_id,v.external_version_id,v.content_hash FROM documents d JOIN document_versions v ON v.tenant_id=d.tenant_id AND v.document_id=d.id WHERE d.tenant_id=$1 AND d.id=$2 AND v.id=$3',[TENANT,documents[kind].documentId,documents[kind].documentVersionId])).rows[0];
      const bytes=await graph.downloadFile({siteId:connection.siteId,driveId:connection.driveId},doc.external_item_id,doc.external_version_id);
      assert(hash(bytes)===hash(Buffer.from(text(kind)))&&doc.content_hash===hash(bytes),'TECH81_EXACT_BYTES_MISMATCH');
    }
    const after=await facts();assert(after.appendices===2&&after.audits===2&&after.signatures===0&&after.obligations===0,'TECH81_COUNTS_MISMATCH');
    return{ok:true,mode,fixture,foreignRejected:true,unitAssociationFrozen:true,exactHashesVerified:true,counts:after,syntheticOnly:true};
  }catch(error){error.smokePhase=phase;throw error;}finally{await database.close();}
}

// Explicit operator invocation only. Not imported by the API or scheduled cron.
// Pure synthetic fixtures; never activate a legal original or adopt a real deal.
import {createHash} from 'node:crypto';
import {strFromU8,unzipSync} from 'fflate';
import {Database} from '../dist/database.js';
import {InventoryRepository} from '../dist/inventory/repository.js';
import {InventoryImportService} from '../dist/inventory/import-service.js';
import {SalesRepository} from '../dist/sales/repository.js';
import {CommercialService} from '../dist/commercial/service.js';
import {PaymentService} from '../dist/payments/service.js';
import {DocumentRepository} from '../dist/documents/repository.js';
import {SharePointDocumentUploadService} from '../dist/documents/upload-service.js';
import {EntraMicrosoftGraphAdapter} from '../dist/documents/graph-adapter.js';
import {ManagedIdentityGraphTokenProvider} from '../dist/documents/managed-identity-token-provider.js';
import {DocumentTemplateGenerationRepository} from '../dist/documents/template-generation-repository.js';
import {DocumentTemplateManagementRepository} from '../dist/documents/template-management-repository.js';
import {DocumentTemplateManagementService} from '../dist/documents/template-management-service.js';
import {DocumentTemplateGenerationService} from '../dist/documents/template-generation-service.js';
import {RsGenerationRepository} from '../dist/contracts/rs-generation-repository.js';
import {RsGenerationService} from '../dist/contracts/rs-generation-service.js';
import {ContractDocumentEvidenceService} from '../dist/contracts/document-evidence-service.js';
import {inspectDocxTemplate,renderDocxTemplate} from '../dist/documents/docx-template.js';
import {RS_PLACEHOLDERS,SBK_DOB_DELIVERY_VARIANT,templateCatalog} from '../dist/documents/template-catalog.js';
import {contractAppendixRequirements} from '../dist/shared/contract-appendices.js';
import {signaturePaymentTerms} from '../dist/contracts/signature-payment-terms.js';
import {originalPaymentPlan} from '../dist/contracts/original-payment-plan.js';

export const SMOKE_KEY='technical-sbk-business-pipeline-v1';
const CODE='TECH72',NAME='TECH SMOKE 0072 – synthetic RS SBK';
const MARKER='TECH72_SYNTHETIC_ONLY',MIME='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=code=>{throw new Error(code);};

export function assertSmokeInput(input){
  if(!input||!['prepare_rs','prepare_sbk','verify','cleanup','recover_empty_fixture'].includes(input.mode))fail('SMOKE_MODE_REQUIRED');
  if(!uuid.test(input.tenantId??'')||!uuid.test(input.membershipId??''))fail('SMOKE_CONTEXT_REQUIRED');
  if(input.projectId&&!uuid.test(input.projectId))fail('SMOKE_PROJECT_ID_INVALID');
  if(input.mode!=='prepare_rs'&&!input.projectId)fail('SMOKE_PROJECT_ID_REQUIRED');
  if(input.mode!=='verify'&&input.confirmSyntheticOnly!==true)fail('SMOKE_EXPLICIT_SYNTHETIC_CONFIRMATION_REQUIRED');
}
export function assertSmokeProject(project,marker,actor,mode){
  if(!project||project.code!==CODE||project.name!==NAME||(project.archived_at&&!['verify','cleanup'].includes(mode))||marker?.smokeKey!==SMOKE_KEY||marker?.actor!==actor)
    fail('SMOKE_PROJECT_NOT_OWNED_SYNTHETIC_FIXTURE');
}
export function assertSyntheticTemplate(bytes,expectedHash,kind){
  if(!['rs','sbk'].includes(kind))fail('SMOKE_TEMPLATE_KIND_INVALID');
  if(!/^[a-f0-9]{64}$/.test(expectedHash??'')||hash(bytes)!==expectedHash)fail('SMOKE_TEMPLATE_HASH_MISMATCH');
  const expected=kind==='rs'?[...RS_PLACEHOLDERS]:Object.keys(templateCatalog('future_purchase_contract',SBK_DOB_DELIVERY_VARIANT).fields);
  const inspected=inspectDocxTemplate(bytes);
  if(inspected.malformedTokens.length||inspected.legacyMarkers.length||JSON.stringify(inspected.tokens)!==JSON.stringify(expected.sort()))fail('SMOKE_TEMPLATE_SCHEMA_INVALID');
  const xml=strFromU8(unzipSync(bytes)['word/document.xml']);
  if(!xml.includes(MARKER)||!xml.includes('Neobsahuje právní smluvní text a nezakládá závazek.'))fail('SMOKE_TEMPLATE_NOT_SYNTHETIC');
}

// Never serialize driver messages, query text, Graph URLs or stack traces.
export function smokeFailure(error,phase,projectId){
  const candidate=error?.code??(/^SMOKE_[A-Z0-9_]+$/.test(error?.message??'')?error.message:undefined);
  return{event:'smoke.sbk_pipeline_failed',phase,projectId,
    code:typeof candidate==='string'&&/^[A-Za-z0-9_]{1,120}$/.test(candidate)?candidate:'SMOKE_OPERATION_FAILED',
    errorName:typeof error?.name==='string'&&/^[A-Za-z]{1,80}$/.test(error.name)?error.name:undefined};
}

// Assertions only: expected stages and due dates come from the existing domain
// projections/calendar. This harness must not become another workflow engine.
export function assertSignedChainEvidence({contracts,unit,next,terms,payments}){
  if(contracts.length!==2||!['rs','sbk'].every(type=>contracts.filter(c=>c.type===type).length===1))fail('SMOKE_SIGNED_CHAIN_REQUIRED');
  for(const c of contracts){
    if(c.status!=='signed'||!c.signedAt||c.signedAt!==c.lastRequiredSignatureAt||!c.allRequiredSigned
      ||c.versionStatus!=='signed'||c.versionSignedAt!==c.signedAt||!c.locked||!c.documentVersionId
      ||c.signatureAudits!==1||c.signatureEvents!==1||c.signatureOutbox!==1||c.versionCount!==1
      ||c.generationCount!==1)fail('SMOKE_SIGNATURE_EVIDENCE_INVALID');
    if(c.unitId!==unit.id||c.salesCaseId!==unit.salesCaseId)fail('SMOKE_BUSINESS_CONTEXT_MISMATCH');
  }
  if(unit.caseStatus!=='active'||unit.commercialStatus!=='contracted'||unit.stage!=='sbk'
    ||next.salesCaseId!==unit.salesCaseId||next.kind!=='create_contract'||next.contractType!=='ks'
    ||next.salesProcess?.reviewRequired||next.salesProcess?.currentStage!=='ks'
    ||!['rs','sbk'].every(code=>next.salesProcess?.steps.some(step=>step.code===code&&step.state==='complete')))
    fail('SMOKE_SBK_WORKFLOW_INCONSISTENT');
  const sbk=contracts.find(c=>c.type==='sbk');
  if(!terms||terms.contractType!=='sbk'||terms.precedingRsContractId!==contracts.find(c=>c.type==='rs').id)
    fail('SMOKE_SBK_PAYMENT_SNAPSHOT_INVALID');
  const expected=originalPaymentPlan({type:'sbk',totalPrice:terms.totalPrice,reservationFeeAmount:terms.reservationFee,
    paidReservationFeeAmount:terms.paidReservationFee,effectiveSignatureAt:sbk.signedAt}).filter(row=>row.state==='scheduled');
  if(payments.length!==expected.length||payments.some(row=>row.contractVersionId!==sbk.versionId
    ||row.unitId!==unit.id||row.salesCaseId!==unit.salesCaseId
    ||!expected.some(plan=>plan.key===row.schedule_key&&plan.amount===row.amount&&plan.dueOn===row.dueOn)))
    fail('SMOKE_SBK_PAYMENT_PLAN_INVALID');
}

export async function runSbkSmoke(input){
  assertSmokeInput(input);
  if(['prepare_rs','prepare_sbk'].includes(input.mode))for(const kind of ['rs','sbk']){
    const file=input.templates?.[kind];if(!file)fail('SMOKE_TEMPLATE_INPUT_REQUIRED');
    assertSyntheticTemplate(Buffer.from(file.base64,'base64'),file.sha256,kind);
  }
  const database=new Database(input.databaseUrl),tenantId=input.tenantId,membershipId=input.membershipId;
  let projectId=input.projectId,phase='authorize';
  try{
    const actor=await database.withContext({tenantId},async c=>(await c.query("SELECT user_id FROM tenant_memberships WHERE tenant_id=$1 AND id=$2 AND status='active'",[tenantId,membershipId])).rows[0],{readOnly:true});
    if(!actor)fail('SMOKE_ACTIVE_ACTOR_REQUIRED');
    const context={tenantId,membershipId,userId:actor.user_id};
    const sql=(q,values=[])=>database.withContext(context,c=>c.query(q,values),input.mode==='verify'?{readOnly:true}:undefined);
    const safe=(await sql("SELECT NOT rolsuper AND NOT rolbypassrls AND pg_has_role(current_user,'develocrm_app','member') safe,app.current_user_has_permission('system.manage') allowed FROM pg_roles WHERE rolname=current_user")).rows[0];
    if(!safe?.safe||!safe.allowed)fail('SMOKE_NON_ADMIN_RUNTIME_AND_SYSTEM_PERMISSION_REQUIRED');
    const inventory=new InventoryRepository(database),imports=new InventoryImportService(database),sales=new SalesRepository(database),commercial=new CommercialService(database),payments=new PaymentService(database);
    const graph=new EntraMicrosoftGraphAdapter(new ManagedIdentityGraphTokenProvider(input.managedIdentityClientId)),documents=new DocumentRepository(database);
    const uploads=new SharePointDocumentUploadService(documents,graph,input.managedIdentityClientId),generationRepo=new DocumentTemplateGenerationRepository(database);
    const management=new DocumentTemplateManagementService(new DocumentTemplateManagementRepository(database),generationRepo,documents,uploads,graph);
    const preparationRepo=new RsGenerationRepository(database),generation=new RsGenerationService(preparationRepo,new DocumentTemplateGenerationService(generationRepo,documents,uploads,graph));
    const evidence=new ContractDocumentEvidenceService(database,graph,uploads,input.managedIdentityClientId);
    if(input.mode==='recover_empty_fixture'){
      // Explicit UUID only, recent same-actor domain creation and no children.
      // This recovery is never inferred from a matching project name alone.
      await database.withContext(context,async client=>{
        const candidate=(await client.query(`SELECT p.id FROM projects p WHERE p.tenant_id=$1 AND p.id=$2
          AND p.code=$3 AND p.name=$4 AND p.note=$5 AND p.archived_at IS NULL
          AND EXISTS(SELECT 1 FROM audit_log a WHERE a.tenant_id=p.tenant_id AND a.entity_id=p.id
            AND a.action='project.created' AND a.actor_user_id=$6 AND a.occurred_at>now()-interval '30 minutes')
          AND NOT EXISTS(SELECT 1 FROM units u WHERE u.tenant_id=p.tenant_id AND u.project_id=p.id)
          AND NOT EXISTS(SELECT 1 FROM contracts c WHERE c.tenant_id=p.tenant_id AND c.project_id=p.id)
          AND NOT EXISTS(SELECT 1 FROM documents d WHERE d.tenant_id=p.tenant_id AND d.project_id=p.id)
          FOR UPDATE`,[tenantId,projectId,CODE,NAME,SMOKE_KEY,context.userId])).rows[0];
        if(!candidate)fail('SMOKE_EMPTY_FIXTURE_RECOVERY_NOT_ALLOWED');
        const markers=await client.query("SELECT 1 FROM audit_log WHERE tenant_id=$1 AND entity_id=$2 AND action='workflow.technical_sbk_smoke_created'",[tenantId,projectId]);
        if(!markers.rowCount)await client.query("INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data) VALUES($1,$2::uuid,'workflow.technical_sbk_smoke_created','project',$3,jsonb_build_object('smokeKey',$4::text,'actor',($2::uuid)::text,'syntheticOnly',true,'recoveredEmptyFixture',true))",[tenantId,context.userId,projectId,SMOKE_KEY]);
      });
      console.log(JSON.stringify({event:'smoke.sbk_empty_fixture_recovered',projectId}));
      return{ok:true,projectId,phase:'recover_empty_fixture'};
    }
    if(!projectId){
      if((await sql('SELECT 1 FROM projects WHERE tenant_id=$1 AND code=$2',[tenantId,CODE])).rowCount)fail('SMOKE_PROJECT_EXISTS_RESUME_BY_EXPLICIT_ID');
      // Keep the domain creation and ownership marker in one transaction. A
      // marker failure must not leave an unowned project behind.
      const created=await database.withContext(context,async client=>{
        const result=(await client.query("SELECT app.create_project($1,$2,$3,$4,$5,NULL,NULL,NULL,'preparation',NULL,NULL,NULL,'CZK',NULL,$6) id",[tenantId,membershipId,NAME,CODE,'technical-sbk-0072',SMOKE_KEY])).rows[0];
        await client.query("INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data) VALUES($1,$2::uuid,'workflow.technical_sbk_smoke_created','project',$3,jsonb_build_object('smokeKey',$4::text,'actor',($2::uuid)::text,'syntheticOnly',true))",[tenantId,context.userId,result.id,SMOKE_KEY]);
        return result;
      });
      projectId=created.id;
      console.log(JSON.stringify({event:'smoke.sbk_project_created',projectId,syntheticOnly:true}));
    }
    const project=(await sql('SELECT id,code,name,archived_at FROM projects WHERE tenant_id=$1 AND id=$2',[tenantId,projectId])).rows[0];
    const marker=(await sql("SELECT after_data FROM audit_log WHERE tenant_id=$1 AND entity_id=$2 AND action='workflow.technical_sbk_smoke_created' ORDER BY occurred_at LIMIT 1",[tenantId,projectId])).rows[0]?.after_data;
    assertSmokeProject(project,marker,context.userId,input.mode);
    const scoped={...context,projectId};
    const contract=async type=>(await sql('SELECT id,current_status FROM contracts WHERE tenant_id=$1 AND project_id=$2 AND contract_type=$3 AND reference=$4',[tenantId,projectId,type,`${CODE}-${type.toUpperCase()}-SYNTHETIC`])).rows[0];
    const unit=async()=> (await sql('SELECT id FROM units WHERE tenant_id=$1 AND project_id=$2 AND code=$3',[tenantId,projectId,'7201'])).rows[0];
    const latest=async id=>(await sql('SELECT id,version_number,document_version_id FROM contract_versions WHERE tenant_id=$1 AND project_id=$2 AND contract_id=$3 ORDER BY version_number DESC LIMIT 1',[tenantId,projectId,id])).rows[0];
    const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Prague'}).format(new Date());

    async function ensureTemplate(type){
      phase=`${type}.template_source`;
      const file=input.templates?.[type];if(!file)fail('SMOKE_TEMPLATE_INPUT_REQUIRED');
      const bytes=Buffer.from(file.base64,'base64');assertSyntheticTemplate(bytes,file.sha256,type);
      const code=`tech72-synthetic-${type}`;let found=(await management.list({...scoped})).find(t=>t.code===code);
      if(!found){await management.upload({...scoped,code,name:`TECH72 ${type.toUpperCase()} BEZ PRÁVNÍHO TEXTU`,outputTypeCode:type==='rs'?'reservation_contract':'future_purchase_contract',
        variantKey:type==='rs'?'default':SBK_DOB_DELIVERY_VARIANT,versionLabel:'synthetic-v1',effectiveFrom:today,fileName:`TECH72-${type}-synthetic.docx`,mimeType:MIME,bytes});
        found=(await management.list({...scoped})).find(t=>t.code===code);}
      if(found?.versions.length!==1)fail('SMOKE_TEMPLATE_VERSION_AMBIGUOUS');
      const v=found.versions[0],target={...context,templateId:found.id,versionId:v.id};
      // Inspect the exact persisted source again before approval. Never approve
      // a user-uploaded legal draft merely because it has a compatible schema.
      const persisted=await management.source(target);const xml=strFromU8(unzipSync(persisted.bytes)['word/document.xml']);
      const expectedXml=strFromU8(unzipSync(bytes)['word/document.xml']);
      if(xml!==expectedXml)fail('SMOKE_PERSISTED_SOURCE_NOT_SYNTHETIC');
      phase=`${type}.template_validate`;
      if(v.status==='draft')await management.validate(target);
      phase=`${type}.template_approve`;
      if(v.status!=='approved')await management.approve(target);
      return target;
    }
    async function generateAndPrepare(c,type){
      phase=`${type}.prepare`;
      const v=await latest(c.id);if(c.current_status==='signed')return{contractId:c.id,versionId:v.id,alreadySigned:true};
      if(!v.document_version_id){
        if(type==='sbk'){
          phase='sbk.signing_plan';
          const current=await preparationRepo.load({...context,contractId:c.id,permission:'contract.manage'});
          await generation.setSigningPlan({...context,contractId:c.id,versionId:v.id,
            sellerPlannedOn:current?.signingPlan?.sellerPlannedOn??today,buyerPlannedOn:current?.signingPlan?.buyerPlannedOn??today});
          phase='sbk.payment_terms';
          await generation.preparePaymentTerms({...context,contractId:c.id,versionId:v.id});
          const rsBytes=Buffer.from(input.templates.rs.base64,'base64');assertSyntheticTemplate(rsBytes,input.templates.rs.sha256,'rs');
          const appendix=renderDocxTemplate(rsBytes,Object.fromEntries(RS_PLACEHOLDERS.map(k=>[k,'NEPLATNÁ TECHNICKÁ PŘÍLOHA'])),{allowedTokens:RS_PLACEHOLDERS,requiredTokens:RS_PLACEHOLDERS}).bytes;
          for(const required of contractAppendixRequirements('sbk',SBK_DOB_DELIVERY_VARIANT)){
            phase=`sbk.appendix_${required.number}`;
            const uploaded=await uploads.upload({...scoped,unitId:(await unit()).id,contractId:c.id,typeCode:'other',documentName:`TECH72 příloha ${required.number} BEZ PRÁVNÍHO ÚČINKU`,
              fileName:`TECH72-appendix-${required.number}.docx`,mimeType:MIME,bytes:appendix,versionLabel:'synthetic-v1',status:'ready',idempotencyKey:`tech72-appendix-${required.number}`});
            const source=await preparationRepo.load({...context,contractId:c.id,permission:'contract.manage'});
            const selected=source?.appendixSelections?.find(item=>item.number===required.number);
            if(selected?.documentVersionId!==uploaded.documentVersionId)
              await generation.setAppendix({...context,contractId:c.id},{versionId:v.id,number:required.number,documentId:uploaded.documentId,documentVersionId:uploaded.documentVersionId,expectedDocumentVersionId:selected?.documentVersionId??null});
          }
        }
        const ready=await generation.readiness({...context,contractId:c.id});if(!ready.ready)fail(`SMOKE_NOT_READY_${ready.issues.map(i=>i.code).join('_').toUpperCase()}`);
        phase=`${type}.generate`;
        const request={...context,contractId:c.id,idempotencyKey:`tech72-generate-${type}`};
        const first=await generation.generate(request),replay=await generation.generate(request);
        if(!replay.replayed||first.documentVersionId!==replay.documentVersionId||first.contractVersionId!==replay.contractVersionId)fail('SMOKE_GENERATION_RETRY_DUPLICATED');
      }
      const exact=await evidence.signableFile({...context,contractId:c.id,versionId:(await latest(c.id)).id});
      const text=strFromU8(unzipSync(exact.bytes)['word/document.xml']);
      if(inspectDocxTemplate(exact.bytes).tokens.length||!text.includes(MARKER))fail('SMOKE_RENDER_EVIDENCE_INVALID');
      const state=(await contract(type)).current_status;
      for(const to of state==='draft'?['sent','approved']:state==='sent'||state==='negotiation'?['approved']:[])
        await commercial.transition({...context,contractId:c.id,to,reason:'TECH72 syntetický test bez právního účinku',idempotencyKey:`tech72-${type}-${to}`});
      return{contractId:c.id,versionId:(await latest(c.id)).id,exactFileVerified:true,bytes:exact.bytes.length};
    }

    if(input.mode==='prepare_rs'){
      phase='prepare_rs';let rs=await contract('rs');
      if(!rs){
        await inventory.updateProject({...scoped,name:NAME,lifecycleStatus:'active',plannedHandoverFrom:'2027-12-01',contractSettings:{name:'NEPLATNÝ TECHNICKÝ PRODÁVAJÍCÍ',registrationNumber:'00000000',address:'Technická 72, Test',
          registryEntry:'NEPLATNÝ TESTOVACÍ ZÁPIS',representative:'Testovacím zástupcem',email:'tech72-seller@example.test',dataBox:'TECH72',bankAccount:'TECH72-NEPLATNY',bankName:'TECHNICKÁ BANKA',
          signatureName:'NEPLATNÝ TESTOVACÍ PODPIS',clientChangesBankAccount:'TECH72-NEPLATNY-2',deliveryAddress:'Technické doručování 72, Test',reservationPeriodDays:30}});
        await imports.createUnit({...scoped,idempotencyKey:'tech72-create-unit',row:{rowNumber:1,code:'7201',layout:'2+kk',areaM2:55.5,usableAreaM2:51,balconyM2:5,gardenM2:12,floorLabel:'3. NP',price:5000000,commercialStatus:'available'}});
        const u=await unit();await inventory.updateUnit({...context,unitId:u.id,layout:'2+kk',floorLabel:'3. NP',floorNumber:3,areaM2:55.5,usableAreaM2:51,balconyM2:5,gardenM2:12});
        for(const item of [{code:'TECH72-S',category:'cellar',legalForm:'cellar_unit',floorLabel:'1.PP',amount:100000},
          {code:'TECH72-P',category:'parking',legalForm:'outdoor_parking_use_right',floorLabel:'1.NP',amount:200000},
          {code:'TECH72-G',category:'parking',legalForm:'garage_coownership',floorLabel:'1.PP',amount:200000}]){
          let a=(await sql('SELECT id FROM accessories WHERE tenant_id=$1 AND project_id=$2 AND code=$3',[tenantId,projectId,item.code])).rows[0];
          if(!a){a=await inventory.createAccessory({...scoped,...item});await inventory.updateAccessory({...context,accessoryId:a.id,...item,legalDetails:{legalForm:item.legalForm,...(item.legalForm==='garage_coownership'?{shareNumerator:1,shareDenominator:25}:{})}});}
          const active=(await sql('SELECT unit_id FROM unit_accessory_assignments WHERE tenant_id=$1 AND accessory_id=$2 AND valid_to IS NULL',[tenantId,a.id])).rows;
          if(active.length>1||active.some(link=>link.unit_id!==u.id))fail('SMOKE_ACCESSORY_ASSIGNMENT_CONFLICT');
          if(!active.length)await inventory.assignAccessory({...context,unitId:u.id,accessoryId:a.id});
        }
        const hold=(await sql("SELECT * FROM app.create_party_and_unit_hold($1,$2,'pre_reservation',now()+interval '48 hours',$3,$4,$5,'individual','pan','TECH72','NEPLATNY TEST',NULL,NULL,$6,$7)",
          [tenantId,u.id,membershipId,'tech72-create-hold','TECH72 syntetický obchod bez právního účinku','tech72-buyer@example.test','+420000000072'])).rows[0];
        await sales.updateProfile({...context,partyId:hold.party_id,firstName:'TECH72',lastName:'NEPLATNY TEST',salutation:'pan',birthDate:'2000-01-01'});
        for(const addressType of ['residence','correspondence'])await sales.upsertAddress({...context,partyId:hold.party_id,addressType,line1:'Technická 72',city:'Test',postalCode:'00000',countryCode:'CZ'});
        await ensureTemplate('rs');
        rs=await commercial.createContract({...context,salesCaseId:hold.sales_case_id,type:'rs',reference:`${CODE}-RS-SYNTHETIC`,title:'TECH72 NEPLATNÝ TEST RS',
          idempotencyKey:'tech72-create-rs',paymentCalculationType:'fixed',paymentInputValue:250000,paymentDueAt:new Date(Date.now()+7*86400000).toISOString()});
        rs=await contract('rs');
      }
      console.log(JSON.stringify({event:'smoke.sbk_rs_prepared',projectId,unitId:(await unit()).id,...await generateAndPrepare(rs,'rs'),requiresBrowserSignature:true}));
    }else if(input.mode==='prepare_sbk'){
      phase='prepare_sbk';const rs=await contract('rs');if(rs?.current_status!=='signed')fail('SMOKE_BROWSER_RS_SIGNATURE_REQUIRED');
      const obligation=(await sql("SELECT id,amount::float8 amount FROM payment_obligations WHERE tenant_id=$1 AND project_id=$2 AND contract_id=$3 AND obligation_type='reservation_fee' AND cancelled_at IS NULL",[tenantId,projectId,rs.id])).rows;
      if(obligation.length!==1||obligation[0].amount!==250000)fail('SMOKE_RS_PAYMENT_UNEXPECTED');
      phase='sbk.record_technical_fee';
      await payments.record({...context,obligationId:obligation[0].id,amount:250000,paidAt:new Date().toISOString(),note:'TECH72 účetní simulace bez přesunu peněz',idempotencyKey:'tech72-paid-rs-fee'});
      await ensureTemplate('sbk');let sbk=await contract('sbk');
      phase='sbk.create_contract';
      if(!sbk){const sale=(await sql('SELECT sales_case_id FROM contracts WHERE tenant_id=$1 AND project_id=$2 AND id=$3',[tenantId,projectId,rs.id])).rows[0];
        await commercial.createContract({...context,salesCaseId:sale.sales_case_id,type:'sbk',reference:`${CODE}-SBK-SYNTHETIC`,title:'TECH72 NEPLATNÝ TEST SBK',idempotencyKey:'tech72-create-sbk',paymentTiming:'signature'});sbk=await contract('sbk');}
      console.log(JSON.stringify({event:'smoke.sbk_document_prepared',projectId,unitId:(await unit()).id,...await generateAndPrepare(sbk,'sbk'),requiresBrowserSignature:true}));
    }else if(input.mode==='cleanup'){
      phase='cleanup';if((await contract('sbk'))?.current_status!=='signed')fail('SMOKE_COMPLETED_SBK_REQUIRED');
      for(const t of (await management.list({...scoped})).filter(t=>t.code.startsWith('tech72-synthetic-')))
        for(const v of t.versions)if(v.status==='approved')await management.retire({...context,templateId:t.id,versionId:v.id});
      if(!project.archived_at)await inventory.setArchived({...scoped,archived:true});
      console.log(JSON.stringify({event:'smoke.sbk_cleanup',projectId,newTechnicalProjectArchived:true,sharePointFilesDeleted:false}));
    }else{
      phase='verify';const result=[];
      for(const type of ['rs','sbk']){const c=await contract(type);if(c?.current_status!=='signed')fail('SMOKE_SIGNED_CHAIN_REQUIRED');const v=await latest(c.id);
        const exact=await evidence.exactFile({...context,contractId:c.id,versionId:v.id});if(inspectDocxTemplate(exact.bytes).tokens.length)fail('SMOKE_UNRESOLVED_FIELDS');
        result.push({type,contractId:c.id,versionId:v.id,documentVersionId:exact.evidence.documentVersionId,exactHashVerified:true});}
      const sbk=await contract('sbk');
      const source=await preparationRepo.load({...context,contractId:sbk.id,permission:'contract.read'});
      const terms=signaturePaymentTerms(source?.paymentTerms);if(!terms)fail('SMOKE_SBK_PAYMENT_SNAPSHOT_INVALID');
      const rows=(await sql(`SELECT schedule_key,amount::text,(due_at AT TIME ZONE 'Europe/Prague')::date::text "dueOn",
        contract_version_id "contractVersionId",unit_id "unitId",sales_case_id "salesCaseId"
        FROM payment_obligations WHERE tenant_id=$1 AND project_id=$2 AND contract_id=$3 AND cancelled_at IS NULL`,[tenantId,projectId,sbk.id])).rows;
      const u=(await unit()).id;
      const unitState=(await sql(`SELECT u.id,u.commercial_status "commercialStatus",s.id "salesCaseId",s.status "caseStatus",s.current_stage stage
        FROM units u JOIN sales_cases s ON s.tenant_id=u.tenant_id AND s.unit_id=u.id AND s.status='active'
        WHERE u.tenant_id=$1 AND u.project_id=$2 AND u.id=$3`,[tenantId,projectId,u])).rows;
      if(unitState.length!==1)fail('SMOKE_ACTIVE_CASE_AMBIGUOUS');
      const facts=(await sql(`SELECT c.id,c.contract_type type,c.current_status status,c.unit_id "unitId",c.sales_case_id "salesCaseId",
        c.signed_at "signedAt",v.id "versionId",v.version_status "versionStatus",v.signed_at "versionSignedAt",
        v.locked_at IS NOT NULL locked,v.document_version_id "documentVersionId",
        (SELECT max(p.signed_at) FROM contract_parties p WHERE p.tenant_id=c.tenant_id AND p.contract_id=c.id AND p.signing_required) "lastRequiredSignatureAt",
        EXISTS(SELECT 1 FROM contract_parties p WHERE p.tenant_id=c.tenant_id AND p.contract_id=c.id AND p.signing_required)
          AND NOT EXISTS(SELECT 1 FROM contract_parties p WHERE p.tenant_id=c.tenant_id AND p.contract_id=c.id AND p.signing_required
            AND (p.signature_status<>'signed' OR p.signed_version_id IS DISTINCT FROM v.id OR p.signed_at IS NULL)) "allRequiredSigned",
        (SELECT count(*)::int FROM audit_log a WHERE a.tenant_id=c.tenant_id AND a.entity_id=c.id AND a.action='contract.signed') "signatureAudits",
        (SELECT count(*)::int FROM contract_status_events e WHERE e.tenant_id=c.tenant_id AND e.contract_id=c.id AND e.to_status='signed') "signatureEvents",
        (SELECT count(*)::int FROM outbox_events e WHERE e.tenant_id=c.tenant_id AND e.aggregate_id=c.id AND e.event_type='contract.signed.v1') "signatureOutbox",
        (SELECT count(*)::int FROM contract_versions x WHERE x.tenant_id=c.tenant_id AND x.contract_id=c.id) "versionCount",
        (SELECT count(*)::int FROM document_generation_operations g WHERE g.tenant_id=c.tenant_id AND g.contract_id=c.id AND g.state='completed') "generationCount"
        FROM contracts c JOIN contract_versions v ON v.tenant_id=c.tenant_id AND v.contract_id=c.id
        WHERE c.tenant_id=$1 AND c.project_id=$2 AND c.id=ANY($3::uuid[])`,[tenantId,projectId,result.map(item=>item.contractId)])).rows
        .map(row=>({...row,signedAt:row.signedAt?.toISOString(),versionSignedAt:row.versionSignedAt?.toISOString(),lastRequiredSignatureAt:row.lastRequiredSignatureAt?.toISOString()}));
      const next=await commercial.nextContractAction({...context,unitId:u});
      assertSignedChainEvidence({contracts:facts,unit:unitState[0],next,terms,payments:rows});
      console.log(JSON.stringify({event:'smoke.sbk_chain_verified',projectId,results:result,payments:rows,nextAction:next.kind,
        nextContractType:next.contractType,commercialStatus:unitState[0].commercialStatus,signatureAuditVerified:true,syntheticOnly:true}));
    }
    return{ok:true,projectId,phase};
  }catch(error){console.error(JSON.stringify(smokeFailure(error,phase,projectId)));return{ok:false,projectId,phase};}
  finally{await database.close();}
}

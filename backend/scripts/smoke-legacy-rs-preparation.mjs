// New TECH82 fixture only: models an unsigned imported record with no agreed
// terms. Never patches an existing contract to manufacture this condition.
import {createHash,randomUUID} from 'node:crypto';
import {Database} from '../dist/database.js';
import {InventoryImportService} from '../dist/inventory/import-service.js';
import {HoldService} from '../dist/sales/hold-service.js';
const TENANT='60bed28c-0c89-4a38-bac7-71e6cf7b9232',MEMBER='40b59cc5-0007-436e-82dd-b30eef82e6eb';
const PROJECT='cd3605bd-9ef7-461b-b3f2-54f0447fff60',UNIT='7482',KEY='technical-legacy-rs-preparation-v1';
const LEGACY_PAYLOAD={source:'synthetic_legacy_import',physicalDocumentAvailable:false,technicalOnly:true,smokeKey:KEY};
const payloadHash=value=>createHash('sha256').update(JSON.stringify(value,Object.keys(value).sort())).digest('hex');
const assert=(value,code)=>{if(!value)throw Error(code);};
export async function runLegacyRsPreparationSmoke({mode,databaseUrl}){
 assert(['prepare','verify'].includes(mode),'TECH82_MODE_REQUIRED');
 const database=new Database(databaseUrl);let phase='authorize';
 try{
  const actor=await database.withContext({tenantId:TENANT},async c=>(await c.query("SELECT user_id FROM tenant_memberships WHERE tenant_id=$1 AND id=$2 AND status='active'",[TENANT,MEMBER])).rows[0],{readOnly:true});
  assert(actor,'TECH82_ACTOR_REQUIRED');const context={tenantId:TENANT,userId:actor.user_id,membershipId:MEMBER};
  const read=(sql,values=[])=>database.withContext(context,c=>c.query(sql,values),{readOnly:true});
  const allowed=(await read("SELECT NOT rolsuper AND NOT rolbypassrls AND pg_has_role(current_user,'develocrm_app','member') safe,app.current_user_has_permission('system.manage') allowed FROM pg_roles WHERE rolname=current_user")).rows[0];
  assert(allowed?.safe&&allowed.allowed,'TECH82_SAFE_ROLE_REQUIRED');
  const owned=(await read("SELECT 1 FROM projects p WHERE p.tenant_id=$1 AND p.id=$2 AND p.code='TECH74' AND p.name='TECH SMOKE 0074 – approved original profiles' AND p.archived_at IS NULL AND EXISTS(SELECT 1 FROM audit_log a WHERE a.tenant_id=p.tenant_id AND a.entity_id=p.id AND a.action='workflow.technical_sbk_smoke_created' AND a.after_data->>'smokeKey'='technical-approved-original-pipeline-v1' AND a.after_data->>'actor'=$3::text)",[TENANT,PROJECT,actor.user_id])).rowCount;
  assert(owned===1,'TECH82_OWNED_PROJECT_REQUIRED');
  phase='synthetic_fixture';
  if(mode==='prepare')await database.withContext(context,async c=>{
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${TENANT}:${PROJECT}:${KEY}`]);
   const existing=(await c.query('SELECT id FROM units WHERE tenant_id=$1 AND project_id=$2 AND code=$3',[TENANT,PROJECT,UNIT])).rows[0];
   if(existing){assert((await c.query("SELECT 1 FROM audit_log WHERE tenant_id=$1 AND entity_id=$2 AND action='workflow.technical_legacy_rs_created' AND after_data->>'smokeKey'=$3 AND actor_user_id=$4",[TENANT,existing.id,KEY,actor.user_id])).rowCount===1,'TECH82_UNIT_NOT_OWNED');return;}
   const transaction={withContext:async(_context,work)=>work(c)};
   await new InventoryImportService(transaction).createUnit({...context,projectId:PROJECT,idempotencyKey:'tech82-unit-v1',row:{rowNumber:1,code:UNIT,layout:'1+kk',areaM2:30,price:2500000}});
   const unit=(await c.query('SELECT id FROM units WHERE tenant_id=$1 AND project_id=$2 AND code=$3',[TENANT,PROJECT,UNIT])).rows[0];
   const hold=await new HoldService(transaction).createWithParty({...context,unitId:unit.id,type:'pre_reservation',expiresAt:new Date(Date.now()+48*3600000).toISOString(),idempotencyKey:'tech82-hold-v1',reason:'TECH82 neprávní test přípravy importu; bez podpisu',newParty:{kind:'individual',firstName:'TECH82',lastName:'LEGACY RS',email:'tech82-legacy-rs@example.test'}});
   const accessory=(await c.query("SELECT app.create_project_accessory($1,$2,'cellar','TECH82-S1',2,100000,NULL,NULL,$3) id",[TENANT,PROJECT,MEMBER])).rows[0];
   await c.query('SELECT app.assign_accessory_to_unit($1,$2,$3,clock_timestamp(),$4)',[TENANT,unit.id,accessory.id,MEMBER]);
   await c.query('SELECT app.lock_workflow_unit($1,$2)',[TENANT,unit.id]);
   const contractId=randomUUID(),versionId=randomUUID();
   // Same imported-record shape as the existing import, not a post-hoc UPDATE
   // of a domain-created contract and never a replacement of a real case.
   await c.query(`INSERT INTO contracts(id,tenant_id,project_id,unit_id,sales_case_id,contract_type,reference,title,current_status,
    created_by_membership_id,unit_price_snapshot,accessory_price_snapshot,total_price_snapshot,reservation_fee_amount)
    VALUES($1,$2,$3,$4,$5,'rs','TECH82-LEGACY-RS','TECH82 neprávní test importované RS','draft',$6,NULL,'[]'::jsonb,NULL,NULL)`,[contractId,TENANT,PROJECT,unit.id,hold.sales_case_id,MEMBER]);
   await c.query(`INSERT INTO contract_versions(id,tenant_id,project_id,contract_id,version_number,source_type,display_name,generation_payload,created_by_membership_id)
    VALUES($1,$2,$3,$4,1,'imported','TECH82 neprávní import v01',$5::jsonb,$6)`,[versionId,TENANT,PROJECT,contractId,JSON.stringify(LEGACY_PAYLOAD),MEMBER]);
   await c.query(`INSERT INTO contract_parties(tenant_id,project_id,contract_id,party_id,participant_role,signing_required,is_primary_buyer)
    SELECT tenant_id,project_id,$3,party_id,'buyer',true,is_primary FROM sales_case_parties WHERE tenant_id=$1 AND sales_case_id=$2 AND left_at IS NULL AND participant_role='buyer'`,[TENANT,hold.sales_case_id,contractId]);
   await c.query(`INSERT INTO contract_status_events(tenant_id,project_id,contract_id,from_status,to_status,command,reason,recorded_by_membership_id,source)
    VALUES($1,$2,$3,NULL,'draft','technicalLegacyImport','TECH82 syntetický import; nejde o právní smlouvu',$4,'automation')`,[TENANT,PROJECT,contractId,MEMBER]);
   const evidence={smokeKey:KEY,contractId,versionId,salesCaseId:hold.sales_case_id,accessoryId:accessory.id,originalPayloadHash:payloadHash(LEGACY_PAYLOAD),syntheticOnly:true};
   await c.query(`INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data) VALUES($1,$2,'workflow.technical_legacy_rs_created','unit',$3,$4::jsonb)`,[TENANT,actor.user_id,unit.id,JSON.stringify(evidence)]);
   await c.query(`INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload) VALUES($1,'unit',$2,'workflow.technical_legacy_rs_created.v1',$3::jsonb)`,[TENANT,unit.id,JSON.stringify(evidence)]);
  });
  const fixture=(await read(`SELECT u.id unit_id,a.after_data->>'contractId' contract_id,a.after_data->>'versionId' original_version_id
   FROM units u JOIN audit_log a ON a.tenant_id=u.tenant_id AND a.entity_id=u.id AND a.action='workflow.technical_legacy_rs_created'
   WHERE u.tenant_id=$1 AND u.project_id=$2 AND u.code=$3 AND a.after_data->>'smokeKey'=$4 AND a.actor_user_id=$5`,[TENANT,PROJECT,UNIT,KEY,actor.user_id])).rows[0];
  assert(fixture,'TECH82_FIXTURE_REQUIRED');
  const facts=(await read(`SELECT c.unit_price_snapshot::text unit_price,c.total_price_snapshot::text total_price,c.reservation_fee_amount::text fee,c.current_status,
   (SELECT count(*)::int FROM contract_versions v WHERE v.tenant_id=c.tenant_id AND v.contract_id=c.id) versions,
   (SELECT count(*)::int FROM contract_parties p WHERE p.tenant_id=c.tenant_id AND p.contract_id=c.id AND p.signature_status='signed') signatures,
   (SELECT count(*)::int FROM payment_obligations o WHERE o.tenant_id=c.tenant_id AND o.contract_id=c.id) obligations,
   (SELECT count(*)::int FROM contract_documents d WHERE d.tenant_id=c.tenant_id AND d.contract_id=c.id) documents,
   (SELECT count(*)::int FROM audit_log a WHERE a.tenant_id=c.tenant_id AND a.entity_id=c.id AND a.action='contract.legacy_terms_prepared') preparations,
   (SELECT count(*)::int FROM outbox_events e WHERE e.tenant_id=c.tenant_id AND e.aggregate_id=c.id AND e.event_type='contract.legacy_terms_prepared.v1') preparation_events,
   (SELECT generation_payload FROM contract_versions v WHERE v.tenant_id=c.tenant_id AND v.id=$3::uuid) original_payload,
   app.current_unit_price(c.tenant_id,c.unit_id,now())::text current_unit_price,
   app.current_unit_accessory_price(c.tenant_id,c.unit_id,now())::text current_accessory_price
   FROM contracts c WHERE c.tenant_id=$1 AND c.id=$2::uuid AND c.project_id=$4`,[TENANT,fixture.contract_id,fixture.original_version_id,PROJECT])).rows[0];
  assert(facts&&facts.signatures===0&&facts.obligations===0&&facts.documents===0&&payloadHash(facts.original_payload)===payloadHash(LEGACY_PAYLOAD),'TECH82_UNEXPECTED_BUSINESS_EFFECT');
  if(mode==='verify')assert(facts.versions===2&&facts.preparations===1&&facts.preparation_events===1&&Number(facts.unit_price)===2500000&&Number(facts.total_price)===2600000&&Number(facts.fee)===10000&&facts.current_status==='draft'&&Number(facts.current_unit_price)===2500000&&Number(facts.current_accessory_price)===100000,'TECH82_BROWSER_PREPARATION_REQUIRED');
  return{ok:true,mode,fixture,facts,syntheticOnly:true};
 }catch(error){error.smokePhase=phase;throw error;}finally{await database.close();}
}

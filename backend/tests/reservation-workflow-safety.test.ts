import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFile,readdir} from "node:fs/promises";
import test from "node:test";
import {Pool,type PoolClient} from "pg";
import {PGlite} from "@electric-sql/pglite";
import type {SqlClient} from "../src/database.js";
import {bootstrapIds,bootstrapPilotWorkspace,normalizeBootstrapInput} from "../src/iam/pilot-bootstrap.js";
import {importDejvice} from "../src/imports/dejvice.js";
import {getSalesProcessState} from "../src/shared/next-contract-action.js";
import {mapApiError} from "../src/http/api-error.js";
import {Database} from "../src/database.js";
import {expirePreReservations} from "../src/sales/hold-expiry-job.js";
import {signatureDocument} from "./helpers/signature-document.js";
import {InventoryImportService} from "../src/inventory/import-service.js";
import {SalesRepository} from '../src/sales/repository.js';
import {InventoryRepository} from '../src/inventory/repository.js';
import {RsGenerationRepository} from '../src/contracts/rs-generation-repository.js';

async function fixture(postgresUrl?:string){
  const memory=postgresUrl?undefined:new PGlite();
  const databaseName=`workflow_safety_${randomUUID().replaceAll("-","")}`;
  const admin=postgresUrl?new Pool({connectionString:postgresUrl}):undefined;
  if(admin)await admin.query(`CREATE DATABASE "${databaseName}"`);
  const url=postgresUrl?new URL(postgresUrl):undefined;
  if(url)url.pathname=`/${databaseName}`;
  const pool=url?new Pool({connectionString:url.toString()}):undefined;
  const client:SqlClient=pool??{query:async(sql,parameters)=>{
    if(!parameters&&sql.includes(";")){await memory!.exec(sql);return {rows:[],rowCount:null};}
    const result=await memory!.query(sql,parameters as never[]|undefined);
    return {rows:result.rows,rowCount:result.affectedRows??null};
  }} as SqlClient;
  const directory=new URL("../migrations/",import.meta.url);
  for(const name of (await readdir(directory)).filter(name=>/^\d+.*\.sql$/.test(name)&&!name.startsWith('0057')).sort())await client.query(await readFile(new URL(name,directory),"utf8"));
  const normalized=normalizeBootstrapInput({entraTenantId:randomUUID(),adminOid:randomUUID(),adminEmail:"safety.admin@example.test",adminName:"Workflow Safety Test",workspaceName:"Isolated safety tests",workspaceId:randomUUID()});
  const ids=bootstrapIds(normalized);
  await bootstrapPilotWorkspace(client,{...normalized,...ids});
  await importDejvice(client,await readFile(new URL("../seeds/0004_pilot_rezidence_dejvice.sql",import.meta.url),"utf8"),{tenantId:ids.tenantId,membershipId:ids.membershipId,dryRun:false});
  await client.query(await readFile(new URL('0057_price_and_signed_document_integrity.sql',directory),'utf8'));
  async function start(){
    const unit=(await client.query<{id:string}>(`SELECT id FROM units WHERE tenant_id=$1 AND commercial_status='available'
      AND NOT EXISTS(SELECT 1 FROM sales_cases WHERE tenant_id=$1 AND unit_id=units.id AND status='active') ORDER BY code LIMIT 1`,[ids.tenantId])).rows[0];
    assert.ok(unit);
    const hold=(await client.query<{hold_id:string;sales_case_id:string}>(`SELECT * FROM app.create_party_and_unit_hold($1,$2,'pre_reservation',now()+interval '48 hours',$3,$4,'Safety test','individual',NULL,'Safety',$6,NULL,NULL,$5,NULL)`,[ids.tenantId,unit.id,ids.membershipId,randomUUID(),`${randomUUID()}@example.test`,`Buyer ${randomUUID()}`])).rows[0];
    const contract=(await client.query<{contract_id:string;version_id:string}>("SELECT * FROM app.create_contract_with_payment($1,$2,'rs',$3,'Safety RS',$4,NULL,$5,'fixed',250000,now()+interval '7 days')",[ids.tenantId,hold.sales_case_id,`RS-SAFETY-${randomUUID()}`,ids.membershipId,randomUUID()])).rows[0];
    const evidenceClient=pool?await pool.connect():client;
    try{
      await evidenceClient.query('BEGIN');
      await evidenceClient.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)",[ids.tenantId,ids.userId]);
      contract.version_id=await signatureDocument(evidenceClient,ids.tenantId,ids.membershipId,contract.contract_id);
      await evidenceClient.query('COMMIT');
    }catch(error){await evidenceClient.query('ROLLBACK');throw error;}finally{if(pool)(evidenceClient as PoolClient).release();}
    await client.query("SELECT app.transition_contract_status($1,$2,'sent','Safety',$3)",[ids.tenantId,contract.contract_id,ids.membershipId]);
    await client.query("SELECT app.transition_contract_status($1,$2,'approved','Safety',$3)",[ids.tenantId,contract.contract_id,ids.membershipId]);
    return {unitId:unit.id,holdId:hold.hold_id,caseId:hold.sales_case_id,...contract};
  }
  async function past(holdId:string){await client.query("UPDATE unit_holds SET starts_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE id=$1",[holdId]);}
  const expire=(holdId:string,connection:SqlClient=client)=>connection.query<{changed:boolean}>("SELECT app.expire_unit_hold($1,$2,$3) changed",[ids.tenantId,holdId,ids.membershipId]);
  const cancel=(holdId:string,connection:SqlClient=client)=>connection.query("SELECT app.cancel_unit_hold($1,$2,$3,'Safety cancellation')",[ids.tenantId,holdId,ids.membershipId]);
  const sign=(c:{contract_id:string;version_id:string},connection:SqlClient=client)=>connection.query("SELECT * FROM app.sign_contract_externally($1,$2,$3,now(),$4,NULL)",[ids.tenantId,c.contract_id,c.version_id,ids.membershipId]);
  async function state(unitId:string){return (await client.query<{commercial_status:string;current_stage:string}>("SELECT unit.commercial_status,sales_case.current_stage FROM units unit LEFT JOIN LATERAL (SELECT current_stage FROM sales_cases WHERE unit_id=unit.id ORDER BY (status='active') DESC,opened_at DESC,id DESC LIMIT 1) sales_case ON true WHERE unit.id=$1",[unitId])).rows[0];}
  async function events(holdId:string){return (await client.query<{audit:number;outbox:number}>("SELECT (SELECT count(*)::int FROM audit_log WHERE entity_id=$1 AND action='hold.expired') audit,(SELECT count(*)::int FROM outbox_events WHERE aggregate_id=$1 AND event_type='hold.expired.v1') outbox",[holdId])).rows[0];}
  async function close(){if(pool){await pool.end();await admin!.query(`DROP DATABASE "${databaseName}"`);await admin!.end();}else await memory!.close();}
  return {client,pool,connectionUrl:url?.toString(),ids,start,past,expire,cancel,sign,state,events,close};
}

for(const usePostgres of [false,true])test(`client-change active buyer safety (${usePostgres?'PostgreSQL':'PGlite'})`,{skip:usePostgres&&!process.env.WORKFLOW_TEST_DATABASE_URL},async t=>{
  const f=await fixture(usePostgres?process.env.WORKFLOW_TEST_DATABASE_URL:undefined);
  try{
    const c=await f.start(),other=await f.start();
    const party=async(id:string)=>(await f.client.query<{party_id:string}>('SELECT party_id FROM sales_case_parties WHERE sales_case_id=$1 AND left_at IS NULL AND is_primary',[id])).rows[0].party_id;
    const buyer=await party(c.caseId),outsider=await party(other.caseId);
    const project=(await f.client.query<{project_id:string}>('SELECT project_id FROM units WHERE id=$1',[c.unitId])).rows[0].project_id;
    async function create(partyId:string,tenant=f.ids.tenantId,projectId=project){
      const db=f.pool?await f.pool.connect():f.client;
      try{await db.query('BEGIN');await db.query('SET LOCAL ROLE develocrm_app');await db.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)",[f.ids.tenantId,f.ids.userId]);
        const result=await db.query<{id:string}>("SELECT app.create_client_change_v2($1,$2,$3,$4,'Buyer safety','','individual',NULL,'Test',NULL,'CZK',current_date,NULL,NULL,$5) id",[tenant,projectId,c.unitId,partyId,f.ids.membershipId]);await db.query('COMMIT');return result.rows[0].id;
      }catch(error){await db.query('ROLLBACK');throw error;}finally{if(f.pool)(db as PoolClient).release();}
    }
    await t.test('current buyer binds exact active case and emits one audit/outbox',async()=>{
      const id=await create(buyer);
      const row=(await f.client.query<{sales_case_id:string;party_id:string;surcharge_amount:null}>('SELECT sales_case_id,party_id,surcharge_amount FROM client_changes WHERE id=$1',[id])).rows[0];
      assert.deepEqual(row,{sales_case_id:c.caseId,party_id:buyer,surcharge_amount:null});
      assert.equal((await f.client.query<{n:number}>("SELECT count(*)::int n FROM audit_log WHERE entity_id=$1 AND action='client_change.created'",[id])).rows[0].n,1);
      assert.equal((await f.client.query<{n:number}>("SELECT count(*)::int n FROM outbox_events WHERE aggregate_id=$1 AND event_type='client_change.created.v1'",[id])).rows[0].n,1);
    });
    await t.test('project membership/another unit buyer does not authorize a client change',async()=>{
      await assert.rejects(create(outsider),/CLIENT_CHANGE_CURRENT_BUYER_REQUIRED/);
    });
    await t.test('departed buyer and non-buyer participant cannot fall back to a null case',async()=>{
      await f.client.query("UPDATE sales_case_parties SET left_at=clock_timestamp(),is_primary=false WHERE sales_case_id=$1 AND party_id=$2",[c.caseId,buyer]);
      await assert.rejects(create(buyer),/CLIENT_CHANGE_CURRENT_BUYER_REQUIRED/);
      await f.client.query("UPDATE sales_case_parties SET left_at=NULL,participant_role='representative' WHERE sales_case_id=$1 AND party_id=$2",[c.caseId,buyer]);
      await assert.rejects(create(buyer),/CLIENT_CHANGE_CURRENT_BUYER_REQUIRED/);
      await f.client.query("UPDATE sales_case_parties SET participant_role='co_buyer' WHERE sales_case_id=$1 AND party_id=$2",[c.caseId,buyer]);
      assert.ok(await create(buyer));
    });
    await t.test('tenant and project forgery rejected without records',async()=>{
      await assert.rejects(create(buyer,randomUUID()));await assert.rejects(create(buyer,f.ids.tenantId,randomUUID()));
      assert.equal((await f.client.query<{n:number}>('SELECT count(*)::int n FROM client_changes WHERE unit_id=$1',[c.unitId])).rows[0].n,2);
    });
    await t.test('safe public message never leaks trigger implementation',()=>{
      const error=mapApiError(new Error('CLIENT_CHANGE_CURRENT_BUYER_REQUIRED'),409,'buyer-check');
      assert.equal(error.code,'CLIENT_CHANGE_CURRENT_BUYER_REQUIRED');assert.match(error.error,/kupujícího/);
    });
  }finally{await f.close();}
});

for(const usePostgres of [false,true])test(`contract preparation source (${usePostgres?'PostgreSQL':'PGlite'})`,{skip:usePostgres&&!process.env.WORKFLOW_TEST_DATABASE_URL},async()=>{
  const f=await fixture(usePostgres?process.env.WORKFLOW_TEST_DATABASE_URL:undefined);
  try{
    const c=await f.start();await f.sign(c);
    const sbk=(await f.client.query<{id:string}>("SELECT app.create_contract($1,$2,'sbk',$3,'Technical preparation SBK',$4) id",[f.ids.tenantId,c.caseId,`PREP-${randomUUID()}`,f.ids.membershipId])).rows[0].id;
    const runtime=f.connectionUrl?new Database(f.connectionUrl):null;
    const adapter={withContext:async(context:{tenantId:string;userId:string},work:(client:SqlClient)=>Promise<unknown>)=>{
      if(runtime)return runtime.withContext(context,async client=>{await client.query('SET LOCAL ROLE develocrm_app');return work(client);});
      await f.client.query('BEGIN');try{await f.client.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)",[context.tenantId,context.userId]);await f.client.query('SET LOCAL ROLE develocrm_app');const value=await work(f.client);await f.client.query('COMMIT');return value;}catch(error){await f.client.query('ROLLBACK');throw error;}
    }};
    try{
      const repository=new RsGenerationRepository(adapter as unknown as Database);
      const context={tenantId:f.ids.tenantId,userId:f.ids.userId,membershipId:f.ids.membershipId,permission:'contract.read' as const};
      const result=await repository.load({...context,contractId:sbk});assert.ok(result);
      assert.equal(result.contractType,'sbk');assert.equal(result.salesCaseId,c.caseId);assert.equal(result.unitId,c.unitId);
      assert.equal(result.signedRsCount,1);assert.equal(result.reservationFee,250000);assert.equal(result.paidReservationFee,0);
      assert.equal(result.precedingRsEvidence?.contractId,c.contract_id);
      assert.equal(result.precedingRsEvidence?.versionId,c.version_id);
      assert.equal(result.precedingRsEvidence?.versionCount,1);
      assert.equal(result.precedingRsEvidence?.verifiedGeneration,false);
      assert.equal(result.precedingRsEvidence?.snapshot,null); // External PDF: never fabricate comparable values.
      assert.equal(result.approvedTemplateCount,0);
      assert.ok(result.signingPlan?.versionId);assert.equal(result.signingPlan.sellerPlannedOn,null);assert.equal(result.signingPlan.buyerPlannedOn,null);assert.equal(result.signingPlan.editable,true);
      const signingPlan={...context,contractId:sbk,versionId:result.signingPlan.versionId,sellerPlannedOn:'2026-11-02',buyerPlannedOn:'2026-11-03'};
      assert.deepEqual(await repository.setSigningPlan(signingPlan),{changed:true});
      assert.deepEqual(await repository.setSigningPlan(signingPlan),{changed:false});
      if(usePostgres){const retry=await Promise.all([repository.setSigningPlan(signingPlan),repository.setSigningPlan(signingPlan)]);assert.ok(retry.every(value=>!value.changed));}
      const savedPlan=(await repository.load({...context,contractId:sbk}))!.signingPlan!;
      assert.deepEqual(savedPlan,{versionId:signingPlan.versionId,sellerPlannedOn:'2026-11-02',buyerPlannedOn:'2026-11-03',editable:true});
      const unchangedContract=(await f.client.query<{signed_at:string|null;current_status:string}>('SELECT signed_at,current_status FROM contracts WHERE tenant_id=$1 AND id=$2',[f.ids.tenantId,sbk])).rows[0];
      assert.equal(unchangedContract.signed_at,null);assert.equal(unchangedContract.current_status,'draft');
      assert.equal((await f.client.query<{count:number}>("SELECT count(*)::int count FROM audit_log WHERE tenant_id=$1 AND entity_id=$2 AND action='contract.signing_plan_updated'",[f.ids.tenantId,signingPlan.versionId])).rows[0].count,1);
      assert.equal((await f.client.query<{count:number}>("SELECT count(*)::int count FROM outbox_events WHERE tenant_id=$1 AND aggregate_id=$2 AND event_type='contract.signing_plan_updated.v1'",[f.ids.tenantId,sbk])).rows[0].count,1);
      await assert.rejects(repository.setSigningPlan({...signingPlan,versionId:randomUUID()}),/SIGNING_PLAN_NEW_VERSION_REQUIRED/);
      await assert.rejects(repository.setSigningPlan({...signingPlan,tenantId:randomUUID()}),/permission|tenant|unit/i);
      await assert.rejects(repository.setSigningPlan({...signingPlan,membershipId:randomUUID()}),/permission/i);
      await assert.rejects(repository.setSigningPlan({...signingPlan,contractId:c.contract_id,versionId:c.version_id}),/SIGNING_PLAN_CONTRACT_NOT_EDITABLE/);
      await assert.rejects(f.client.query("UPDATE contract_versions SET seller_planned_signing_on='2026-12-01' WHERE tenant_id=$1 AND id=$2",[f.ids.tenantId,signingPlan.versionId]),/SIGNING_PLAN_COMMAND_REQUIRED/);
      const obligation=(await f.client.query<{id:string}>("SELECT id FROM payment_obligations WHERE tenant_id=$1 AND contract_id=$2 AND obligation_type='reservation_fee'",[f.ids.tenantId,c.contract_id])).rows[0];assert.ok(obligation);
      for(const expected of [125000,250000]){
        await f.client.query("SELECT app.record_payment($1,$2,125000,now(),NULL,NULL,NULL,'Technical preparation receipt',$3,$4)",[f.ids.tenantId,obligation.id,randomUUID(),f.ids.membershipId]);
        assert.equal((await repository.load({...context,contractId:sbk}))?.paidReservationFee,expected);
      }
      assert.equal(await repository.load({...context,membershipId:randomUUID(),contractId:sbk}),null);
      assert.equal(await repository.load({...context,tenantId:randomUUID(),contractId:sbk}),null);
      const party=(await f.client.query<{id:string}>('SELECT party_id id FROM sales_case_parties WHERE tenant_id=$1 AND sales_case_id=$2 AND is_primary',[f.ids.tenantId,c.caseId])).rows[0];assert.ok(party);
      const sales=new SalesRepository(adapter as unknown as Database);
      const addressContext={tenantId:f.ids.tenantId,userId:f.ids.userId,membershipId:f.ids.membershipId,partyId:party.id};
      const primary={...addressContext,addressType:'residence',line1:'Technická ulice 1',city:'Praha',countryCode:'CZ'};
      const delivery={...addressContext,addressType:'correspondence',line1:'Technické doručování 2',city:'Brno',countryCode:'CZ'};
      const primaryId=(await sales.upsertAddress(primary)).id,deliveryId=(await sales.upsertAddress(delivery)).id;
      assert.equal((await sales.upsertAddress({...primary,line1:' Technická ulice 1 ',countryCode:'cz'})).id,primaryId);
      assert.equal((await sales.upsertAddress(delivery)).id,deliveryId);
      const current=(await sales.getDirectory({...context,projectId:result.projectId})).clients.find(item=>item.id===party.id);assert.ok(current);
      assert.equal(current.address?.line1,primary.line1);assert.equal(current.deliveryAddress?.line1,delivery.line1);
      assert.match((await repository.load({...context,contractId:sbk}))!.buyers[0].deliveryAddress!,/Technické doručování 2/);
      const replacement=(await sales.upsertAddress({...delivery,line1:'Technické doručování 3'})).id;assert.notEqual(replacement,deliveryId);
      const history=await f.client.query<{id:string;is_primary:boolean;line1:string}>('SELECT id,is_primary,line1 FROM party_addresses WHERE tenant_id=$1 AND party_id=$2 AND address_type=\'correspondence\' ORDER BY created_at,id',[f.ids.tenantId,party.id]);
      assert.equal(history.rows.length,2);assert.equal(history.rows.find(row=>row.id===deliveryId)?.is_primary,false);
      assert.equal(history.rows.find(row=>row.id===deliveryId)?.line1,delivery.line1);
      if(usePostgres){const retried=await Promise.all([sales.upsertAddress({...delivery,line1:'Technické doručování 3'}),sales.upsertAddress({...delivery,line1:'Technické doručování 3'})]);assert.ok(retried.every(row=>row.id===replacement));}
      const events=(await f.client.query<{audit:number;outbox:number}>(`SELECT (SELECT count(*)::int FROM audit_log WHERE tenant_id=$1 AND action='party.address_updated' AND after_data->>'partyId'=$2) audit,
        (SELECT count(*)::int FROM outbox_events WHERE tenant_id=$1 AND aggregate_id=$2::uuid AND event_type='party.address_updated.v1') outbox`,[f.ids.tenantId,party.id])).rows[0];
      assert.deepEqual(events,{audit:3,outbox:3});
      await sales.upsertAddress({...delivery,line1:'Technische Teststrasse 4',city:'Berlin',countryCode:'DE'});
      assert.match((await repository.load({...context,contractId:sbk}))!.buyers[0].deliveryAddress!,/Berlin, DE$/);
      await assert.rejects(sales.upsertAddress({...delivery,membershipId:randomUUID()}),/permission/i);
      await assert.rejects(sales.upsertAddress({...delivery,tenantId:randomUUID()}),/permission/i);
      // Exercise identity switching and contact redaction against native PostgreSQL.
      // PGlite shares one session with the fixture's privileged setup connection.
      if(usePostgres){
      const readerUser=randomUUID(),readerMember=randomUUID();
      await f.client.query("INSERT INTO users(id,entra_issuer,entra_subject,email,display_name) VALUES($1::uuid,'technical-address-test',($1::uuid)::text,'reader@example.test','Technical address reader')",[readerUser]);
      await f.client.query("INSERT INTO tenant_memberships(id,tenant_id,user_id,status,accepted_at) VALUES($1,$2,$3,'active',now())",[readerMember,f.ids.tenantId,readerUser]);
      await f.client.query("INSERT INTO project_custom_access(tenant_id,project_id,membership_id,area,access_level,permission_overrides,assigned_by_user_id) VALUES($1,$2,$3,'clients','none',ARRAY['clients.read_all'],$4)",[f.ids.tenantId,result.projectId,readerMember,f.ids.userId]);
      const restricted=(await sales.getDirectory({tenantId:f.ids.tenantId,userId:readerUser,membershipId:readerMember,projectId:result.projectId})).clients.find(item=>item.id===party.id);assert.ok(restricted);
      assert.equal(restricted.canReadContractIdentity,false);assert.equal(restricted.address,null);assert.equal(restricted.deliveryAddress,null);
      await assert.rejects(sales.upsertAddress({...delivery,userId:readerUser,membershipId:readerMember}),/permission/i);
      await assert.rejects(repository.setSigningPlan({...signingPlan,userId:readerUser,membershipId:readerMember}),/permission/i);
      }
      await adapter.withContext(context,async client=>{await signatureDocument(client,f.ids.tenantId,f.ids.membershipId,sbk);});
      assert.equal((await repository.load({...context,contractId:sbk}))!.signingPlan!.editable,false);
      await assert.rejects(repository.setSigningPlan({...signingPlan,buyerPlannedOn:'2026-11-04'}),/SIGNING_PLAN_NEW_VERSION_REQUIRED/);
      await assert.rejects(f.client.query("UPDATE contract_versions SET seller_planned_signing_on='2026-12-01' WHERE tenant_id=$1 AND id=$2",[f.ids.tenantId,signingPlan.versionId]),/SIGNING_PLAN_VERSION_IMMUTABLE/);
      await adapter.withContext(context,async client=>{await client.query("SELECT app.create_contract_version($1,$2,'Technical new working version','manual',$3)",[f.ids.tenantId,sbk,f.ids.membershipId]);});
      const nextPlan=(await repository.load({...context,contractId:sbk}))!.signingPlan!;assert.notEqual(nextPlan.versionId,signingPlan.versionId);assert.equal(nextPlan.sellerPlannedOn,null);assert.equal(nextPlan.buyerPlannedOn,null);assert.equal(nextPlan.editable,true);
      const nextInput={...signingPlan,versionId:nextPlan.versionId,buyerPlannedOn:'2026-11-04'};
      const changes=usePostgres?await Promise.all([repository.setSigningPlan(nextInput),repository.setSigningPlan(nextInput)]):[await repository.setSigningPlan(nextInput)];
      assert.equal(changes.filter(value=>value.changed).length,1);
      assert.equal((await f.client.query<{seller:string;buyer:string}>("SELECT seller_planned_signing_on::text seller,buyer_planned_signing_on::text buyer FROM contract_versions WHERE tenant_id=$1 AND id=$2",[f.ids.tenantId,signingPlan.versionId])).rows[0].buyer,'2026-11-03');
      await f.client.query("SELECT app.transition_contract_status_with_refund_decisions($1,$2,'terminated','Technical plan test',$5::jsonb,$3,$4)",[f.ids.tenantId,c.contract_id,`plan-end:${c.contract_id}`,f.ids.membershipId,JSON.stringify([{obligationId:obligation.id,decision:'none'}])]);
      await assert.rejects(repository.setSigningPlan({...nextInput,buyerPlannedOn:'2026-11-05'}),/SIGNING_PLAN_CONTRACT_NOT_EDITABLE/);
    }finally{await runtime?.close();}
  }finally{await f.close();}
});

for(const usePostgres of [false,true])test(`contract-end release invariants (${usePostgres?'PostgreSQL':'PGlite'})`,{skip:usePostgres&&!process.env.WORKFLOW_TEST_DATABASE_URL},async t=>{
  const f=await fixture(usePostgres?process.env.WORKFLOW_TEST_DATABASE_URL:undefined);
  const terminate=(id:string,db:SqlClient=f.client)=>db.query("SELECT app.transition_contract_status_with_refund_decisions($1,$2,'terminated','Technical termination','[]'::jsonb,$3,$4)",[f.ids.tenantId,id,`end:${id}`,f.ids.membershipId]);
  const outcome=async(id:string)=>(await f.client.query<{outcome:{state:string;reasons:Array<{code:string}>}}>("SELECT after_data outcome FROM audit_log WHERE tenant_id=$1 AND entity_id=$2 AND action='contract.end_reconciled'",[f.ids.tenantId,id])).rows[0].outcome;
  async function signed(type:'sbk'|'ks',c:Awaited<ReturnType<typeof f.start>>){
    const id=(await f.client.query<{id:string}>("SELECT app.create_contract($1,$2,$3,$4,'Technical successor',$5) id",[f.ids.tenantId,c.caseId,type,`${type}-${randomUUID()}`,f.ids.membershipId])).rows[0].id;
    const db=f.pool?await f.pool.connect():f.client;
    let version:string;
    try{await db.query('BEGIN');await db.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)",[f.ids.tenantId,f.ids.userId]);version=await signatureDocument(db,f.ids.tenantId,f.ids.membershipId,id);await db.query('COMMIT');}finally{if(f.pool)(db as PoolClient).release();}
    await f.client.query("SELECT app.transition_contract_status($1,$2,'sent','Technical',$3)",[f.ids.tenantId,id,f.ids.membershipId]);
    await f.client.query("SELECT app.transition_contract_status($1,$2,'approved','Technical',$3)",[f.ids.tenantId,id,f.ids.membershipId]);
    await f.sign({contract_id:id,version_id:version!});return id;
  }
  try{
    await t.test('original seller fields persist through existing project UI repository with runtime role, audit and isolation',async()=>{
      const project=(await f.client.query<{id:string;name:string;lifecycle_status:string}>('SELECT id,name,lifecycle_status FROM projects WHERE tenant_id=$1 ORDER BY code LIMIT 1',[f.ids.tenantId])).rows[0];
      const runtime=f.connectionUrl?new Database(f.connectionUrl):null;
      const inRole=async(client:SqlClient,work:(client:SqlClient)=>Promise<unknown>)=>{await client.query('SET LOCAL ROLE develocrm_app');return work(client);};
      const adapter={withContext:async(context:{tenantId:string;userId:string},work:(client:SqlClient)=>Promise<unknown>)=>{
        if(runtime)return runtime.withContext(context,client=>inRole(client,work));
        await f.client.query('BEGIN');try{await f.client.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)",[context.tenantId,context.userId]);const result=await inRole(f.client,work);await f.client.query('COMMIT');return result;}catch(error){await f.client.query('ROLLBACK');throw error;}
      }};
      const repo=new InventoryRepository(adapter as Database),context={tenantId:f.ids.tenantId,userId:f.ids.userId,membershipId:f.ids.membershipId};
      const seller={name:'Technical seller',registrationNumber:'00000000',address:'Technical address',registryEntry:'Technical registry',representative:'Technical representative',email:'seller@example.test',dataBox:'TECH',bankAccount:'000/0000',bankName:'Technical bank',reservationPeriodDays:30};
      const update={...context,projectId:project.id,name:project.name,lifecycleStatus:project.lifecycle_status};
      try{
        await repo.updateProject({...update,contractSettings:{...seller,signatureName:'Technical signer',clientChangesBankAccount:'111/0000',deliveryAddress:'Technical delivery'}});
        await repo.updateProject({...update,contractSettings:seller}); // Older client must preserve new fields.
        const listed=(await repo.getCatalog({...context,projectId:project.id})).projects.find(p=>p.id===project.id);
        assert.equal(listed?.contractSettings?.signatureName,'Technical signer');
        assert.equal(listed?.contractSettings?.clientChangesBankAccount,'111/0000');
        assert.equal(listed?.contractSettings?.deliveryAddress,'Technical delivery');
        await assert.rejects(repo.updateProject({...update,membershipId:randomUUID(),contractSettings:seller}),/permission/);
        await assert.rejects(repo.updateProject({...update,tenantId:randomUUID(),contractSettings:seller}),/permission/);
        await repo.updateProject({...update,contractSettings:{...seller,signatureName:''}});
        const stored=(await f.client.query<{seller_signature_name:string;seller_client_changes_bank_account:string}>('SELECT seller_signature_name,seller_client_changes_bank_account FROM project_contract_settings WHERE tenant_id=$1 AND project_id=$2',[f.ids.tenantId,project.id])).rows[0];
        assert.equal(stored.seller_signature_name,'');assert.equal(stored.seller_client_changes_bank_account,'111/0000');
        assert.equal((await f.client.query<{n:number}>("SELECT count(*)::int n FROM audit_log WHERE tenant_id=$1 AND entity_id=$2 AND action='project.contract_settings_updated'",[f.ids.tenantId,project.id])).rows[0].n,3);
        assert.equal((await f.client.query<{n:number}>("SELECT count(*)::int n FROM outbox_events WHERE tenant_id=$1 AND aggregate_id=$2 AND event_type='project.contract_settings_updated.v1'",[f.ids.tenantId,project.id])).rows[0].n,3);
      }finally{await runtime?.close();}
    });
    await t.test('existing client editor persists salutation and birth date with party scope and minimal audit',async()=>{
      const c=await f.start();
      const party=(await f.client.query<{id:string;first_name:string;last_name:string}>("SELECT p.party_id id,d.first_name,d.last_name FROM contract_parties p JOIN party_individual_details d ON d.tenant_id=p.tenant_id AND d.party_id=p.party_id WHERE p.contract_id=$1 LIMIT 1",[c.contract_id])).rows[0];
      const runtime=f.connectionUrl?new Database(f.connectionUrl):null;
      const adapter=runtime??{withContext:async(context:{tenantId:string;userId:string},work:(client:SqlClient)=>Promise<unknown>)=>{await f.client.query('BEGIN');try{await f.client.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)",[context.tenantId,context.userId]);const value=await work(f.client);await f.client.query('COMMIT');return value;}catch(error){await f.client.query('ROLLBACK');throw error;}}};
      try{
        const repo=new SalesRepository(adapter as Database);const context={tenantId:f.ids.tenantId,userId:f.ids.userId,membershipId:f.ids.membershipId};
        await repo.updateProfile({...context,partyId:party.id,firstName:party.first_name,lastName:party.last_name,salutation:'pan',birthDate:'1990-01-01'});
        const stored=(await f.client.query<{salutation:string;birth_date:string}>("SELECT salutation,date_of_birth::text birth_date FROM party_individual_details WHERE party_id=$1",[party.id])).rows[0];
        assert.equal(stored.salutation,'pan');assert.equal(stored.birth_date,'1990-01-01');
        const listed=(await repo.getDirectory(context)).clients.find(p=>p.id===party.id);assert.equal(listed?.birthDate,'1990-01-01');assert.equal(listed?.salutation,'pan');
        await assert.rejects(repo.updateProfile({...context,membershipId:randomUUID(),partyId:party.id,firstName:party.first_name,lastName:party.last_name,birthDate:'1991-01-01'}),/permission/);
        await assert.rejects(repo.updateProfile({...context,partyId:party.id,firstName:party.first_name,lastName:party.last_name,birthDate:'2999-01-01'}),/datum narození/);
        const audit=(await f.client.query<{after_data:unknown}>("SELECT after_data FROM audit_log WHERE entity_id=$1 AND action='party.contract_identity_updated'",[party.id])).rows;
        assert.equal(audit.length,1);assert.ok(!JSON.stringify(audit).includes('1990-01-01'));
      }finally{await runtime?.close();}
    });
    await t.test('unsigned SBK draft survives RS termination without protecting the unit or reopening the closed sale',async()=>{
      const c=await f.start();await f.sign(c);
      const draft=(await f.client.query<{id:string}>("SELECT app.create_contract($1,$2,'sbk',$3,'Historical draft',$4) id",[f.ids.tenantId,c.caseId,randomUUID(),f.ids.membershipId])).rows[0].id;
      await terminate(c.contract_id);
      assert.equal((await outcome(c.contract_id)).state,'released');
      assert.equal((await f.client.query("SELECT commercial_status FROM units WHERE id=$1",[c.unitId])).rows[0].commercial_status,'available');
      assert.equal((await f.client.query("SELECT current_status FROM contracts WHERE id=$1",[draft])).rows[0].current_status,'draft');
      await assert.rejects(f.client.query("SELECT app.transition_contract_status($1,$2,'sent','Attempt to reopen',$3)",[f.ids.tenantId,draft,f.ids.membershipId]),/CONTRACT_CASE_CLOSED/);
      assert.equal((await f.client.query("SELECT status FROM sales_cases WHERE id=$1",[c.caseId])).rows[0].status,'cancelled');
      assert.equal((await f.client.query("SELECT count(*)::int n FROM contract_versions WHERE contract_id=$1",[draft])).rows[0].n,1);
    });
    await t.test('signature entry points cannot sign an approved document in a historically closed case',async()=>{
      const c=await f.start();
      // Offline legacy fixture: a closed sale can still contain unfinished evidence.
      await f.client.query("UPDATE sales_cases SET status='cancelled',closed_at=now() WHERE id=$1",[c.caseId]);
      await assert.rejects(f.sign(c),/CONTRACT_CASE_CLOSED/);
      const party=(await f.client.query<{id:string}>("SELECT id FROM contract_parties WHERE contract_id=$1 AND signing_required LIMIT 1",[c.contract_id])).rows[0].id;
      await assert.rejects(f.client.query("SELECT app.record_contract_party_signature($1,$2,$3,$4,'Historical signature')",[f.ids.tenantId,party,c.version_id,f.ids.membershipId]),/CONTRACT_CASE_CLOSED/);
      assert.equal((await f.client.query("SELECT current_status FROM contracts WHERE id=$1",[c.contract_id])).rows[0].current_status,'approved');
      assert.equal((await f.client.query("SELECT count(*)::int n FROM contract_versions WHERE contract_id=$1 AND signed_at IS NOT NULL",[c.contract_id])).rows[0].n,0);
    });
    await t.test('single signed RS releases unit, closes case and preserves unpaid obligations; retries do not duplicate',async()=>{
      const c=await f.start();await f.sign(c);
      const before=(await f.client.query("SELECT id,amount,cancelled_at FROM payment_obligations WHERE sales_case_id=$1",[c.caseId])).rows;
      await terminate(c.contract_id);await terminate(c.contract_id);
      assert.equal((await outcome(c.contract_id)).state,'released');
      assert.equal((await f.client.query("SELECT commercial_status FROM units WHERE id=$1",[c.unitId])).rows[0].commercial_status,'available');
      assert.equal((await f.client.query("SELECT status FROM sales_cases WHERE id=$1",[c.caseId])).rows[0].status,'cancelled');
      assert.deepEqual((await f.client.query("SELECT id,amount,cancelled_at FROM payment_obligations WHERE sales_case_id=$1",[c.caseId])).rows,before);
      assert.equal((await f.client.query("SELECT count(*)::int n FROM outbox_events WHERE aggregate_id=$1 AND event_type='contract.end_reconciled.v1'",[c.contract_id])).rows[0].n,1);
    });
    await t.test('other effective contract blocks RS release, final SBK termination releases',async()=>{
      const c=await f.start();await f.sign(c);const sbk=await signed('sbk',c);
      await terminate(c.contract_id);assert.ok((await outcome(c.contract_id)).reasons.some(r=>r.code==='OTHER_CONTRACT'));
      assert.equal((await f.state(c.unitId)).commercial_status,'contracted');
      await terminate(sbk);assert.equal((await outcome(sbk)).state,'released');
      assert.equal((await f.client.query("SELECT commercial_status FROM units WHERE id=$1",[c.unitId])).rows[0].commercial_status,'available');
    });
    await t.test('a successor whose termination is not yet effective still blocks release',async()=>{
      const c=await f.start();await f.sign(c);const sbk=await signed('sbk',c);
      await terminate(sbk);
      // Offline fixture for a previously imported future-effective termination.
      await f.client.query("UPDATE contracts SET ended_at=now()+interval '1 day' WHERE id=$1",[sbk]);
      await terminate(c.contract_id);
      assert.ok((await outcome(c.contract_id)).reasons.some(r=>r.code==='OTHER_CONTRACT'));
      assert.equal((await f.state(c.unitId)).commercial_status,'contracted');
    });
    await t.test('KS cancellation never proves ownership clearance',async()=>{
      const c=await f.start();await f.sign(c);const ks=await signed('ks',c);
      await terminate(c.contract_id);await terminate(ks);
      assert.ok((await outcome(ks)).reasons.some(r=>r.code==='OWNERSHIP_UNVERIFIED'));
      assert.equal((await f.state(c.unitId)).commercial_status,'sold');
    });
    await t.test('independent reservation is not cancelled by contract termination',async()=>{
      const c=await f.start();await f.sign(c);
      await f.client.query("UPDATE unit_holds SET idempotency_key=$1 WHERE tenant_id=$2 AND unit_id=$3 AND status='active'",[`independent:${randomUUID()}`,f.ids.tenantId,c.unitId]);
      await terminate(c.contract_id);
      assert.ok((await outcome(c.contract_id)).reasons.some(r=>r.code==='OTHER_HOLD'));
      assert.equal((await f.state(c.unitId)).commercial_status,'reserved');
      assert.equal((await f.client.query("SELECT count(*)::int n FROM unit_holds WHERE unit_id=$1 AND status='active'",[c.unitId])).rows[0].n,1);
    });
    await t.test('legacy reservation with a signature-shaped key but no signature audit is protected',async()=>{
      const c=await f.start();await f.sign(c);
      // Offline legacy/import fixture, with all production constraints enabled.
      // The replacement hold has no server signature audit proving its origin.
      const h=(await f.client.query<{id:string}>("SELECT id FROM unit_holds WHERE unit_id=$1 AND status='active'",[c.unitId])).rows[0];
      await f.client.query("UPDATE unit_holds SET status='converted',ended_at=now(),idempotency_key=$1 WHERE id=$2",[randomUUID(),h.id]);
      await f.client.query("INSERT INTO unit_holds(tenant_id,project_id,unit_id,sales_case_id,hold_type,expires_at,idempotency_key,created_by_membership_id) SELECT tenant_id,project_id,unit_id,sales_case_id,'reservation',now()+interval '7 days',$2,$3 FROM contracts WHERE id=$1",[c.contract_id,`signed-rs-reservation:${c.contract_id}`,f.ids.membershipId]);
      await terminate(c.contract_id);
      assert.ok((await outcome(c.contract_id)).reasons.some(r=>r.code==='OTHER_HOLD'));
      assert.equal((await f.state(c.unitId)).commercial_status,'reserved');
    });
    await t.test('existing receipt, allocation, unpaid balance and refund records remain intact',async()=>{
      const c=await f.start();await f.sign(c);
      const id=(await f.client.query<{id:string}>("SELECT id FROM payment_obligations WHERE contract_id=$1",[c.contract_id])).rows[0].id;
      await f.client.query("SELECT app.record_payment($1,$2,50000,now(),NULL,NULL,NULL,'Technical receipt',$3,$4)",[f.ids.tenantId,id,randomUUID(),f.ids.membershipId]);
      const before=(await f.client.query("SELECT row_to_json(p) value FROM payment_obligations p WHERE id=$1",[id])).rows;
      await f.client.query("SELECT app.transition_contract_status_with_refund_decisions($1,$2,'terminated','Technical termination',$3::jsonb,$4,$5)",[f.ids.tenantId,c.contract_id,JSON.stringify([{obligationId:id,decision:'none'}]),randomUUID(),f.ids.membershipId]);
      assert.equal((await outcome(c.contract_id)).state,'released');
      assert.deepEqual((await f.client.query("SELECT row_to_json(p) value FROM payment_obligations p WHERE id=$1",[id])).rows,before);
      assert.equal(Number((await f.client.query("SELECT app.payment_obligation_paid($1,$2) n",[f.ids.tenantId,id])).rows[0].n),50000);
      assert.equal((await f.client.query("SELECT count(*)::int n FROM payment_refunds WHERE tenant_id=$1",[f.ids.tenantId])).rows[0].n,0);
      await f.client.query("SELECT app.record_payment($1,$2,10000,now(),NULL,NULL,NULL,'Technical debt settlement',$3,$4)",[f.ids.tenantId,id,randomUUID(),f.ids.membershipId]);
      assert.equal((await f.client.query("SELECT commercial_status FROM units WHERE id=$1",[c.unitId])).rows[0].commercial_status,'available','later debt settlement must not re-open the sale');
    });
    await t.test('cross tenant and unauthorized membership cannot end a contract',async()=>{
      const c=await f.start();await f.sign(c);
      await assert.rejects(f.client.query("SELECT app.transition_contract_status_with_refund_decisions($1,$2,'terminated','Technical','[]',$3,$4)",[randomUUID(),c.contract_id,randomUUID(),f.ids.membershipId]));
      await assert.rejects(f.client.query("SELECT app.transition_contract_status_with_refund_decisions($1,$2,'terminated','Technical','[]',$3,$4)",[f.ids.tenantId,c.contract_id,randomUUID(),randomUUID()]));
      assert.equal((await f.state(c.unitId)).commercial_status,'reserved');
    });
    if(f.pool)for(const endFirst of [true,false])await t.test(`real RS termination vs SBK draft advancement, termination first=${endFirst}`,async()=>{
      const c=await f.start();await f.sign(c);
      const draft=(await f.client.query<{id:string}>("SELECT app.create_contract($1,$2,'sbk',$3,'Concurrent draft',$4) id",[f.ids.tenantId,c.caseId,randomUUID(),f.ids.membershipId])).rows[0].id;
      const a=await f.pool!.connect(),b=await f.pool!.connect();
      const advance=(db:SqlClient)=>db.query("SELECT app.transition_contract_status($1,$2,'sent','Concurrent advancement',$3)",[f.ids.tenantId,draft,f.ids.membershipId]);
      try{
        for(const db of [a,b]){await db.query('BEGIN');await db.query("SET LOCAL ROLE develocrm_app;SET LOCAL statement_timeout='5s'");await db.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)",[f.ids.tenantId,f.ids.userId]);}
        await (endFirst?terminate(c.contract_id,a):advance(a));
        const pid=(await b.query<{id:number}>('SELECT pg_backend_pid() id')).rows[0].id;
        const pending=(endFirst?advance(b):terminate(c.contract_id,b)).then(async()=>{await b.query('COMMIT');return null;},async(error:Error&{code?:string})=>{await b.query('ROLLBACK');return error;});
        let waiting=false;for(let i=0;i<100&&!waiting;i++){waiting=(await f.pool!.query<{waiting:boolean}>("SELECT wait_event_type='Lock' waiting FROM pg_stat_activity WHERE pid=$1",[pid])).rows[0].waiting;if(!waiting)await new Promise(resolve=>setTimeout(resolve,10));}
        assert.ok(waiting,'the second operation must actually wait on the same unit lock');
        await a.query('COMMIT');const error=await pending;
        if(endFirst){assert.match(error?.message??'',/CONTRACT_CASE_CLOSED/);assert.notEqual(error?.code,'40P01');assert.equal((await outcome(c.contract_id)).state,'released');}
        else{assert.equal(error,null);assert.ok((await outcome(c.contract_id)).reasons.some(r=>r.code==='OTHER_CONTRACT'));assert.equal((await f.state(c.unitId)).commercial_status,'reserved');}
      }finally{for(const db of [a,b]){await db.query('ROLLBACK');db.release();}}
    });
    if(f.pool)await t.test('real concurrent termination and two reservations serialize at unit lock',async()=>{
      const c=await f.start();await f.sign(c);
      const a=await f.pool!.connect(),b=await f.pool!.connect(),d=await f.pool!.connect();
      try{
        for(const db of [a,b,d]){await db.query('BEGIN');await db.query("SET LOCAL ROLE develocrm_app;SET LOCAL statement_timeout='5s'");await db.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)",[f.ids.tenantId,f.ids.userId]);}
        await terminate(c.contract_id,a);
        const buyer=(await f.client.query<{party_id:string}>("SELECT party_id FROM sales_case_parties WHERE sales_case_id=$1 LIMIT 1",[c.caseId])).rows[0].party_id;
        const reserve=(db:PoolClient)=>db.query("SELECT * FROM app.create_unit_hold($1,$2,'pre_reservation',ARRAY[$3::uuid],now()+interval '2 days',$4,NULL,$5,'Technical new sale')",[f.ids.tenantId,c.unitId,buyer,f.ids.membershipId,randomUUID()]);
        const pids=await Promise.all([b,d].map(async db=>(await db.query<{id:number}>('SELECT pg_backend_pid() id')).rows[0].id));
        const pending=[b,d].map(db=>reserve(db).then(async()=>{await db.query('COMMIT');return true;},async error=>{await db.query('ROLLBACK');assert.notEqual(error.code,'40P01');return false;}));
        let waiting=0;for(let i=0;i<100&&waiting<2;i++){
          waiting=(await f.pool!.query<{n:number}>("SELECT count(*)::int n FROM pg_stat_activity WHERE pid=ANY($1) AND wait_event_type='Lock'",[pids])).rows[0].n;
          if(waiting<2)await new Promise(resolve=>setTimeout(resolve,10));
        }
        assert.equal(waiting,2,'both reservation backends must actually wait on the termination unit lock');
        await a.query('COMMIT');const results=await Promise.all(pending);
        assert.equal(results.filter(Boolean).length,1);
        assert.equal((await f.client.query("SELECT count(*)::int n FROM unit_holds WHERE unit_id=$1 AND status='active'",[c.unitId])).rows[0].n,1);
      }finally{for(const db of [a,b,d]){await db.query('ROLLBACK');db.release();}}
    });
  }finally{await f.close();}
});

test("reservation invariants across all current migrations",async t=>{
  const f=await fixture();
  try{
    await t.test("only expired pre-reservations are released, once, with stage and events",async()=>{
      const c=await f.start();
      assert.equal((await f.expire(c.holdId)).rows[0].changed,false);
      await f.past(c.holdId);
      assert.equal((await f.expire(c.holdId)).rows[0].changed,true);
      assert.equal((await f.expire(c.holdId)).rows[0].changed,false);
      assert.deepEqual(await f.state(c.unitId),{commercial_status:"available",current_stage:"interest"});
      assert.deepEqual(await f.events(c.holdId),{audit:1,outbox:1});
      assert.equal((await f.client.query("SELECT id FROM sales_cases WHERE id=$1 AND status='active'",[c.caseId])).rows.length,0);
      const projection=getSalesProcessState({hasActiveSalesCase:false,commercialStatus:"available",salesStage:null,contracts:[]});
      assert.equal(projection.currentStage,"interest");
      assert.equal(projection.nextContractAction.kind,"missing_sales_case");
    });
    await t.test("signed RS protects reservation even when its legacy timestamp has elapsed",async()=>{
      const c=await f.start();await f.sign(c);
      const reservation=(await f.client.query<{id:string;is_expirable:boolean}>("SELECT id,is_expirable FROM unit_holds WHERE unit_id=$1 AND status='active'",[c.unitId])).rows[0];
      assert.equal(reservation.is_expirable,false);await f.past(reservation.id);
      assert.equal((await f.expire(reservation.id)).rows[0].changed,false);
      await assert.rejects(f.cancel(reservation.id),/SIGNED_CONTRACT_PROTECTS_RESERVATION/);
      await assert.rejects(f.client.query("SELECT app.transition_unit_commercial_status($1,$2,'available','cancelReservation','Safety',$3)",[f.ids.tenantId,c.unitId,f.ids.membershipId]),/SIGNED_CONTRACT_PROTECTS_RESERVATION/);
      await assert.rejects(f.client.query("SELECT app.record_sales_stage($1,$2,'interest','expireHold','Safety',$3)",[f.ids.tenantId,c.caseId,f.ids.membershipId]),/SIGNED_CONTRACT_PROTECTS_RESERVATION/);
      assert.deepEqual(await f.state(c.unitId),{commercial_status:"reserved",current_stage:"reservation"});
      assert.deepEqual(await f.events(reservation.id),{audit:0,outbox:0});
      const projection=getSalesProcessState({hasActiveSalesCase:true,commercialStatus:"available",salesStage:"interest",contracts:[{id:c.contract_id,type:"rs",status:"signed"}]});
      assert.equal(projection.commercialStatusLabel,"Rezervovaná");assert.equal(projection.currentStage,"sbk");
    });
    await t.test("cross-tenant expiry cannot mutate a hold",async()=>{
      const c=await f.start();await f.past(c.holdId);
      assert.equal((await f.client.query<{changed:boolean}>("SELECT app.expire_unit_hold($1,$2,$3) changed",[randomUUID(),c.holdId,f.ids.membershipId])).rows[0].changed,false);
      assert.equal((await f.state(c.unitId)).commercial_status,"pre_reserved");
    });
    await t.test("stale pre-reservation stage does not keep its timeline active",()=>{
      const p=getSalesProcessState({hasActiveSalesCase:true,commercialStatus:"available",salesStage:"pre_reservation",contracts:[]});
      assert.equal(p.currentStage,"interest");assert.equal(p.steps[1].state,"pending");
      assert.equal(mapApiError(new Error("SIGNED_CONTRACT_PROTECTS_RESERVATION"),409,"test").message,"Jednotku nelze uvolnit, protože má podepsanou smlouvu.");
    });
  }finally{await f.close();}
});

test("real PostgreSQL concurrency: signature, cancellation, expiry and unit serialization",{skip:!process.env.WORKFLOW_TEST_DATABASE_URL},async t=>{
  const f=await fixture(process.env.WORKFLOW_TEST_DATABASE_URL);
  async function race(first:(c:PoolClient)=>Promise<unknown>,second:(c:PoolClient)=>Promise<unknown>){
    const a=await f.pool!.connect();const b=await f.pool!.connect();
    try{
      for(const c of [a,b]){
        await c.query("BEGIN");await c.query("SET LOCAL ROLE develocrm_app");await c.query("SET LOCAL statement_timeout='5s'");
        await c.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)",[f.ids.tenantId,f.ids.userId]);
      }
      await first(a);
      const pid=(await b.query<{pid:number}>("SELECT pg_backend_pid() pid")).rows[0].pid;
      const pending=second(b).then(value=>({value,error:null}),error=>({value:null,error}));
      let waiting=false;
      for(let attempt=0;attempt<100&&!waiting;attempt++){
        waiting=(await f.pool!.query<{waiting:boolean}>("SELECT wait_event_type='Lock' waiting FROM pg_stat_activity WHERE pid=$1",[pid])).rows[0]?.waiting===true;
        if(!waiting)await new Promise(resolve=>setTimeout(resolve,10));
      }
      assert.equal(waiting,true,"the second backend must actually wait for the first unit lock");
      await a.query("COMMIT");
      const result=await pending;
      if(result.error)await b.query("ROLLBACK");else await b.query("COMMIT");
      if(result.error)assert.notEqual(result.error.code,"40P01","no deadlock");
      return result;
    }finally{await a.query("ROLLBACK");await b.query("ROLLBACK");a.release();b.release();}
  }
  try{
    for(const firstSigns of [false,true])await t.test(`expiry vs signature, signature first=${firstSigns}`,async()=>{
      const c=await f.start();await f.past(c.holdId);
      const result=firstSigns?await race(db=>f.sign(c,db),db=>f.expire(c.holdId,db)):await race(db=>f.expire(c.holdId,db),db=>f.sign(c,db));
      if(firstSigns){
        assert.equal(result.error,null);assert.equal((await f.state(c.unitId)).commercial_status,"reserved");
        assert.equal((await f.client.query<{count:number}>("SELECT count(*)::int count FROM unit_holds WHERE unit_id=$1 AND status='active'",[c.unitId])).rows[0].count,1);
      }else{
        assert.match(result.error?.message??'',/CONTRACT_CASE_CLOSED/);
        assert.equal((await f.state(c.unitId)).commercial_status,'available');
        assert.equal((await f.client.query("SELECT id FROM contracts WHERE id=$1 AND current_status='signed'",[c.contract_id])).rows.length,0);
        assert.equal((await f.client.query("SELECT id FROM sales_cases WHERE id=$1 AND status='active'",[c.caseId])).rows.length,0);
      }
    });
    for(const firstSigns of [false,true])await t.test(`cancel vs signature, signature first=${firstSigns}`,async()=>{
      const c=await f.start();
      const result=firstSigns?await race(db=>f.sign(c,db),db=>f.cancel(c.holdId,db)):await race(db=>f.cancel(c.holdId,db),db=>f.sign(c,db));
      if(firstSigns){assert.equal(result.error,null);assert.equal((await f.state(c.unitId)).commercial_status,"reserved");}
      else{
        assert.match(result.error?.message??'',/CONTRACT_CASE_CLOSED/);
        assert.equal((await f.state(c.unitId)).commercial_status,'available');
        assert.equal((await f.client.query("SELECT id FROM contracts WHERE id=$1 AND current_status='signed'",[c.contract_id])).rows.length,0);
      }
    });
    await t.test("two expiries produce exactly one mutation/audit/outbox",async()=>{
      const c=await f.start();await f.past(c.holdId);
      const result=await race(db=>f.expire(c.holdId,db),db=>f.expire(c.holdId,db));
      assert.equal(result.error,null);assert.deepEqual(await f.events(c.holdId),{audit:1,outbox:1});
    });
    await t.test("two signatures on the same unit are idempotent",async()=>{
      const c=await f.start();const result=await race(db=>f.sign(c,db),db=>f.sign(c,db));
      assert.equal(result.error,null);
      assert.equal((await f.client.query<{count:number}>("SELECT count(*)::int count FROM unit_holds WHERE unit_id=$1 AND status='active'",[c.unitId])).rows[0].count,1);
      assert.equal((await f.client.query<{count:number}>("SELECT count(*)::int count FROM outbox_events WHERE aggregate_id=$1 AND event_type='contract.signed.v1'",[c.contract_id])).rows[0].count,1);
    });
    await t.test("scheduled job uses tenant/project permissions and the same atomic expiry command",async()=>{
      const c=await f.start();await f.past(c.holdId);
      const database=new Database(f.connectionUrl!);
      try{
        const result=await expirePreReservations(database,{tenantId:f.ids.tenantId,membershipId:f.ids.membershipId});
        assert.ok(result.expired>=1);assert.equal((await f.state(c.unitId)).commercial_status,"available");
        assert.deepEqual(await f.events(c.holdId),{audit:1,outbox:1});
        await assert.rejects(expirePreReservations(database,{tenantId:randomUUID(),membershipId:f.ids.membershipId}),/membership is not active/);
        assert.equal((await expirePreReservations(database,{tenantId:f.ids.tenantId,membershipId:f.ids.membershipId})).expired,0);
      }finally{await database.close();}
    });
    for(const signatureFirst of [true,false])await t.test(`upload reservation vs signature, signature first=${signatureFirst}`,async()=>{
      const c=await f.start();const doc=(await f.client.query<{document_id:string;project_id:string}>("SELECT document_id,project_id FROM contract_versions WHERE id=$1",[c.version_id])).rows[0];
      const reserve=(db:PoolClient)=>db.query("SELECT app.reserve_document_upload($1,$2,$3,$4,'version',$5,NULL,'Replacement','replacement.pdf','application/pdf',16,$6,'v2','ready',NULL,$7,NULL,$8,$9,$10)",
        [f.ids.tenantId,doc.project_id,randomUUID(),'a'.repeat(64),doc.document_id,`sha256:${'b'.repeat(64)}`,c.unitId,c.contract_id,c.caseId,f.ids.membershipId]);
      const result=signatureFirst?await race(db=>f.sign(c,db),reserve):await race(reserve,db=>f.sign(c,db));
      assert.match(result.error?.message??'',signatureFirst?/SIGNED_DOCUMENT_IMMUTABLE/:/DOCUMENT_UPLOAD_IN_PROGRESS/);
      assert.equal((await f.state(c.unitId)).commercial_status,signatureFirst?'reserved':'pre_reserved');
    });
    for(const buyerChangeFirst of [true,false])await t.test(`client change vs current buyer replacement, replacement first=${buyerChangeFirst}`,async()=>{
      const c=await f.start(),other=await f.start();
      const buyers=(await f.client.query<{sales_case_id:string;party_id:string}>('SELECT sales_case_id,party_id FROM sales_case_parties WHERE sales_case_id=ANY($1::uuid[]) AND is_primary AND left_at IS NULL',[[c.caseId,other.caseId]])).rows;
      const old=buyers.find(p=>p.sales_case_id===c.caseId)!.party_id,next=buyers.find(p=>p.sales_case_id===other.caseId)!.party_id;
      const project=(await f.client.query<{project_id:string}>('SELECT project_id FROM units WHERE id=$1',[c.unitId])).rows[0].project_id;
      const create=(db:PoolClient)=>db.query("SELECT app.create_client_change($1,$2,$3,$4,'Concurrency change','','individual',NULL,'Test',NULL,'CZK',current_date,NULL,$5)",[f.ids.tenantId,project,c.unitId,old,f.ids.membershipId]);
      const replace=async(db:PoolClient)=>{
        await db.query('SELECT app.lock_workflow_unit($1,$2)',[f.ids.tenantId,c.unitId]);
        await db.query('UPDATE sales_case_parties SET left_at=clock_timestamp(),is_primary=false WHERE sales_case_id=$1 AND left_at IS NULL',[c.caseId]);
        await db.query("INSERT INTO sales_case_parties(tenant_id,project_id,sales_case_id,party_id,participant_role,is_primary) VALUES($1,$2,$3,$4,'buyer',true)",[f.ids.tenantId,project,c.caseId,next]);
      };
      const result=buyerChangeFirst?await race(replace,create):await race(create,replace);
      if(buyerChangeFirst)assert.match(result.error?.message??'',/CLIENT_CHANGE_CURRENT_BUYER_REQUIRED/);else assert.equal(result.error,null);
      const count=(await f.client.query<{n:number}>('SELECT count(*)::int n FROM client_changes WHERE unit_id=$1',[c.unitId])).rows[0].n;
      assert.equal(count,buyerChangeFirst?0:1);
      assert.equal((await f.client.query<{party_id:string}>('SELECT party_id FROM sales_case_parties WHERE sales_case_id=$1 AND is_primary AND left_at IS NULL',[c.caseId])).rows[0].party_id,next);
    });
    await t.test('parallel initial-price requests create one unit and one history row',async()=>{
      const project=(await f.client.query<{id:string}>("SELECT id FROM projects WHERE tenant_id=$1 LIMIT 1",[f.ids.tenantId])).rows[0].id;
      const database=new Database(f.connectionUrl!);try{const service=new InventoryImportService(database);const input={tenantId:f.ids.tenantId,userId:f.ids.userId,membershipId:f.ids.membershipId,projectId:project,idempotencyKey:randomUUID(),row:{rowNumber:1,code:'PRICE-CONCURRENCY',areaM2:30,price:1234567}};
        const results=await Promise.all([service.createUnit(input),service.createUnit(input)]);assert.equal(results.filter(r=>r.replayed).length,1);
        assert.equal((await f.client.query<{count:number}>("SELECT count(*)::int count FROM unit_price_history p JOIN units u ON u.id=p.unit_id WHERE u.tenant_id=$1 AND u.code='PRICE-CONCURRENCY'",[f.ids.tenantId])).rows[0].count,1);
      }finally{await database.close();}
    });
  }finally{await f.close();}
});

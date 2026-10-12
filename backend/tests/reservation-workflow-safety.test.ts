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
  for(const name of (await readdir(directory)).filter(name=>/^\d+.*\.sql$/.test(name)).sort())await client.query(await readFile(new URL(name,directory),"utf8"));
  const normalized=normalizeBootstrapInput({entraTenantId:randomUUID(),adminOid:randomUUID(),adminEmail:"safety.admin@example.test",adminName:"Workflow Safety Test",workspaceName:"Isolated safety tests",workspaceId:randomUUID()});
  const ids=bootstrapIds(normalized);
  await bootstrapPilotWorkspace(client,{...normalized,...ids});
  await importDejvice(client,await readFile(new URL("../seeds/0004_pilot_rezidence_dejvice.sql",import.meta.url),"utf8"),{tenantId:ids.tenantId,membershipId:ids.membershipId,dryRun:false});
  async function start(){
    const unit=(await client.query<{id:string}>(`SELECT id FROM units WHERE tenant_id=$1 AND commercial_status='available'
      AND NOT EXISTS(SELECT 1 FROM sales_cases WHERE tenant_id=$1 AND unit_id=units.id AND status='active') ORDER BY code LIMIT 1`,[ids.tenantId])).rows[0];
    assert.ok(unit);
    const hold=(await client.query<{hold_id:string;sales_case_id:string}>(`SELECT * FROM app.create_party_and_unit_hold($1,$2,'pre_reservation',now()+interval '48 hours',$3,$4,'Safety test','individual',NULL,'Safety',$6,NULL,NULL,$5,NULL)`,[ids.tenantId,unit.id,ids.membershipId,randomUUID(),`${randomUUID()}@example.test`,`Buyer ${randomUUID()}`])).rows[0];
    const contract=(await client.query<{contract_id:string;version_id:string}>("SELECT * FROM app.create_contract_with_payment($1,$2,'rs',$3,'Safety RS',$4,NULL,$5,'fixed',250000,now()+interval '7 days')",[ids.tenantId,hold.sales_case_id,`RS-SAFETY-${randomUUID()}`,ids.membershipId,randomUUID()])).rows[0];
    await client.query("SELECT app.transition_contract_status($1,$2,'sent','Safety',$3)",[ids.tenantId,contract.contract_id,ids.membershipId]);
    await client.query("SELECT app.transition_contract_status($1,$2,'approved','Safety',$3)",[ids.tenantId,contract.contract_id,ids.membershipId]);
    return {unitId:unit.id,holdId:hold.hold_id,caseId:hold.sales_case_id,...contract};
  }
  async function past(holdId:string){await client.query("UPDATE unit_holds SET starts_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE id=$1",[holdId]);}
  const expire=(holdId:string,connection:SqlClient=client)=>connection.query<{changed:boolean}>("SELECT app.expire_unit_hold($1,$2,$3) changed",[ids.tenantId,holdId,ids.membershipId]);
  const cancel=(holdId:string,connection:SqlClient=client)=>connection.query("SELECT app.cancel_unit_hold($1,$2,$3,'Safety cancellation')",[ids.tenantId,holdId,ids.membershipId]);
  const sign=(c:{contract_id:string;version_id:string},connection:SqlClient=client)=>connection.query("SELECT * FROM app.sign_contract_externally($1,$2,$3,now(),$4,NULL)",[ids.tenantId,c.contract_id,c.version_id,ids.membershipId]);
  async function state(unitId:string){return (await client.query<{commercial_status:string;current_stage:string}>("SELECT unit.commercial_status,sales_case.current_stage FROM units unit JOIN sales_cases sales_case ON sales_case.unit_id=unit.id AND sales_case.status='active' WHERE unit.id=$1",[unitId])).rows[0];}
  async function events(holdId:string){return (await client.query<{audit:number;outbox:number}>("SELECT (SELECT count(*)::int FROM audit_log WHERE entity_id=$1 AND action='hold.expired') audit,(SELECT count(*)::int FROM outbox_events WHERE aggregate_id=$1 AND event_type='hold.expired.v1') outbox",[holdId])).rows[0];}
  async function close(){if(pool){await pool.end();await admin!.query(`DROP DATABASE "${databaseName}"`);await admin!.end();}else await memory!.close();}
  return {client,pool,connectionUrl:url?.toString(),ids,start,past,expire,cancel,sign,state,events,close};
}

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
      const projection=getSalesProcessState({hasActiveSalesCase:true,commercialStatus:"available",salesStage:"interest",contracts:[]});
      assert.equal(projection.currentStage,"interest");
      assert.equal(projection.nextContractAction.kind,"create_contract");
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
      assert.equal(result.error,null);assert.equal((await f.state(c.unitId)).commercial_status,"reserved");
      assert.equal((await f.client.query<{count:number}>("SELECT count(*)::int count FROM unit_holds WHERE unit_id=$1 AND status='active'",[c.unitId])).rows[0].count,1);
    });
    for(const firstSigns of [false,true])await t.test(`cancel vs signature, signature first=${firstSigns}`,async()=>{
      const c=await f.start();
      const result=firstSigns?await race(db=>f.sign(c,db),db=>f.cancel(c.holdId,db)):await race(db=>f.cancel(c.holdId,db),db=>f.sign(c,db));
      assert.equal(result.error,null);assert.equal((await f.state(c.unitId)).commercial_status,"reserved");
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
  }finally{await f.close();}
});

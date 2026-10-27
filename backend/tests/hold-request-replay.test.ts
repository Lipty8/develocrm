import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {Pool,type PoolClient} from 'pg';
import type {SqlClient} from '../src/database.js';
import {bootstrapIds,bootstrapPilotWorkspace,normalizeBootstrapInput} from '../src/iam/pilot-bootstrap.js';

async function fixture(url?:string){
  const memory=url?undefined:new PGlite();
  const databaseName=`hold_replay_${randomUUID().replaceAll('-','')}`;
  const admin=url?new Pool({connectionString:url}):undefined;
  if(admin)await admin.query(`CREATE DATABASE "${databaseName}"`);
  const connection=url?new URL(url):undefined;if(connection)connection.pathname=`/${databaseName}`;
  const pool=connection?new Pool({connectionString:connection.toString()}):undefined;
  const db:SqlClient=pool??{query:async(sql,parameters)=>{
    if(!parameters&&sql.includes(';')){await memory!.exec(sql);return{rows:[],rowCount:null};}
    const result=await memory!.query(sql,parameters as never[]|undefined);
    return{rows:result.rows,rowCount:result.affectedRows??null};
  }} as SqlClient;
  const directory=new URL('../migrations/',import.meta.url);
  for(const filename of (await readdir(directory)).filter(name=>/^\d+.*\.sql$/.test(name)).sort())await db.query(await readFile(new URL(filename,directory),'utf8'));
  const input=normalizeBootstrapInput({entraTenantId:randomUUID(),adminOid:randomUUID(),adminEmail:'hold-replay@example.test',adminName:'Hold replay',workspaceName:'Isolated hold replay',workspaceId:randomUUID()});
  const ids=bootstrapIds(input);await bootstrapPilotWorkspace(db,{...input,...ids});
  const projects=[randomUUID(),randomUUID()];
  const setup=pool?await pool.connect():db;
  try{
    await setup.query('BEGIN');await setup.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)",[ids.tenantId,ids.userId]);
    for(const [index,id] of projects.entries())await setup.query("INSERT INTO projects(id,tenant_id,code,name,slug) VALUES($1,$2,$3,'Technical hold replay',$4)",[id,ids.tenantId,`REPLAY${index}`,`replay-${index}`]);
    await setup.query('COMMIT');
  }catch(error){await setup.query('ROLLBACK');throw error;}finally{if(pool)(setup as PoolClient).release();}
  async function unit(project=projects[0]){
    const id=randomUUID();await db.query('INSERT INTO units(id,tenant_id,project_id,code,area_m2) VALUES($1,$2,$3,$4,50)',[id,ids.tenantId,project,id]);return id;
  }
  async function run<T>(work:(c:SqlClient)=>Promise<T>,context={tenantId:ids.tenantId,userId:ids.userId}){
    const c=pool?await pool.connect():db;
    try{await c.query('BEGIN');await c.query('SET LOCAL ROLE develocrm_app');await c.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)",[context.tenantId,context.userId]);const value=await work(c);await c.query('COMMIT');return value;}
    catch(error){await c.query('ROLLBACK');throw error;}finally{if(pool)(c as PoolClient).release();}
  }
  const expiry=new Date(Date.now()+48*3600000).toISOString();
  type Hold={party_id:string;sales_case_id:string;hold_id:string};
  const create=(c:SqlClient,unitId:string,key:string,name='Buyer',expiresAt=expiry,actor=ids.membershipId,tenant=ids.tenantId)=>c.query<Hold>("SELECT * FROM app.create_party_and_unit_hold($1,$2,'pre_reservation',$3,$4,$5,'Technical replay','individual',NULL,'Technical',$6,NULL,NULL,$7,NULL)",[tenant,unitId,expiresAt,actor,key,name,`${name.toLowerCase()}-${key}@example.test`]);
  const existing=(c:SqlClient,unitId:string,party:string,key:string,expiresAt=expiry,reason='Technical existing')=>c.query<Hold>("SELECT * FROM app.create_unit_hold($1,$2,'pre_reservation',ARRAY[$3]::uuid[],$4,$5,NULL,$6,$7)",[ids.tenantId,unitId,party,expiresAt,ids.membershipId,key,reason]);
  const events=async(id:string)=>(await db.query<{audit:number;outbox:number}>("SELECT (SELECT count(*)::int FROM audit_log WHERE entity_id=$1 AND action='hold.created') audit,(SELECT count(*)::int FROM outbox_events WHERE aggregate_id=$1 AND event_type='hold.created.v1') outbox",[id])).rows[0];
  async function close(){if(memory)await memory.close();if(pool)await pool.end();if(admin){await admin.query(`DROP DATABASE "${databaseName}"`);await admin.end();}}
  return{db,pool,ids,projects,unit,run,expiry,create,existing,events,close};
}

for(const native of [false,true])test(`hold command replay binding (${native?'PostgreSQL':'PGlite'})`,{skip:native&&!process.env.WORKFLOW_TEST_DATABASE_URL},async t=>{
  const f=await fixture(native?process.env.WORKFLOW_TEST_DATABASE_URL:undefined);
  try{
    const a=await f.unit(),b=await f.unit(f.projects[1]),key=randomUUID();
    assert.equal((await f.run(c=>c.query<{allowed:boolean}>("SELECT app.has_project_permission($1,$2,$3,'clients.create') allowed",[f.ids.tenantId,f.ids.membershipId,f.projects[0]]))).rows[0].allowed,true,'fixture uses current project access matrix');
    const original=(await f.run(c=>f.create(c,a,key))).rows[0];
    await t.test('identical new-party retry returns the exact original result and no new events',async()=>{
      const retried=(await f.run(c=>f.create(c,a,key))).rows[0];assert.deepEqual(retried,original);
      assert.deepEqual(await f.events(original.hold_id),{audit:1,outbox:1});
      const evidence=(await f.db.query<{creation_request_hash:string;creation_party_id:string}>('SELECT creation_request_hash,creation_party_id FROM unit_holds WHERE id=$1',[original.hold_id])).rows[0];
      assert.match(evidence.creation_request_hash,/^[0-9a-f]{64}$/);assert.equal(evidence.creation_party_id,original.party_id);
    });
    await t.test('same key for a different unit or project is rejected without changing target',async()=>{
      await assert.rejects(f.run(c=>f.create(c,b,key)),/HOLD_IDEMPOTENCY_CONFLICT/);
      assert.equal((await f.db.query<{commercial_status:string}>('SELECT commercial_status FROM units WHERE id=$1',[b])).rows[0].commercial_status,'available');
    });
    await t.test('changed new-party identity or expiry is not a replay',async()=>{
      await assert.rejects(f.run(c=>f.create(c,a,key,'Different')),/HOLD_IDEMPOTENCY_CONFLICT/);
      await assert.rejects(f.run(c=>f.create(c,a,key,'Buyer',new Date(Date.parse(f.expiry)+1000).toISOString())),/HOLD_IDEMPOTENCY_CONFLICT/);
    });
    await t.test('command kinds cannot reuse each other’s keys',async()=>{
      await assert.rejects(f.run(c=>f.existing(c,a,original.party_id,key)),/HOLD_IDEMPOTENCY_CONFLICT/);
    });
    await t.test('existing-party replay validates unit, reason, expiry and party',async()=>{
      const unit=await f.unit(),other=await f.unit(),existingKey=randomUUID();
      const result=(await f.run(c=>f.existing(c,unit,original.party_id,existingKey))).rows[0];
      assert.deepEqual((await f.run(c=>f.existing(c,unit,original.party_id,existingKey))).rows[0],result);
      await assert.rejects(f.run(c=>f.existing(c,other,original.party_id,existingKey)),/HOLD_IDEMPOTENCY_CONFLICT/);
      await assert.rejects(f.run(c=>f.existing(c,unit,original.party_id,existingKey,f.expiry,'Changed reason')),/HOLD_IDEMPOTENCY_CONFLICT/);
      await assert.rejects(f.run(c=>f.existing(c,unit,original.party_id,existingKey,new Date(Date.parse(f.expiry)+1000).toISOString())),/HOLD_IDEMPOTENCY_CONFLICT/);
      await assert.rejects(f.run(c=>f.existing(c,unit,randomUUID(),existingKey)),/HOLD_IDEMPOTENCY_CONFLICT/);
      assert.deepEqual(await f.events(result.hold_id),{audit:1,outbox:1});
    });
    await t.test('replay after cancellation returns evidence, never recreates an active hold',async()=>{
      await f.run(c=>c.query("SELECT app.cancel_unit_hold($1,$2,$3,'Technical cancellation')",[f.ids.tenantId,original.hold_id,f.ids.membershipId]));
      assert.deepEqual((await f.run(c=>f.create(c,a,key))).rows[0],original);
      assert.equal((await f.db.query<{status:string}>('SELECT status FROM unit_holds WHERE id=$1',[original.hold_id])).rows[0].status,'cancelled');
      assert.deepEqual(await f.events(original.hold_id),{audit:1,outbox:1});
    });
    await t.test('legacy hashless commands fail closed without guessed historical data',async()=>{
      await f.db.query('UPDATE unit_holds SET creation_request_hash=NULL WHERE id=$1',[original.hold_id]);
      await assert.rejects(f.run(c=>f.create(c,a,key)),/HOLD_IDEMPOTENCY_CONFLICT/);
    });
    await t.test('missing key is validation, not permission error',async()=>{
      await assert.rejects(f.run(c=>f.create(c,b,'')),/HOLD_IDEMPOTENCY_INVALID_KEY/);
    });
    await t.test('foreign tenant never resolves or replays original hold',async()=>{
      await assert.rejects(f.run(c=>f.create(c,b,key,'Buyer',f.expiry,f.ids.membershipId,randomUUID())),/invalid hold command|permission/);
      await assert.rejects(f.run(c=>f.create(c,b,key),{tenantId:randomUUID(),userId:f.ids.userId}),/invalid hold command|permission/);
    });
    await t.test('project scope and active membership are checked before replay',async()=>{
      const user=randomUUID(),member=randomUUID();
      await f.db.query("INSERT INTO users(id,entra_issuer,entra_subject,email,display_name) VALUES($1,'https://identity.test',$2,'scoped-replay@example.test','Scoped replay')",[user,randomUUID()]);
      await f.db.query("INSERT INTO tenant_memberships(id,tenant_id,user_id,status,accepted_at) VALUES($1,$2,$3,'active',now())",[member,f.ids.tenantId,user]);
      for(const area of ['clients','units'])await f.db.query("INSERT INTO project_custom_access(tenant_id,project_id,membership_id,area,access_level,assigned_by_user_id) VALUES($1,$2,$3,$4,'edit',$5)",[f.ids.tenantId,f.projects[0],member,area,f.ids.userId]);
      const context={tenantId:f.ids.tenantId,userId:user};
      await assert.rejects(f.run(c=>f.create(c,b,key,'Buyer',f.expiry,member),context),/permission/);
      await assert.rejects(f.run(c=>f.create(c,a,key,'Buyer',f.expiry,member),context),/HOLD_IDEMPOTENCY_CONFLICT/);
      await f.db.query("UPDATE tenant_memberships SET status='suspended' WHERE id=$1",[member]);
      await assert.rejects(f.run(c=>f.create(c,a,key,'Buyer',f.expiry,member),context),/permission|invalid hold/);
    });
    await t.test('manual conversion still cannot create reservation without signed RS',async()=>{
      const unit=await f.unit(),creationKey=randomUUID(),conversionKey=randomUUID();
      const source=(await f.run(c=>f.existing(c,unit,original.party_id,creationKey))).rows[0];
      const expires=new Date(Date.parse(f.expiry)+3600000).toISOString();
      const convert=(c:SqlClient,reason='Technical conversion')=>c.query<{id:string}>("SELECT app.convert_pre_reservation($1,$2,$3,$4,$5,$6) id",[f.ids.tenantId,source.hold_id,expires,f.ids.membershipId,conversionKey,reason]);
      await assert.rejects(f.run(c=>convert(c)),/reservation requires a signed RS/);
      assert.equal((await f.db.query<{status:string}>('SELECT status FROM unit_holds WHERE id=$1',[source.hold_id])).rows[0].status,'active');
    });
    if(f.pool)await t.test('real concurrent identical requests wait at unit lock and emit once',async()=>{
      const unit=await f.unit(),raceKey=randomUUID();const left=await f.pool!.connect(),right=await f.pool!.connect();
      try{
        for(const c of [left,right]){await c.query('BEGIN');await c.query('SET LOCAL ROLE develocrm_app');await c.query("SET LOCAL statement_timeout='5s'");await c.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)",[f.ids.tenantId,f.ids.userId]);}
        const first=(await f.create(left,unit,raceKey,'Concurrent')).rows[0];
        const pid=(await right.query<{pid:number}>('SELECT pg_backend_pid() pid')).rows[0].pid;
        const pending=f.create(right,unit,raceKey,'Concurrent').then(value=>({value,error:null}),error=>({value:null,error}));
        let waiting=false;for(let i=0;i<100&&!waiting;i++){waiting=(await f.pool!.query<{waiting:boolean}>("SELECT wait_event_type='Lock' waiting FROM pg_stat_activity WHERE pid=$1",[pid])).rows[0]?.waiting===true;if(!waiting)await new Promise(resolve=>setTimeout(resolve,10));}
        assert.equal(waiting,true);await left.query('COMMIT');const second=await pending;
        assert.equal(second.error,null);assert.deepEqual(second.value!.rows[0],first);await right.query('COMMIT');
        assert.deepEqual(await f.events(first.hold_id),{audit:1,outbox:1});
        assert.equal((await f.db.query("SELECT id FROM unit_holds WHERE unit_id=$1 AND status='active'",[unit])).rows.length,1);
      }finally{await left.query('ROLLBACK');await right.query('ROLLBACK');left.release();right.release();}
    });
    if(f.pool)await t.test('same key across two units cannot create two holds or two canonical parties',async()=>{
      const left=await f.unit(),right=await f.unit(),raceKey=randomUUID();
      const results=await Promise.allSettled([f.run(c=>f.create(c,left,raceKey,'CrossUnit')),f.run(c=>f.create(c,right,raceKey,'CrossUnit'))]);
      assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
      const rejected=results.find(result=>result.status==='rejected') as PromiseRejectedResult;
      assert.notEqual(rejected.reason.code,'40P01');
      assert.match(rejected.reason.message,/HOLD_IDEMPOTENCY_CONFLICT|duplicate key/);
      assert.equal((await f.db.query('SELECT id FROM unit_holds WHERE tenant_id=$1 AND idempotency_key=$2',[f.ids.tenantId,raceKey])).rows.length,1);
      assert.equal((await f.db.query("SELECT id FROM parties WHERE tenant_id=$1 AND display_name='Technical CrossUnit'",[f.ids.tenantId])).rows.length,1);
    });
  }finally{await f.close();}
});

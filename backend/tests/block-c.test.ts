import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { Database } from "../src/database.js";
import { SalesRepository } from "../src/sales/repository.js";

const a={ tenant:"11000000-0000-4000-8000-000000000001",user:"21000000-0000-4000-8000-000000000001",member:"31000000-0000-4000-8000-000000000001",role:"41000000-0000-4000-8000-000000000001",project:"51000000-0000-4000-8000-000000000001",structure:"61000000-0000-4000-8000-000000000001",unit:"71000000-0000-4000-8000-000000000001",unit2:"71000000-0000-4000-8000-000000000002",party:"81000000-0000-4000-8000-000000000001",party2:"81000000-0000-4000-8000-000000000002" };
const b={ tenant:"11000000-0000-4000-8000-000000000002",user:"21000000-0000-4000-8000-000000000002",member:"31000000-0000-4000-8000-000000000002",role:"41000000-0000-4000-8000-000000000002",project:"51000000-0000-4000-8000-000000000002",structure:"61000000-0000-4000-8000-000000000002",unit:"71000000-0000-4000-8000-000000000003",party:"81000000-0000-4000-8000-000000000003" };

async function database() {
  const db=new PGlite();
  for(const name of ["0001_block_a_identity.sql","0002_block_b_inventory.sql","0003_block_c_sales.sql"]) await db.exec(await readFile(new URL(`../migrations/${name}`,import.meta.url),"utf8"));
  await db.exec(`
    SELECT set_config('app.commercial_status_command','on',true);
    INSERT INTO tenants(id,name,slug) VALUES ('${a.tenant}','Tenant A','tenant-a'),('${b.tenant}','Tenant B','tenant-b');
    INSERT INTO users(id,entra_issuer,entra_subject,email,display_name) VALUES ('${a.user}','ia','sa','a@test','User A'),('${b.user}','ib','sb','b@test','User B');
    INSERT INTO tenant_memberships(id,tenant_id,user_id,status,accepted_at) VALUES ('${a.member}','${a.tenant}','${a.user}','active',now()),('${b.member}','${b.tenant}','${b.user}','active',now());
    INSERT INTO roles(id,tenant_id,code,name) VALUES ('${a.role}','${a.tenant}','sales','Sales A'),('${b.role}','${b.tenant}','sales','Sales B');
    INSERT INTO role_permissions(tenant_id,role_id,permission_id) SELECT '${a.tenant}','${a.role}',id FROM permissions WHERE code IN ('clients.read','clients.export','sales_case.read','holds.manage');
    INSERT INTO role_permissions(tenant_id,role_id,permission_id) SELECT '${b.tenant}','${b.role}',id FROM permissions WHERE code IN ('clients.read','clients.export','sales_case.read','holds.manage');
    INSERT INTO projects(id,tenant_id,code,name,slug) VALUES ('${a.project}','${a.tenant}','PA','Project A','project-a'),('${b.project}','${b.tenant}','PB','Project B','project-b');
    INSERT INTO project_structures(id,tenant_id,project_id,kind,code,name) VALUES ('${a.structure}','${a.tenant}','${a.project}','building','A','Building A'),('${b.structure}','${b.tenant}','${b.project}','building','B','Building B');
    INSERT INTO units(id,tenant_id,project_id,structure_id,code,area_m2) VALUES ('${a.unit}','${a.tenant}','${a.project}','${a.structure}','A101',50),('${a.unit2}','${a.tenant}','${a.project}','${a.structure}','A102',60),('${b.unit}','${b.tenant}','${b.project}','${b.structure}','B101',55);
    INSERT INTO project_role_assignments(tenant_id,project_id,membership_id,role_id,assigned_by_user_id) VALUES ('${a.tenant}','${a.project}','${a.member}','${a.role}','${a.user}'),('${b.tenant}','${b.project}','${b.member}','${b.role}','${b.user}');
    INSERT INTO parties(id,tenant_id,party_type,display_name) VALUES ('${a.party}','${a.tenant}','individual','Jana A'),('${a.party2}','${a.tenant}','individual','Petr A'),('${b.party}','${b.tenant}','organization','Firma B');
    INSERT INTO party_individual_details(tenant_id,party_id,first_name,last_name) VALUES ('${a.tenant}','${a.party}','Jana','A'),('${a.tenant}','${a.party2}','Petr','A');
    INSERT INTO party_organization_details(tenant_id,party_id,legal_name,registration_number) VALUES ('${b.tenant}','${b.party}','Firma B','12345678');
    INSERT INTO party_contacts(tenant_id,party_id,contact_type,value,normalized_value,is_primary) VALUES ('${a.tenant}','${a.party}','email','same@test','same@test',true),('${a.tenant}','${a.party2}','email','same@test','same@test',true),('${b.tenant}','${b.party}','email','b@test','b@test',true);
    INSERT INTO party_project_links(tenant_id,project_id,party_id,relationship_type) VALUES ('${a.tenant}','${a.project}','${a.party}','prospect'),('${a.tenant}','${a.project}','${a.party2}','prospect'),('${b.tenant}','${b.project}','${b.party}','buyer');
  `);
  return db;
}

async function asTenant(db:PGlite,tenant:string,user:string) { await db.exec(`SET ROLE develocrm_app; SELECT set_config('app.user_id','${user}',false); SELECT set_config('app.tenant_id','${tenant}',false);`); }

test("blok C seed je opakovatelný a neobsahuje citlivé FO identifikátory",async()=>{
  const db=new PGlite(); for(const name of ["0001_block_a_identity.sql","0002_block_b_inventory.sql","0003_block_c_sales.sql"])await db.exec(await readFile(new URL(`../migrations/${name}`,import.meta.url),"utf8"));
  await db.exec(await readFile(new URL("../seeds/0001_preview_block_b.sql",import.meta.url),"utf8")); const seed=await readFile(new URL("../seeds/0002_preview_block_c.sql",import.meta.url),"utf8"); await db.exec(seed);await db.exec(seed);
  assert.equal((await db.query("SELECT id FROM parties")).rows.length,11); assert.equal((await db.query("SELECT id FROM party_private_identifiers")).rows.length,0); await db.close();
});

test("RLS izoluje parties, interests a sales cases mezi tenanty",async()=>{const db=await database(); await db.query("INSERT INTO sales_cases(tenant_id,project_id,unit_id) VALUES($1,$2,$3)",[b.tenant,b.project,b.unit]); await asTenant(db,a.tenant,a.user); assert.equal((await db.query("SELECT id FROM parties")).rows.length,2);assert.equal((await db.query("SELECT id FROM sales_cases")).rows.length,0);await db.close();});

test("e-mail není unikátní, externí ID a IČO deduplikační klíče unikátní jsou",async()=>{const db=await database();
  assert.equal((await db.query("SELECT id FROM party_contacts WHERE normalized_value='same@test'")).rows.length,2);
  await db.query("INSERT INTO party_external_identifiers(tenant_id,party_id,source_system,external_id) VALUES($1,$2,'legacy','42')",[a.tenant,a.party]);
  await assert.rejects(db.query("INSERT INTO party_external_identifiers(tenant_id,party_id,source_system,external_id) VALUES($1,$2,'legacy','42')",[a.tenant,a.party2]),/unique/i);await db.close();
});

test("sales case podporuje více kupujících, ale jednotka jen jeden aktivní case",async()=>{const db=await database();const caseId="91000000-0000-4000-8000-000000000001";
  await db.query("INSERT INTO sales_cases(id,tenant_id,project_id,unit_id) VALUES($1,$2,$3,$4)",[caseId,a.tenant,a.project,a.unit]);
  await db.query("INSERT INTO sales_case_parties(tenant_id,project_id,sales_case_id,party_id,participant_role,is_primary) VALUES($1,$2,$3,$4,'buyer',true),($1,$2,$3,$5,'co_buyer',false)",[a.tenant,a.project,caseId,a.party,a.party2]);
  assert.equal((await db.query("SELECT id FROM sales_case_parties WHERE sales_case_id=$1",[caseId])).rows.length,2);
  await assert.rejects(db.query("INSERT INTO sales_cases(tenant_id,project_id,unit_id) VALUES($1,$2,$3)",[a.tenant,a.project,a.unit]),/sales_case_one_active_unit_uq|unique/i);await db.close();
});

test("klient může mít více jednotek a historie zájmu se po konverzi nemaže",async()=>{const db=await database();
  await db.query("INSERT INTO unit_interests(tenant_id,project_id,unit_id,party_id,status,first_interest_at,last_interest_at) VALUES($1,$2,$3,$4,'closed','2026-01-01','2026-01-02'),($1,$2,$5,$4,'active','2026-02-01','2026-02-01')",[a.tenant,a.project,a.unit,a.party,a.unit2]);
  assert.equal((await db.query("SELECT id FROM unit_interests WHERE party_id=$1",[a.party])).rows.length,2);await db.close();
});

test("předrezervace atomicky vytvoří case, hold, účastníky, historii, status, audit a outbox",async()=>{const db=await database();await asTenant(db,a.tenant,a.user);
  const result=await db.query<{sales_case_id:string;hold_id:string}>("SELECT * FROM app.create_unit_hold($1,$2,'pre_reservation',$3::uuid[],now()+interval '2 days',$4,NULL,'create-1','Klient potvrdil zájem')",[a.tenant,a.unit,[a.party,a.party2],a.member]);
  assert.equal(result.rows.length,1);assert.equal((await db.query<{commercial_status:string}>("SELECT commercial_status FROM units WHERE id=$1",[a.unit])).rows[0].commercial_status,"pre_reserved");
  assert.equal((await db.query("SELECT id FROM sales_case_parties WHERE sales_case_id=$1",[result.rows[0].sales_case_id])).rows.length,2);
  assert.ok((await db.query("SELECT id FROM audit_log WHERE entity_id=$1",[result.rows[0].hold_id])).rows.length>0);assert.ok((await db.query("SELECT id FROM outbox_events WHERE aggregate_id=$1",[result.rows[0].hold_id])).rows.length>0);await db.close();
});

test("konfliktní hold je odmítnut a předrezervaci lze převést na rezervaci",async()=>{const db=await database();await asTenant(db,a.tenant,a.user);
  const created=(await db.query<{hold_id:string}>("SELECT hold_id FROM app.create_unit_hold($1,$2,'pre_reservation',$3::uuid[],now()+interval '2 days',$4,NULL,'pre-1','Vznik předrezervace')",[a.tenant,a.unit,[a.party],a.member])).rows[0];
  await assert.rejects(db.query("SELECT * FROM app.create_unit_hold($1,$2,'reservation',$3::uuid[],now()+interval '3 days',$4,NULL,'res-conflict','Konfliktní rezervace')",[a.tenant,a.unit,[a.party2],a.member]),/overlaps/i);
  const converted=(await db.query<{hold_id:string}>("SELECT app.convert_pre_reservation($1,$2,now()+interval '5 days',$3,'convert-1','Potvrzena rezervace') hold_id",[a.tenant,created.hold_id,a.member])).rows[0];
  assert.ok(converted.hold_id);assert.equal((await db.query<{commercial_status:string}>("SELECT commercial_status FROM units WHERE id=$1",[a.unit])).rows[0].commercial_status,"reserved");await db.close();
});

test("expirace je idempotentní a vrátí jednotku jen bez jiné platné vazby",async()=>{const db=await database();const caseId="91000000-0000-4000-8000-000000000002",holdId="92000000-0000-4000-8000-000000000001";
  await db.exec("SELECT set_config('app.commercial_status_command','on',false)");await db.query("UPDATE units SET commercial_status='pre_reserved' WHERE id=$1",[a.unit]);
  await db.query("INSERT INTO sales_cases(id,tenant_id,project_id,unit_id,current_stage) VALUES($1,$2,$3,$4,'pre_reservation')",[caseId,a.tenant,a.project,a.unit]);
  await db.query("INSERT INTO unit_holds(id,tenant_id,project_id,unit_id,sales_case_id,hold_type,starts_at,expires_at,idempotency_key,created_by_membership_id) VALUES($1,$2,$3,$4,$5,'pre_reservation',now()-interval '2 days',now()-interval '1 day','old',$6)",[holdId,a.tenant,a.project,a.unit,caseId,a.member]);
  await asTenant(db,a.tenant,a.user);assert.equal((await db.query<{changed:boolean}>("SELECT app.expire_unit_hold($1,$2,$3) changed",[a.tenant,holdId,a.member])).rows[0].changed,true);assert.equal((await db.query<{changed:boolean}>("SELECT app.expire_unit_hold($1,$2,$3) changed",[a.tenant,holdId,a.member])).rows[0].changed,false);assert.equal((await db.query<{commercial_status:string}>("SELECT commercial_status FROM units WHERE id=$1",[a.unit])).rows[0].commercial_status,"available");await db.close();
});

test("hold.expiring se zařadí do outboxu právě jednou",async()=>{const db=await database();await asTenant(db,a.tenant,a.user);await db.query("SELECT * FROM app.create_unit_hold($1,$2,'pre_reservation',$3::uuid[],now()+interval '2 hours',$4,NULL,'notify-1','Krátká předrezervace')",[a.tenant,a.unit,[a.party],a.member]);assert.equal((await db.query<{count:number}>("SELECT app.enqueue_expiring_holds($1,interval '1 day') count",[a.tenant])).rows[0].count,1);assert.equal((await db.query<{count:number}>("SELECT app.enqueue_expiring_holds($1,interval '1 day') count",[a.tenant])).rows[0].count,0);await db.close();});

test("project-scoped clients.export vrací jen povolený rozsah",async()=>{const db=await database();const adapter={withContext:async<T>(context:{tenantId?:string;userId?:string},work:(client:{query:typeof db.query})=>Promise<T>)=>{await db.exec(`SET ROLE develocrm_app; SELECT set_config('app.user_id','${context.userId??""}',false); SELECT set_config('app.tenant_id','${context.tenantId??""}',false);`);return work({query:db.query.bind(db)});}} as unknown as Database;
  const repository=new SalesRepository(adapter);const rows=await repository.exportContacts({tenantId:a.tenant,userId:a.user,membershipId:a.member,partyIds:[a.party,a.party2,b.party]});assert.deepEqual(new Set(rows.map((row)=>row.id)),new Set([a.party,a.party2]));await db.close();
});

test("doménový příkaz hold respektuje project-scoped holds.manage",async()=>{const db=await database();await db.query("DELETE FROM role_permissions WHERE tenant_id=$1 AND role_id=$2 AND permission_id=(SELECT id FROM permissions WHERE code='holds.manage')",[a.tenant,a.role]);await asTenant(db,a.tenant,a.user);await assert.rejects(db.query("SELECT * FROM app.create_unit_hold($1,$2,'pre_reservation',$3::uuid[],now()+interval '1 day',$4,NULL,'denied-1','Pokus bez oprávnění')",[a.tenant,a.unit,[a.party],a.member]),/holds\.manage permission required/i);await db.close();});

test("všechny tabulky bloku C mají ENABLE a FORCE RLS",async()=>{const db=await database();const tables=["parties","party_individual_details","party_organization_details","party_contacts","party_addresses","party_external_identifiers","party_private_identifiers","party_project_links","unit_interests","sales_cases","sales_case_parties","interest_events","sales_stage_events","unit_holds"];const rows=await db.query<{relrowsecurity:boolean;relforcerowsecurity:boolean}>("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=ANY($1::text[])",[tables]);assert.equal(rows.rows.length,tables.length);assert.ok(rows.rows.every((row)=>row.relrowsecurity&&row.relforcerowsecurity));await db.close();});

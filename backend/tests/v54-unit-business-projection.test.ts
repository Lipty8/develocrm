import assert from "node:assert/strict";
import {readdir,readFile} from "node:fs/promises";
import test from "node:test";
import {PGlite} from "@electric-sql/pglite";

const tenant="d0000000-0000-4000-8000-000000000001";
const project="e0000000-0000-4000-8000-000000000001";
const member="d3000000-0000-4000-8000-000000000001";
const buyer="c0000000-0000-4000-8000-000000000001";
const replacement="c0000000-0000-4000-8000-000000000002";

async function database(){
  const db=new PGlite();const directory=new URL("../migrations/",import.meta.url);
  const names=(await readdir(directory)).filter(name=>/^\d+.*\.sql$/.test(name)&&!name.startsWith("0015_")).sort();
  for(const name of names.filter(name=>name<="0004_block_d_pricing_contracts.sql"))await db.exec(await readFile(new URL(name,directory),"utf8"));
  for(const name of ["0001_preview_block_b.sql","0002_preview_block_c.sql","0003_preview_block_d.sql"])await db.exec(await readFile(new URL(`../seeds/${name}`,import.meta.url),"utf8"));
  for(const name of names.filter(name=>name>"0004_block_d_pricing_contracts.sql"))await db.exec(await readFile(new URL(name,directory),"utf8"));
  return db;
}

async function createScenario(db:PGlite,key:string,options:{active?:boolean;stage?:string;contract?:"rs"|"sbk"|"ks";payment?:"unpaid"|"partial"|"full";handover?:boolean;cancelled?:boolean}={}){
  const unit=(await db.query<{id:string}>("INSERT INTO units(tenant_id,project_id,code,area_m2) VALUES($1,$2,$3,50) RETURNING id",[tenant,project,`KPI-${key}`])).rows[0].id;
  if(options.active===false)return{unit,caseId:null,contractId:null};
  const caseId=(await db.query<{id:string}>("INSERT INTO sales_cases(tenant_id,project_id,unit_id,status,current_stage,closed_at,close_reason) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",[
    tenant,project,unit,options.cancelled?"cancelled":"active",options.stage??"interest",options.cancelled?new Date().toISOString():null,options.cancelled?"Test ukončení":null,
  ])).rows[0].id;
  await db.query("INSERT INTO sales_case_parties(tenant_id,project_id,sales_case_id,party_id,participant_role,is_primary) VALUES($1,$2,$3,$4,'buyer',true)",[tenant,project,caseId,buyer]);
  let contractId:string|null=null;
  if(options.contract){
    contractId=(await db.query<{id:string}>("INSERT INTO contracts(tenant_id,project_id,unit_id,sales_case_id,contract_type,reference,title,current_status,created_by_membership_id,signed_at,ended_at,end_reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id",[
      tenant,project,unit,caseId,options.contract,`KPI-${key}`,`Test ${key}`,options.cancelled?"cancelled":"signed",member,
      options.cancelled?null:new Date().toISOString(),options.cancelled?new Date().toISOString():null,options.cancelled?"Test ukončení":null,
    ])).rows[0].id;
    if(options.contract==="rs"&&options.payment){
      const obligation=(await db.query<{id:string}>("INSERT INTO payment_obligations(tenant_id,project_id,unit_id,party_id,sales_case_id,contract_id,obligation_type,label,amount,due_at,idempotency_key,created_by_membership_id,cancelled_at,cancellation_reason) VALUES($1,$2,$3,$4,$5,$6,'reservation_fee','Rezervační poplatek',100000,now()+interval '5 days',$7,$8,$9,$10) RETURNING id",[
        tenant,project,unit,buyer,caseId,contractId,`kpi-${key}`,member,options.cancelled?new Date().toISOString():null,options.cancelled?"Test ukončení":null,
      ])).rows[0].id;
      if(options.payment!=="unpaid"){
        const amount=options.payment==="full"?100000:40000;
        const transaction=(await db.query<{id:string}>("INSERT INTO payment_transactions(tenant_id,project_id,amount,paid_at,created_by_membership_id) VALUES($1,$2,$3,now(),$4) RETURNING id",[tenant,project,amount,member])).rows[0].id;
        await db.query("INSERT INTO payment_allocations(tenant_id,project_id,obligation_id,transaction_id,amount,allocated_by_membership_id) VALUES($1,$2,$3,$4,$5,$6)",[tenant,project,obligation,transaction,amount,member]);
      }
    }
    if(options.handover)await db.query("INSERT INTO unit_handovers(tenant_id,project_id,unit_id,sales_case_id,scheduled_at,responsible_membership_id,status,readiness_percent,completed_at) VALUES($1,$2,$3,$4,now(),$5,'handed_over',100,now())",[tenant,project,unit,caseId,member]);
  }
  return{unit,caseId,contractId};
}

async function bucket(db:PGlite,unit:string){return(await db.query<{sales_bucket:string;current_buyers:Array<{partyId:string;name:string}>}>("SELECT sales_bucket,current_buyers FROM app.unit_business_projection($1,$2)",[tenant,unit])).rows[0];}

test("centrální business projekce pokrývá schválenou matici 11 scénářů",async()=>{
  const db=await database();
  const scenarios:[string,Parameters<typeof createScenario>[2],string][]=[
    ["free",{active:false},"available"],
    ["interest",{stage:"interest"},"in_negotiation"],
    ["pre-reservation",{stage:"pre_reservation"},"in_negotiation"],
    ["rs-no-fee",{stage:"rs",contract:"rs"},"in_negotiation"],
    ["rs-unpaid",{stage:"rs",contract:"rs",payment:"unpaid"},"in_negotiation"],
    ["rs-partial",{stage:"rs",contract:"rs",payment:"partial"},"in_negotiation"],
    ["rs-paid",{stage:"rs",contract:"rs",payment:"full"},"sold"],
    ["direct-sbk",{stage:"sbk",contract:"sbk"},"sold"],
    ["direct-ks",{stage:"ks",contract:"ks"},"sold"],
    ["handover",{stage:"handover",contract:"ks",handover:true},"sold"],
    ["cancelled-history",{stage:"rs",contract:"rs",payment:"full",cancelled:true},"available"],
  ];
  for(const [key,options,expected] of scenarios){const row=await createScenario(db,key,options);assert.equal((await bucket(db,row.unit)).sales_bucket,expected,key);}
  await db.close();
});

test("aktuální kupující pochází výhradně z aktivního sales case a respektuje postoupení",async()=>{
  const db=await database();const row=await createScenario(db,"buyer-source",{stage:"rs",contract:"rs",payment:"unpaid"});
  assert.equal((await bucket(db,row.unit)).current_buyers[0].name,"Jana Nováková");
  await db.query("UPDATE sales_case_parties SET left_at=now(),is_primary=false WHERE tenant_id=$1 AND sales_case_id=$2 AND party_id=$3",[tenant,row.caseId,buyer]);
  await db.query("INSERT INTO sales_case_parties(tenant_id,project_id,sales_case_id,party_id,participant_role,is_primary) VALUES($1,$2,$3,$4,'buyer',true)",[tenant,project,row.caseId,replacement]);
  const buyers=(await bucket(db,row.unit)).current_buyers;
  assert.deepEqual(buyers.map(item=>item.name),["Petr Novák"]);
  await db.close();
});

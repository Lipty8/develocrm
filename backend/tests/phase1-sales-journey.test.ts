import assert from "node:assert/strict";
import {readFile, readdir} from "node:fs/promises";
import test from "node:test";
import {PGlite} from "@electric-sql/pglite";
import {bootstrapIds, bootstrapPilotWorkspace, normalizeBootstrapInput} from "../src/iam/pilot-bootstrap.js";
import {importDejvice} from "../src/imports/dejvice.js";

async function fixture() {
  const db = new PGlite();
  const directory = new URL("../migrations/", import.meta.url);
  for (const name of (await readdir(directory)).filter(name => /^\d+.*\.sql$/.test(name)).sort()) {
    await db.exec(await readFile(new URL(name, directory), "utf8"));
  }
  const normalized = normalizeBootstrapInput({
    entraTenantId: "10000000-0000-4000-8000-000000000061",
    adminOid: "20000000-0000-4000-8000-000000000061",
    adminEmail: "journey.admin@example.test",
    adminName: "Journey Admin",
    workspaceName: "Isolated journey fixture",
    workspaceId: "30000000-0000-4000-8000-000000000061",
  });
  const ids = bootstrapIds(normalized);
  const client = {query: async (sql: string, parameters?: unknown[]) => {
    if (!parameters && sql.includes(";")) { await db.exec(sql); return {rows: [], rowCount: null}; }
    const result = await db.query(sql, parameters as never[] | undefined);
    return {rows: result.rows, rowCount: result.affectedRows ?? null};
  }} as never;
  await bootstrapPilotWorkspace(client, {...normalized, ...ids});
  const source = await readFile(new URL("../seeds/0004_pilot_rezidence_dejvice.sql", import.meta.url), "utf8");
  await importDejvice(client, source, {tenantId: ids.tenantId, membershipId: ids.membershipId, dryRun: false});
  await db.exec(`SET ROLE develocrm_app; SELECT set_config('app.tenant_id','${ids.tenantId}',false); SELECT set_config('app.user_id','${ids.userId}',false);`);
  return {db, ids};
}

test("FÁZE 1: volná jednotka projde předrezervací, RS, úhradou, SBK, KS a předáním bez přímého UPDATE", async () => {
  const {db, ids} = await fixture();
  try {
    const unit = (await db.query<{id: string}>(`SELECT unit.id FROM units unit
      WHERE unit.tenant_id=$1 AND unit.commercial_status='available'
      AND NOT EXISTS (SELECT 1 FROM unit_handovers handover WHERE handover.tenant_id=unit.tenant_id
        AND handover.unit_id=unit.id AND handover.status<>'cancelled')
      ORDER BY unit.code DESC LIMIT 1`, [ids.tenantId])).rows[0];
    assert.ok(unit, "fixture musí mít volnou jednotku bez aktivního předání");
    const hold = (await db.query<{party_id: string; sales_case_id: string; hold_id: string}>(
      `SELECT * FROM app.create_party_and_unit_hold($1,$2,'pre_reservation',now()+interval '48 hours',$3,
        'phase1-journey-party','Předrezervace','individual',NULL,'Testovací','Kupující',NULL,NULL,
        'journey-buyer@example.test',NULL)`, [ids.tenantId, unit.id, ids.membershipId],
    )).rows[0];
    assert.ok(hold.party_id && hold.sales_case_id && hold.hold_id);
    assert.equal((await db.query<{commercial_status: string}>("SELECT commercial_status FROM units WHERE id=$1", [unit.id])).rows[0].commercial_status, "pre_reserved");

    async function contract(type: "rs" | "sbk" | "ks") {
      const payment = type === "ks" ? [null, null, null] : ["fixed", type === "rs" ? 250000 : 1000000, new Date(Date.now() + 7 * 86400000).toISOString()];
      const created = (await db.query<{contract_id: string; version_id: string; payment_obligation_id: string | null}>(
        "SELECT * FROM app.create_contract_with_payment($1,$2,$3,$4,$5,$6,NULL,$7,$8,$9,$10)",
        [ids.tenantId, hold.sales_case_id, type, `${type.toUpperCase()}-JOURNEY`, `Test ${type.toUpperCase()}`, ids.membershipId, `journey-${type}`, ...payment],
      )).rows[0];
      for (const status of ["sent", "approved"]) {
        await db.query("SELECT app.transition_contract_status($1,$2,$3,'Testovací workflow',$4)", [ids.tenantId, created.contract_id, status, ids.membershipId]);
      }
      await db.query("SELECT * FROM app.sign_contract_externally($1,$2,$3,now(),$4,NULL)", [ids.tenantId, created.contract_id, created.version_id, ids.membershipId]);
      return created;
    }

    const rs = await contract("rs");
    assert.equal((await db.query<{commercial_status: string}>("SELECT commercial_status FROM units WHERE id=$1", [unit.id])).rows[0].commercial_status, "reserved");
    assert.equal((await db.query<{count: number}>("SELECT count(*)::int count FROM unit_holds WHERE id=$1 AND status='active'", [hold.hold_id])).rows[0].count, 0);
    assert.ok(rs.payment_obligation_id);
    const obligationId = rs.payment_obligation_id;
    await db.query("SELECT app.record_payment($1,$2,100000,now(),NULL,NULL,$3,NULL,$4)", [ids.tenantId, obligationId, "journey-partial-payment", ids.membershipId]);
    await db.query("SELECT app.record_payment($1,$2,150000,now(),NULL,NULL,$3,NULL,$4)", [ids.tenantId, obligationId, "journey-final-payment", ids.membershipId]);
    assert.equal((await db.query<{paid: number}>("SELECT COALESCE(sum(amount),0)::int paid FROM payment_allocations WHERE tenant_id=$1 AND obligation_id=$2", [ids.tenantId, obligationId])).rows[0].paid, 250000);

    const sbk = await contract("sbk");
    assert.equal((await db.query<{commercial_status: string}>("SELECT commercial_status FROM units WHERE id=$1", [unit.id])).rows[0].commercial_status, "contracted");
    assert.ok(sbk.payment_obligation_id);
    await contract("ks");
    assert.equal((await db.query<{commercial_status: string}>("SELECT commercial_status FROM units WHERE id=$1", [unit.id])).rows[0].commercial_status, "sold");
    const handover = (await db.query<{id: string}>("SELECT app.schedule_unit_handover_v2($1,$2,now()+interval '14 days',$3,'Jednotka',NULL,'journey-handover',$3) id", [ids.tenantId, unit.id, ids.membershipId])).rows[0].id;
    assert.equal((await db.query<{commercial_status: string}>("SELECT commercial_status FROM units WHERE id=$1", [unit.id])).rows[0].commercial_status, "sold", "plánování ještě neznamená předání");
    await db.query("SELECT app.update_unit_handover_v2($1,$2,now()+interval '14 days',$3,'handed_over',100,NULL,'Jednotka',NULL,now(),$3)", [ids.tenantId, handover, ids.membershipId]);
    assert.equal((await db.query<{commercial_status: string}>("SELECT commercial_status FROM units WHERE id=$1", [unit.id])).rows[0].commercial_status, "handed_over");
    assert.equal((await db.query<{current_stage: string}>("SELECT current_stage FROM sales_cases WHERE id=$1", [hold.sales_case_id])).rows[0].current_stage, "handover");
    assert.equal((await db.query<{count: number}>("SELECT count(*)::int count FROM audit_log WHERE tenant_id=$1 AND entity_id=$2", [ids.tenantId, handover])).rows[0].count > 0, true);
  } finally { await db.close(); }
});

test("FÁZE 1: alternativní smluvní cesty RS → KS, SBK → KS a přímá KS fungují doménově", async () => {
  const {db, ids} = await fixture();
  try {
    const units = (await db.query<{id:string;code:string}>(`SELECT unit.id,unit.code FROM units unit
      WHERE unit.tenant_id=$1 AND unit.commercial_status='available'
      AND NOT EXISTS (SELECT 1 FROM sales_cases candidate WHERE candidate.tenant_id=unit.tenant_id AND candidate.unit_id=unit.id AND candidate.status='active')
      ORDER BY unit.code LIMIT 3`, [ids.tenantId])).rows;
    assert.equal(units.length,3,"fixture musí mít tři volné jednotky pro izolované alternativní cesty");

    async function startCase(unit:{id:string;code:string},suffix:string){
      return (await db.query<{party_id:string;sales_case_id:string;hold_id:string}>(
        `SELECT * FROM app.create_party_and_unit_hold($1,$2,'pre_reservation',now()+interval '48 hours',$3,
          $4,'V jednání','individual',NULL,$5,$6,NULL,NULL,$7,NULL)`,
        [ids.tenantId,unit.id,ids.membershipId,`alt-${suffix}`,`Kupující`,suffix,`alt-${suffix}@example.test`],
      )).rows[0];
    }
    async function createAndSign(caseId:string,type:"rs"|"sbk"|"ks",suffix:string){
      const payment=type==="ks"?[null,null,null]:["fixed",type==="rs"?250000:1000000,new Date(Date.now()+7*86400000).toISOString()];
      const created=(await db.query<{contract_id:string;version_id:string}>(
        "SELECT * FROM app.create_contract_with_payment($1,$2,$3,$4,$5,$6,NULL,$7,$8,$9,$10)",
        [ids.tenantId,caseId,type,`${type.toUpperCase()}-ALT-${suffix}`,`Alternativní ${type.toUpperCase()}`,ids.membershipId,`alt-${suffix}-${type}`,...payment],
      )).rows[0];
      for(const status of ["sent","approved"])await db.query("SELECT app.transition_contract_status($1,$2,$3,'Alternativní cesta',$4)",[ids.tenantId,created.contract_id,status,ids.membershipId]);
      await db.query("SELECT * FROM app.sign_contract_externally($1,$2,$3,now(),$4,'Alternativní cesta')",[ids.tenantId,created.contract_id,created.version_id,ids.membershipId]);
      return created.contract_id;
    }

    const rsKs=await startCase(units[0],"rs-ks");
    await createAndSign(rsKs.sales_case_id,"rs","rs-ks");
    await createAndSign(rsKs.sales_case_id,"ks","rs-ks");
    assert.equal((await db.query<{commercial_status:string}>("SELECT commercial_status FROM units WHERE id=$1",[units[0].id])).rows[0].commercial_status,"sold");
    assert.equal((await db.query<{count:number}>("SELECT count(*)::int count FROM contracts WHERE sales_case_id=$1 AND contract_type='sbk'",[rsKs.sales_case_id])).rows[0].count,0);

    const sbkKs=await startCase(units[1],"sbk-ks");
    await createAndSign(sbkKs.sales_case_id,"sbk","sbk-ks");
    assert.equal((await db.query<{commercial_status:string}>("SELECT commercial_status FROM units WHERE id=$1",[units[1].id])).rows[0].commercial_status,"contracted");
    await createAndSign(sbkKs.sales_case_id,"ks","sbk-ks");
    assert.equal((await db.query<{commercial_status:string}>("SELECT commercial_status FROM units WHERE id=$1",[units[1].id])).rows[0].commercial_status,"sold");
    assert.equal((await db.query<{count:number}>("SELECT count(*)::int count FROM contracts WHERE sales_case_id=$1 AND contract_type='rs'",[sbkKs.sales_case_id])).rows[0].count,0);

    const directKs=await startCase(units[2],"direct-ks");
    await createAndSign(directKs.sales_case_id,"ks","direct-ks");
    assert.equal((await db.query<{commercial_status:string}>("SELECT commercial_status FROM units WHERE id=$1",[units[2].id])).rows[0].commercial_status,"sold");
    assert.deepEqual((await db.query<{contract_type:string}>("SELECT contract_type FROM contracts WHERE sales_case_id=$1 ORDER BY created_at",[directKs.sales_case_id])).rows.map(row=>row.contract_type),["ks"]);

    for(const current of [rsKs.sales_case_id,sbkKs.sales_case_id,directKs.sales_case_id]){
      assert.equal((await db.query<{current_stage:string}>("SELECT current_stage FROM sales_cases WHERE id=$1",[current])).rows[0].current_stage,"ks");
      assert.ok((await db.query<{count:number}>(`SELECT count(*)::int count FROM audit_log audit
        JOIN contracts contract ON contract.tenant_id=audit.tenant_id AND contract.id=audit.entity_id
        WHERE audit.tenant_id=$1 AND contract.sales_case_id=$2 AND audit.action IN ('contract.created','contract.signed')`,[ids.tenantId,current])).rows[0].count>=2);
    }
  } finally { await db.close(); }
});

test("FÁZE 1: dokumenty lze auditovaně navázat na klientskou změnu, reklamaci a předání",async()=>{
  const {db,ids}=await fixture();
  try{
    const context=(await db.query<{project_id:string;unit_id:string;party_id:string}>(`SELECT unit.project_id,unit.id unit_id,link.party_id
      FROM units unit JOIN party_project_links link ON link.tenant_id=unit.tenant_id AND link.project_id=unit.project_id AND link.valid_to IS NULL
      WHERE unit.tenant_id=$1 AND unit.archived_at IS NULL ORDER BY unit.code,link.valid_from LIMIT 1`,[ids.tenantId])).rows[0];
    assert.ok(context);
    const changeId=(await db.query<{id:string}>(`SELECT app.create_client_change($1,$2,$3,$4,'Změna dispozice','Test vazby dokumentu','individual',NULL,'Dispozice',NULL,'CZK',current_date,current_date+30,$5) id`,[ids.tenantId,context.project_id,context.unit_id,context.party_id,ids.membershipId])).rows[0].id;
    const complaintId=(await db.query<{id:string}>(`SELECT app.create_complaint($1,$2,$3,$4,'Kontrola dveří','Test vazby reklamačního protokolu',NULL,current_date+14,'phase1-doc-complaint',$5) id`,[ids.tenantId,context.project_id,context.unit_id,context.party_id,ids.membershipId])).rows[0].id;
    const handoverId=(await db.query<{id:string}>(`SELECT app.schedule_unit_handover_v2($1,$2,now()+interval '30 days',$3,'Jednotka','Test vazby protokolu','phase1-doc-handover',$3) id`,[ids.tenantId,context.unit_id,ids.membershipId])).rows[0].id;
    const documentId=(await db.query<{id:string}>(`SELECT app.create_document_metadata($1,$2,'Protokol testu','project_documentation','application/pdf',1234,'external',NULL,NULL,NULL,NULL,'normal',$3,'import') id`,[ids.tenantId,context.project_id,ids.membershipId])).rows[0].id;

    const changeLink=(await db.query<{id:string}>("SELECT app.link_document_to_client_change($1,$2,$3,$4) id",[ids.tenantId,documentId,changeId,ids.membershipId])).rows[0].id;
    const complaintLink=(await db.query<{id:string}>("SELECT app.link_document_to_complaint($1,$2,$3,$4) id",[ids.tenantId,documentId,complaintId,ids.membershipId])).rows[0].id;
    const handoverLink=(await db.query<{id:string}>("SELECT app.link_document_to_handover($1,$2,$3,$4) id",[ids.tenantId,documentId,handoverId,ids.membershipId])).rows[0].id;
    assert.equal((await db.query<{id:string}>("SELECT app.link_document_to_client_change($1,$2,$3,$4) id",[ids.tenantId,documentId,changeId,ids.membershipId])).rows[0].id,changeLink,"opakování vazby musí být idempotentní");
    assert.deepEqual((await db.query<{client_changes:number;complaints:number;handovers:number}>(`SELECT
      (SELECT count(*)::int FROM client_change_documents WHERE document_id=$1) client_changes,
      (SELECT count(*)::int FROM complaint_documents WHERE document_id=$1) complaints,
      (SELECT count(*)::int FROM handover_documents WHERE document_id=$1) handovers`,[documentId])).rows[0],{client_changes:1,complaints:1,handovers:1});
    assert.ok(changeLink&&complaintLink&&handoverLink);
    assert.equal((await db.query<{count:number}>("SELECT count(*)::int count FROM document_events WHERE document_id=$1 AND event_type='linked'",[documentId])).rows[0].count,3);
    assert.equal((await db.query<{count:number}>("SELECT count(*)::int count FROM audit_log WHERE tenant_id=$1 AND entity_id=ANY($2::uuid[])",[ids.tenantId,[changeLink,complaintLink,handoverLink]])).rows[0].count,3);
    assert.equal((await db.query<{count:number}>("SELECT count(*)::int count FROM outbox_events WHERE tenant_id=$1 AND aggregate_id=$2 AND event_type='document.linked'",[ids.tenantId,documentId])).rows[0].count,3);
  }finally{await db.close();}
});

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

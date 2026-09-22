import assert from "node:assert/strict";
import {readFile, readdir} from "node:fs/promises";
import test from "node:test";
import {PGlite} from "@electric-sql/pglite";
import {bootstrapIds, bootstrapPilotWorkspace, normalizeBootstrapInput} from "../src/iam/pilot-bootstrap.js";
import {importDejvice} from "../src/imports/dejvice.js";
import {ClientChangeRepository} from "../src/client-changes/repository.js";
import type {Database} from "../src/database.js";

test("klientská změna prochází řízeným schválením, uchovává historii a neopakuje události", async () => {
  const db = new PGlite();
  try {
    const directory = new URL("../migrations/", import.meta.url);
    for (const name of (await readdir(directory)).filter(name => /^\d+.*\.sql$/.test(name)).sort()) {
      await db.exec(await readFile(new URL(name, directory), "utf8"));
    }
    const normalized = normalizeBootstrapInput({entraTenantId:"10000000-0000-4000-8000-000000000062", adminOid:"20000000-0000-4000-8000-000000000062", adminEmail:"changes@example.test", adminName:"Test Admin", workspaceName:"Client changes fixture", workspaceId:"30000000-0000-4000-8000-000000000062"});
    const ids = bootstrapIds(normalized);
    const client = {query: async (sql:string, parameters?:unknown[]) => {
      if (!parameters && sql.includes(";")) { await db.exec(sql); return {rows:[], rowCount:null}; }
      const result = await db.query(sql, parameters as never[] | undefined);
      return {rows:result.rows, rowCount:result.affectedRows ?? null};
    }} as never;
    await bootstrapPilotWorkspace(client, {...normalized, ...ids});
    await importDejvice(client, await readFile(new URL("../seeds/0004_pilot_rezidence_dejvice.sql", import.meta.url), "utf8"), {tenantId:ids.tenantId, membershipId:ids.membershipId, dryRun:false});
    await db.exec(`SET ROLE develocrm_app; SELECT set_config('app.tenant_id','${ids.tenantId}',false); SELECT set_config('app.user_id','${ids.userId}',false);`);
    const context = (await db.query<{project_id:string;unit_id:string;party_id:string}>("SELECT unit.project_id,unit.id unit_id,link.party_id FROM units unit JOIN party_project_links link ON link.tenant_id=unit.tenant_id AND link.project_id=unit.project_id AND link.valid_to IS NULL WHERE unit.tenant_id=$1 ORDER BY unit.code LIMIT 1", [ids.tenantId])).rows[0];
    const created = (await db.query<{id:string}>("SELECT app.create_client_change($1,$2,$3,$4,'Výběr povrchu','','individual','','Povrchy',NULL,'CZK',current_date,NULL,$5) id", [ids.tenantId,context.project_id,context.unit_id,context.party_id,ids.membershipId])).rows[0].id;
    const adapter = {withContext: async <T>(scope:{tenantId:string;userId:string}, work:(client:{query:(sql:string, params?:unknown[])=>Promise<unknown>})=>Promise<T>) => {
      await db.exec(`SELECT set_config('app.tenant_id','${scope.tenantId}',false); SELECT set_config('app.user_id','${scope.userId}',false);`);
      return work({query:async(sql:string, params?:unknown[])=>{const result=await db.query(sql,params as never[]|undefined);return {rows:result.rows,rowCount:result.affectedRows??result.rows.length};}});
    }} as unknown as Database;
    const repository = new ClientChangeRepository(adapter);
    const input = {tenantId:ids.tenantId,userId:ids.userId,membershipId:ids.membershipId,changeId:created};
    assert.equal((await repository.transition({...input,status:"pricing"})).history.length,1);
    assert.equal((await repository.transition({...input,status:"pending_approval"})).history.length,2);
    await assert.rejects(repository.transition({...input,status:"rejected"}),/reason required/);
    const rejected = await repository.transition({...input,status:"rejected",note:"Zamítnuto klientem"});
    assert.equal(rejected.status,"rejected");
    assert.equal(rejected.history[0].note,"Zamítnuto klientem");
    await repository.transition({...input,status:"rejected",note:"Opakovaný požadavek"});
    assert.equal((await db.query<{count:number}>("SELECT count(*)::int count FROM client_change_events WHERE change_id=$1",[created])).rows[0].count,3);
    assert.equal((await db.query<{count:number}>("SELECT count(*)::int count FROM audit_log WHERE entity_id=$1 AND action='client_change.status_changed'",[created])).rows[0].count,3);
    assert.equal((await db.query<{count:number}>("SELECT count(*)::int count FROM outbox_events WHERE aggregate_id=$1 AND event_type='client_change.status_changed.v1'",[created])).rows[0].count,3);
    await assert.rejects(repository.transition({...input,status:"approved"}),/invalid client change transition/);
  } finally { await db.close(); }
});

import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=path=>readFile(new URL(`../${path}`,import.meta.url),"utf8");

test("předání používá jediný aktivní stav a append-only historii přesunů",async()=>{
  const migration=await read("backend/migrations/0036_handover_status_and_history.sql");
  assert.match(migration,/CHECK\(status IN \('planned','handed_over','cancelled'\)\)/);
  assert.match(migration,/CREATE TABLE unit_handover_events/);
  assert.match(migration,/event_type IN \('planned','rescheduled','handed_over','cancelled'\)/);
  assert.match(migration,/OLD\.scheduled_at IS DISTINCT FROM NEW\.scheduled_at/);
  assert.match(migration,/VALUES\(NEW\.tenant_id,NEW\.project_id,NEW\.id,'rescheduled'/);
  assert.match(migration,/v_target_status:=CASE WHEN p_status='rescheduled' THEN 'planned'/);
  assert.match(migration,/WHERE status='planned'/);
});

test("dokončení předání řídí stav jednotky a sales workflow",async()=>{
  const migration=await read("backend/migrations/0036_handover_status_and_history.sql");
  assert.match(migration,/v_target_status='handed_over'/);
  assert.match(migration,/commercial_status='handed_over'/);
  assert.match(migration,/app\.record_sales_stage\(p_tenant,row_before\.sales_case_id,'handover'/);
  assert.match(migration,/unit\.commercial_status_changed\.v1/);
  assert.match(migration,/handover\.handed_over/);
});

test("UI má čtyři české stavy, jednu akci a přehled historie",async()=>{
  const app=await read("app/CRMApp.tsx");
  const styles=await read("app/globals.css");
  assert.match(app,/planned:"Naplánováno",rescheduled:"Přesunuto",handed_over:"Předáno",cancelled:"Zrušeno"/);
  assert.doesNotMatch(app,/Upravit termín/);
  assert.match(app,/Otevřít předání/);
  assert.match(app,/Historie předání/);
  assert.match(app,/type="date"/);
  assert.match(app,/type="time" step="60"/);
  assert.doesNotMatch(app,/<option value="ready">Připraveno<\/option>/);
  assert.doesNotMatch(app,/<option value="in_progress">Probíhá<\/option>/);
  assert.match(styles,/handover-status-select\.blue/);
  assert.match(styles,/handover-status-select\.warning/);
  assert.match(styles,/handover-status-select\.success/);
  assert.match(styles,/handover-status-select\.danger/);
});

test("backend vrací historii bez N+1 dotazů",async()=>{
  const repository=await read("backend/src/handovers/repository.ts");
  assert.match(repository,/LEFT JOIN LATERAL\(SELECT jsonb_agg\(jsonb_build_object\('id',event\.id/);
  assert.match(repository,/FROM unit_handover_events event/);
  assert.match(repository,/ORDER BY event\.recorded_at DESC,event\.id DESC/);
});

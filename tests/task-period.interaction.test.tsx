import assert from "node:assert/strict";
import test from "node:test";
import {matchesTaskPeriod} from "../app/lib/task-period";

test("pohledy úkolů používají český kalendář a rozlišují dnešek a prodlení", () => {
  const monday = new Date("2026-09-21T08:00:00Z");
  assert.equal(matchesTaskPeriod("2026-09-20T21:59:00Z", "overdue", monday), true);
  assert.equal(matchesTaskPeriod("2026-09-20T22:01:00Z", "today", monday), true);
  assert.equal(matchesTaskPeriod("2026-09-21T22:01:00Z", "today", monday), false);
  assert.equal(matchesTaskPeriod(null, "today", monday), false);
  assert.equal(matchesTaskPeriod("not-a-date", "overdue", monday), false);
});

test("tento týden má hranice pondělí–neděle v Europe/Prague i při přechodu času", () => {
  const sunday = new Date("2026-10-25T12:00:00Z");
  assert.equal(matchesTaskPeriod("2026-10-18T21:59:00Z", "week", sunday), false);
  assert.equal(matchesTaskPeriod("2026-10-18T22:01:00Z", "week", sunday), true);
  assert.equal(matchesTaskPeriod("2026-10-25T23:01:00Z", "week", sunday), false);
});

# Sales hold retry safety

## Reproduced defect

A transport regression test on the unmodified repository supplied one stable
operation key, simulated a lost first response, and retried. The repository
ignored that key and generated a different UUID for each attempt. The test
failed against the original implementation.

For a new party there was a second obstacle: repeating the preflight after an
unknown first outcome can find the party just created by that same request.
That would prevent reaching the backend's existing atomic replay operation.

## Changes

- Sales modal pins one key to the submitted normalized command context: unit,
  operation, selected buyer/new-party draft, expiry and reason. No sensitive
  fingerprint is logged or persisted outside component memory.
- Identical retries retain the key and completed preflight. A changed command
  gets a new key and a fresh preflight.
- Transport failures keep the outcome uncertain and show a safe Czech retry
  message. Known rejected 4xx responses reset preflight, so a genuine conflict
  can show new duplicate candidates on retry.
- Hold creation and the existing conversion repository now require and forward
  the caller key instead of replacing it. No server authorization is skipped;
  the existing SQL operation remains decisive for creation and replay.
- Duplicate preflight is explicitly read-only for UI invalidation, despite
  using HTTP POST. It no longer broadcasts a workspace data mutation.
- No backend code, migration, legal template or business-rule change.

## Evidence

- Originally failing repository test now passes with both request bodies using
  the exact caller key.
- Full modal/repository transport test loses the first response, then verifies
  successful replay completion, identical payload/key, one preflight and no
  false duplicate blocking. It asserts completed success, not only send count.
- Tests cover changed input/new key, known-conflict preflight recheck and no
  workspace mutation event for duplicate checking.
- Frontend typecheck, lint and production build passed.
- 166 interaction tests and 143 static regressions passed, no failures/skips.
- Six existing backend party/hold/integrity tests passed, including atomic
  new-party hold retry retaining one canonical party and original hold ID.
  This is not a new native PostgreSQL concurrency verification.

## Scope limits and follow-up audit

Network loss is controlled in automated transport tests, not forcibly injected
into the user's production browser. A normal authenticated synthetic browser
smoke follows publication. No actual customer or signed agreement is modified.

This fixes in-modal hold retry, not durable recovery after closing the browser,
and not independent interest-event retry. Existing backend replay keys should
also receive a separate audit of request/unit/payload binding; this frontend
package does not claim to harden arbitrary hand-crafted API requests.

## Published verification — 27 October 2026

- GitHub source: `89810532a620927568959be9222dafe0d007d116`.
- Sites source: `cce5262e6627a1d456213ce54c37d42793617fd5`.
  Both Git trees equal `e160d2cd8b3b1118ea2b31d92ec901785fabdf37`.
- Sites version 173, deployment
  `appgdep_6ae04975551881918c84d25113f03068`: succeeded; existing
  owner-only private audience preserved.
- Backend unchanged; no migration. Live `/health` and `/ready`: HTTP 200.
- Authenticated UI created only synthetic unit 7404 in the existing TECH74
  project (`cd3605bd-9ef7-461b-b3f2-54f0447fff60`). Grouped price
  `5 100 000` persisted as CZK 5,100,000.
- Unit UUID: `4df7bf89-5374-4fa3-b529-90f7355597ee`.
- The unit's standard sales modal created a new clearly synthetic client and
  pre-reservation. It closed successfully and showed the buyer, current
  negotiation stage, expiry 29 October 2026 07:50 Europe/Prague and activity.
  All remained present after a full page reload. No actual customer's record,
  agreement, payment or existing hold was changed in this smoke test.
- Lost-response replay remains proven by the controlled automated transport
  test, not by artificially disrupting the live pilot network.
- Screenshot was inspected inline. Saving its file was denied by the current
  filesystem sandbox; no screenshot file is claimed as a delivered artifact.

## Next evidence-based safety audit

Read-only review confirms that migration 0025's new-party hold wrapper and
migration 0056's hold creation query replay by tenant/key without explicitly
comparing the requested unit or payload. This is not changed by this package.
Before claiming arbitrary API-request retry safety, add an adversarial test
for reused keys across units and changed requests and inspect later migrations
for replacement definitions. Do not infer authorization bypass or a particular
runtime impact solely from these older SQL definitions.

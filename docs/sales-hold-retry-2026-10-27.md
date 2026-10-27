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

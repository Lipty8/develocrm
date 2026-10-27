# Hold request replay binding — 27 October 2026

## Reproduction

The original tenant/key lookup in migrations 0025 and 0056 returned an existing
hold even when the caller requested a different unit. A new regression test
failed with `Missing expected rejection` before the correction. This was a
wrong-result/command-context defect; the finding does not establish a bypass
of the independent HTTP project permission checks.

## Minimal correction

Additive migration 0074 extends the existing `unit_holds` model with:

- `creation_request_hash`: SHA-256 of the exact command context, including
  tenant, unit, operation kind, actor, participants/new-party input, expiry,
  reason, optional interest and idempotency key.
- `creation_party_id`: original canonical party created by the atomic new-party
  operation, with a tenant-qualified foreign key. A retry must not return a
  different current primary buyer after later changes to the sales case.

Only a fingerprint, not a second copy of contact/identity request data, is
stored. Absolute timestamps are hashed as epoch values, independent of session
timezone. Command kinds cannot impersonate one another.

The existing create operations retain unit-first locking, authorization,
transaction boundaries, audit/outbox and duplicate checks. Exact retries return
the original IDs without creating entities/events. A mismatched request fails
with a safe 409 message and correlation ID. Replay of a completed creation may
return its historical result after cancellation; it never reactivates the hold.

Legacy rows are not backfilled with guessed request data. If an old key is
retried without evidence of the exact payload, it fails closed and asks the
user to reload the unit. No historical contract, payment, unit status or party
is rewritten. Administrative manual conversion remains unchanged and cannot
create a reservation without a signed RS.

## Verification

- Originally red cross-unit new-party regression now passes.
- New PGlite and native PostgreSQL tests execute under `develocrm_app` with the
  current project access matrix, not a legacy project role fixture.
- Exact retry; changed unit/project/identity/party/expiry/reason; operation-kind
  collision; legacy key; cancellation followed by replay; missing key; foreign
  tenant; restricted project; changed actor; suspended membership.
- Native PostgreSQL proves that an identical concurrent request actually waits
  at the first transaction's unit lock, then returns the exact same IDs. One
  active hold, one creation audit and one outbox event remain.
- Concurrent requests for two different units with the same key produce one
  success, one rejection, one hold and one canonical party. No deadlock.
- Actual Fastify hold route returns 409 with safe Czech text and correlation
  ID for both replay conflicts and missing keys; repeated serialization stays
  safe. This HTTP test uses a controlled service error; database behavior is
  independently tested above.
- Full backend suite: 550 passed, zero failed/skipped, including native
  PostgreSQL suites. The subsequently added actual HTTP replay test also passed
  (13 public API error tests). Backend build, frontend typecheck and lint passed.

## Deployment status

Implementation and isolated verification complete. Pilot migration/deployment
and authenticated post-deployment smoke are not yet claimed. Frontend source is
unchanged; Sites 173 remains the matching UI. Real pilot business data have not
been modified for this package.

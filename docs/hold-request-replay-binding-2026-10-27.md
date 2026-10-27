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

Runtime source `c25377a2a3f3b17cffc548782258c4191351c714` was pushed to the
private GitHub main. Frontend source is unchanged; Sites 173 remains the matching
UI without an unnecessary frontend deployment.

- Sanitized build context: 160 allowlisted committed files, about 424.8 KiB
  compressed. No legal DOCX/PDF, attachments, local runtime data or secrets.
- ACR `cg57` / `cg58`: Succeeded.
- API digest: `sha256:1ae50bd0a41b4c38c4403697079ca6ba314c972d82debcfc3542e7cb7519c7fb`.
- Migration digest: `sha256:8fa446aa04d5e34c65b425c4960cafd70476b4d60436e8c3e5d62d46322f9b0a`.
- Read-only preflight `caj-develocrm-migrations-pilot-ws244e1`: Succeeded,
  checksums for all 73 applied migrations match, only 0074 pending.
- Initial execution `caj-develocrm-migrations-pilot-c8lkbhf` failed before any
  database connection: Azure CLI image-only execution override dropped the
  inherited env. Execution metadata confirmed env=null and logs reported the
  missing `DATABASE_URL`. No backend was switched at this point.
- Corrected one-execution definition explicitly retained the existing
  `DATABASE_URL` → `database-admin-url` secretRef; no secret value was read or
  changed. `caj-develocrm-migrations-pilot-3okzyhs`: Succeeded, applied only 0074.
- Read-only postflight `caj-develocrm-migrations-pilot-hfgzi8i`: Succeeded,
  74 matching checksums, no pending migration, replay guard installed.
- Revision `ca-develocrm-api-pilot--hold-replay-c25377a`: Healthy, Running,
  Provisioned; latestReady matches, 100% traffic. Health and ready HTTP 200.
- Authenticated browser created only new synthetic unit 7405 and a synthetic
  buyer/pre-reservation in the owned TECH74 project. Unit UUID:
  `b4f8da2f-9770-41ed-a6c7-41a3d52a2ed0`. Buyer, expiry 29 October 2026 09:53
  Europe/Prague, CZK 5,100,000 price, stage and activity survived a full reload.
- Pilot replay verification `caj-develocrm-migrations-pilot-coucgx6`: Succeeded.
  Under the regular application role and explicit tenant/user context, two
  identical calls returned the original hold/case/party IDs; changed unit and
  identity were rejected. Audit and outbox counts stayed unchanged. The entire
  verification transaction was rolled back; no extra hold or party persisted.
- Bounded new-revision log window: 188 rows, zero HTTP 5xx, RLS violations or
  error-level entries. This is observed evidence, not a future-error guarantee.
- Frontend production build, 166 interaction tests and 143 static regressions
  also passed. Existing production bundle-size warning remains; no new failure.

No real customer, historical agreement, payment, signed document or existing
hold was changed. Only the new isolated technical fixture above was created.
Native local PostgreSQL test cluster was stopped after verification. Browser
proof was inspected, but screenshot file persistence was denied by the browser
sandbox even after a primary-filesystem permission grant; no saved image file
is claimed.

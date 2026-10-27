# RS/SBK durable generation recovery

## Verified gap

The open-panel retry correction (Sites 176) keeps the operation key in memory.
After browser closure that key is lost. Existing generation operations preserve
the render snapshot, but not all hash-bearing inputs (notably document ID/name
and appendix request). Rebuilding a retry from changed CRM data can therefore
reject its request hash. The existing pending-operation guard correctly blocks
blind creation of another operation; it must not be removed.

## Minimal extension of the existing pipeline

- Migration 0076 adds nullable immutable `request_context` to the existing
  generation operation. No historical backfill and no second job/document model.
- The server serializes its exact original generation request. Text intentionally
  preserves JSON key order because the existing request hash is SHA-256 over
  `JSON.stringify`, whereas PostgreSQL jsonb would reorder snapshot keys.
  Existing hash behavior is unchanged and round-trip compatibility is tested.
- The stored envelope contains no token or actor credentials. It includes only
  the business render inputs already used by generation; it remains inside the
  tenant-scoped database and is never returned to the frontend.
- A read-only lookup requires the same tenant, contract/project/unit/case
  relations, active sales case, nonarchived project, original creating membership,
  `contract.manage` and `documents.upload`. Only explicit reserved operations or
  completed-but-unbound operations are eligible.
- The lookup verifies the hash of the exact persisted request and checks its
  business identifiers against DB columns. Resume supplies current authenticated
  identity explicitly and takes each business field only from the verified
  envelope. It never merges arbitrary current request data over that envelope.
- The existing generator/upload service performs the replay. Template approval,
  version/hash validation, upload permissions, reservation/idempotency checks and
  contract-version binding invariants remain in force. Completed uploads use the
  existing completed-generation binding path and are not rendered again.
- Readiness exposes only a scoped operation key and recoverability flag. A newly
  opened panel offers `Ověřit předchozí generování`, even if current CRM data is
  no longer ready for a *new* document. A later deliberate new version still uses
  current authorized CRM facts and a new key.
- Legacy reserved operations without an envelope stay blocked for individual
  administrative review. Another user's pending operation is not disclosed or
  taken over. Recovery does not approve or sign any document.

## Verification / rollout status

Targeted synthetic tests passed on PGlite and native PostgreSQL, including Graph
interruption after reservation, changed buyer data, new service instance,
immutable request, other tenant/membership/contract rejection and exact snapshot
binding. Component tests cover newly mounted recovery and blocked legacy records.
Full local verification: 563 backend tests passed with native PostgreSQL enabled,
zero skipped; 183 frontend interaction tests and 143 static regressions passed.
Backend build, frontend typecheck, lint and production build passed. An additional
3-test request-envelope/integrity run also passed. The persistence scenario also
simulated a binding failure after upload: reopening readiness discovered the
completed-but-unbound operation, and retry bound it without another physical file.
Coordinated pilot rollout is recorded below. No real pilot business data has
been changed by this package.

## Pilot rollout evidence

- Code commit: `3e78f1e822e74ae46accb6d49e2594431d299866`, pushed to GitHub.
- Sanitized ACR context excluded Git metadata, secrets/environment files,
  legal originals, uploads and pilot data. Builds `cg5b` (API), `cg5c`
  (migrations) both succeeded.
- API digest: `sha256:4ab8686c14867f1da1e363dcfdad518165a3719f3f058688e523b9e9b6e0264c`.
- Migration digest: `sha256:a262c8ca76a045d992ddef15a53f72b4f74ef1bf1b1c5ec264ee371e31af1ddd`.
- Read-only preflight `caj-develocrm-migrations-pilot-xtbr5pl`: Succeeded;
  75 matching migration checksums and only 0076 pending.
- Dedicated migration execution `caj-develocrm-migrations-pilot-wdq2uz4`:
  Succeeded, applied only `0076_generation_request_recovery.sql`, using the
  existing admin secret reference (no secret extraction/runtime migration).
- Read-only postflight `caj-develocrm-migrations-pilot-ghwcd6x`: Succeeded;
  76 matching migration checksums, no pending migrations, immutable request
  column/trigger verified.
- Matching Sites source `6b71c5fc2a7fce0a7cf585fdf5e42021c2050b9f`, Git tree
  `16c8c84fcb48ca4a9e87a4ce1a3271d9175696a1` equals the code commit's tree.
  Archive built through the official helper; publication started only after
  backend health/latestReady checks passed.
- Backend revision `ca-develocrm-api-pilot--gen-recover-3e78f1e`:
  Healthy / Running / Provisioned, latestReady; existing Liveness/Readiness
  probes and latest-revision 100% traffic retained. Health and ready both 200.
  A bounded 100-record new-revision console sample had zero matching
  5xx/RLS/unhandled/startup-error signals (not a full historical-log assertion).
- Private Sites 177, deployment `appgdep_6ae0e66ed10881918da45040013086d2`:
  succeeded. Owner-only access remained unchanged.
- Authenticated read-only browser smoke after publication/reload: technical RS
  7403 displayed its correct preparation context and missing requirements, did
  not offer generation for incomplete data, and its explicit readiness check
  entered the expected loading state and completed successfully. Existing signed
  TECH74 SBK retained its signed v1, original evidence timestamp, exact filename
  and version download action. No generation/signature/payment command was
  submitted. Browser console sample had zero captured error entries.
- Controlled interruption + changed-data + reopened-service recovery was tested
  using real local PostgreSQL and mocked Graph, plus the actual React panel.
  No production outage was forced; do not describe this as a forced-failure
  live Graph/browser write E2E.

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
Coordinated pilot migration/backend/frontend rollout remains pending. No real
pilot data has been changed by this package.

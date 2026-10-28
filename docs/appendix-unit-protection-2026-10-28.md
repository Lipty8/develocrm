# Appendix applicability: approved database protection

Adam explicitly approved the extended guard and tested pilot deployment on 28 October. This resolves the earlier safety-review stop; it is not permission to repair historical business records.

## Invariant and model

Reuse `unit_documents`, `contract_documents`, exact versions and existing workflow locks. A project document without unit associations remains shared. A document with unit associations is eligible only when the contract's exact unit UUID is among them. Display codes and filenames are not identity.

Migration 0080 adds validation on classified appendix selection, freezes association changes while any classified appendix uses that document, and validates existing bundles again at generation reservation/completion, final document binding and signature. An editable draft can remove its selection before changing applicability. Immutable/signed associations remain protected. No existing row is changed or deleted.

The central existing snapshot retains permissions, native version/hash, tenant/project and bundle checks. New locking helpers use the same checked tenant/active membership/project permissions; no table privileges or role mappings are broadened. Existing generation, upload, audit and outbox services are retained.

## Concurrency

Selection/generation: unit lock, then ordered document locks. Unit association changes take only ordered document locks and never then acquire unit locks. A fresh statement after lock waiting rechecks committed applicability. Idempotent ON CONFLICT link replay does not change applicability. No separate workflow engine or new document model.

Native PostgreSQL tests prove actual lock waiting in both operation orders: selector wins -> association change rejects; restriction wins -> foreign-unit selection rejects. They assert one successful selection/audit/outbox pair or none, without deadlocks or lock timeouts. Additional tests reject INSERT/UPDATE/DELETE association changes during use and permit a legitimate later edit after removing an editable draft selection.

Disposable-fixture corruption tests verify previously invalid associations reject generation, final binding and signature. Each injected inconsistency and trigger state rolls back; no signature or generation operation remains. This fault injection is test-only, never a pilot procedure.

## Checks before rollout

- Appendix suite: 23 passed across PGlite and native PostgreSQL, no skips.
- Full backend suite: 496 passed, 10 environment-dependent skips, zero failures. The original red foreign-unit regression is now included, not filtered.
- Frontend interaction suite: 199 passed. Backend build, frontend typecheck and lint passed.
- New domain errors retain safe Czech explanations and correlation ID; no raw SQL to users.

Matching image builds, migration preflight/application, backend/frontend publication and live checks are pending. No pilot deployment success is claimed by this preparation record.

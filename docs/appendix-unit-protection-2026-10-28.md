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

## Matching rollout

- GitHub source `8d34cbdd2d0271cdb9c9934bd7df2e0e5a7411fe`, pushed main.
- API ACR `cg5p` and migration ACR `cg5q`: Succeeded.
- API digest `sha256:c98cc7d82450e4fd482d3255f6ea4082f7899445af8d0d9224ba3d0746cc77ff`.
- Migration digest `sha256:733750dd78c7a559d583a8ba1a94c3c09810bb376689b25c5d6260f3e2cd7e1e`.
- Read-only preflight `caj-develocrm-migrations-pilot-8ykw78e`: Succeeded, 79 matching checksums, only 0080 pending.
- Migration `caj-develocrm-migrations-pilot-xggo70t`: Succeeded, applied only 0080.
- Read-only postflight `caj-develocrm-migrations-pilot-3lsjsmz`: Succeeded, 80 matching checksums, no pending migration, all three new triggers enabled and central snapshot recheck present.
- Backend `ca-develocrm-api-pilot--appendix-unit-8d34cbd`: Healthy/Running, latestReady equals latest, 100% latest traffic, health/ready both 200 after cutover.
- Private Sites 185, source `d5b93a8de9bca6023ae142869390b3394e4a5c9e`, exact Git tree match `6dcfb0c32dd3b8aebde3d7d0495a97a6b304e08b` against GitHub source. Official build/package succeeded.
- Native deployment `appgdep_6ae2668f976881918807e91724a865c7`: succeeded, archive-backed. Owner-only audience retained (one owner, no groups or external visitors).
- Bounded post-deploy console sample: 68 records, zero matched startup/5xx/RLS error signals; not a claim about all logs.
- Additional targeted price/document and API error regression: 62 passed, zero skips. Production frontend build passed.

## Live verification and limits

Read-only technical RS/SBK verification `job-develocrm-hold-expiry-sfb4k12`: Succeeded on the new matching image. Both exact signed SharePoint document hashes match; original RS v2 and SBK v1 remain pinned; one SBK installment of 1,100,000 CZK due 3 November, next action KS and signature audit remain consistent. No signatures, payments or files were created by this verifier.

Browser: refreshed ordinary Entra sign-in using the already signed-in business account; no new consent/access. Existing technical RS 7403 loaded as a closed sales case and correctly hid progression/signature/preparation actions. It is no longer an editable appendix-picker fixture, so it cannot prove the new picker or live rejection flow. That specific new live scenario is still pending and must use fresh clearly marked technical records, not reopen the old case or mutate real pilot data.

### Completed live follow-up: TECH81

The pending live scenario above is now verified with a fresh case, not the old closed fixture. The explicit operator `backend/scripts/smoke-appendix-unit-scope.mjs` is restricted to unit 7481 in owned TECH74, validates actor/project audit ownership and the non-bypass application role. It has no signature, payment or legal-generation mode. Two small UTF-8 text artifacts are clearly labelled nonlegal; neither is represented as an actual catalogue or approved legal appendix. They remain as diagnostic evidence.

- Prepare `job-develocrm-hold-expiry-t0uzh35`: Succeeded; created the synthetic unit/buyer/pre-hold/draft RS via existing domain services in one transaction. Only the two new technical text files were uploaded through the existing SharePoint service. Zero signatures and obligations.
- Backend negative check `job-develocrm-hold-expiry-du2smgw`: Succeeded. The exact previously owned TECH80 document (scoped to unit 7480) was rejected for this case with `CONTRACT_APPENDIX_UNIT_MISMATCH`; before/after selection and audit counts were unchanged.
- Authenticated Sites 185 browser: the selector offered `TECH81 JEN BYT 7481` and `TECH81 SPOLEČNÝ TECHNICKÝ DOKUMENT` alongside unrestricted technical template sources. Foreign-unit files were absent. The user-facing UI saved exact `TECH81-v1` versions to positions 1 and 2. Both selections were displayed again after full reload. No signing or generation action was attempted.
- Verify `job-develocrm-hold-expiry-rsnlrv6`: Succeeded on backend `appendix-unit-8d34cbd`. It read back those exact browser selections, repeated the rejected foreign-unit assignment, rejected changing the used document's unit association with `CONTRACT_APPENDIX_UNIT_LINK_IN_USE`, and compared both physical SharePoint hashes against the known technical text. Final counts: two classified appendices, two selection audits, zero signatures, zero payment obligations.
- Technical contract: `f42091a1-5cbd-4f39-bbcd-8ef8618e3d6b`; version `031119df-3807-4b60-958f-805840b3cbba`; unit `d9f11670-f67d-4c2f-b78f-b51dfac50f34`.

The diagnostic operator passed Node syntax and changed-file lint. This follow-up adds only an operator and evidence; it changes no runtime application source, migration or deployed image. Sensitive storage paths/keys and tokens are not part of this report. The initial prepare output returned technical upload metadata; subsequent operator receipts deliberately return only CRM IDs, not storage URLs/keys.

No automatic historical repair, reclassification, signature or real business-data change was performed by this package. This is deployed protection with strong local/native PostgreSQL evidence, not a claim that every live negative path or first real RS is production-ready.

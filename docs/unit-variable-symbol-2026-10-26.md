# RS/SBK variable symbol — 2026-10-26

## Confirmed decision and defect

Adam confirmed that approved RS/SBK payment profiles must use the exact numeric
unit code. The live TECH74 original-profile RS exposed `74` (digits extracted
from contract reference `TECH74-RS-SYNTHETIC`) instead of unit `7401`.

## Correction

- Additive migration 0072 replaces only the canonical preparation calculation:
  tenant + project + unit UUID resolve `units.code`, preserving leading zeroes.
- Nonnumeric unit codes fail closed with a safe Czech validation message. No
  digit stripping, guessed reference fallback or request-supplied symbol.
- Explicit new business versions do not inherit an obsolete symbol. They
  require the existing payment preparation command before generation.
- Existing snapshots, documents, signatures, obligations and transactions are
  not backfilled or rewritten. No real historical deal is changed.
- Follow-up migration 0073 reopens preparation when an explicit new unsigned
  version is created. Previously the contract retained `approved` while its
  new working version could not prepare terms (`ACTIVE_DRAFT` required).
  The new version requires approval again, as already required after document
  regeneration. Signed parties and ended/signed contracts cannot use it.
- Existing authorization, locks, audit/outbox, signature anchors and installment
  calculations remain unchanged.

## Verification

Targeted PostgreSQL and PGlite integration tests cover exact unit symbol,
leading zeroes, reference without digits, idempotent preparation, invalid unit
code rollback, retained old document/snapshot, explicit corrected version,
and matching RS/SBK symbols. Full regression/deployment evidence follows after
execution; this document alone does not assert pilot verification.

## First deployment

Commit `abccc98216c08493af5a0344ce3cba016185235c` was pushed to GitHub.
ACR runs `cg53` (API) and `cg54` (migration) succeeded.
Migration execution `caj-develocrm-migrations-pilot-kxq8qy3` Succeeded:
preflight found only 0072 pending, verified all applied checksums, and postflight
confirmed exactly one added row (72 total) plus the new unit-code calculation.
The admin Key Vault reference was retained. No API runtime container ran DDL.

API revision `ca-develocrm-api-pilot--unit-vs-abccc98` is Healthy, Running,
Provisioned and has 100% traffic. `/health` and `/ready` both returned 200.
API digest: `sha256:8c04b476c796833d8ce1fd2ae3a4f478ca54307c8b10aa439be71b1e16bf557e`.
Migration digest: `sha256:af38222e347a9690d94a038cf7ee48507bb407ee976b03de54331ffae3979cf0`.
Frontend Sites 167 was unchanged: no frontend source change is required.
The complete pre-deployment backend suite passed 523 tests with zero skips;
lint, frontend typecheck and backend production TypeScript build passed.
The subsequent explicit-version reapproval correction is verified/deployed
separately before replacing TECH74's unsigned technical document.

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

## Final matching deployment and authenticated RS proof

- Runtime commit `f0a69345fe33041ebae28f5525dc78c25c9142fc`; ACR runs
  `cg55` / `cg56` succeeded. Migration execution
  `caj-develocrm-migrations-pilot-lekc5q8` Succeeded. Preflight found exactly
  0073 pending after 0072; postflight verified 73 applied migrations and the
  version reapproval guard. No historical records were backfilled.
- Active revision `ca-develocrm-api-pilot--unit-vs-f0a6934`: Healthy, Running,
  Provisioned, 100% traffic; health/ready both 200.
- API digest `sha256:51c7d64f2d083a9610302b9c76d71b9692233195afc3be77224cb71163b41ed1`;
  migration digest `sha256:ad99bb11c4e5934c3f637a6b7a2e0bb4d731821f06dd3120df6b6a292308bc82`.
  Sites 167 unchanged; these are backend/database changes only.
- Complete backend regression suite again passed 523 tests, zero skips.
  Frontend static tests 143, interaction tests 138, lint, typecheck and both
  production builds passed. The operator subsequently gained one exact-history
  regression (24 operator/launcher tests total, all passed) in commit `611ba26`.
- Authenticated browser created explicit TECH74 contract version 2 and verified
  return from approved to draft, missing-input readiness and ordinary payment
  preparation. The plan displayed exact unit symbol `7401` before generation.
- Existing isolated fixture preparation execution
  `job-develocrm-hold-expiry-1r8m1ox` Succeeded, restoring only technical signing
  dates and the six existing nonlegal appendix selections for the new version.
  Main RS generation was then invoked through the ordinary browser button.
- Generated contract version `61469f61-e713-4ca4-82a1-478d9b8dd843`, exact
  document version `00ec38be-4f55-4e26-b048-9d020f9c2b40`; both appeared after
  reload, including symbol `7401`. All four downloaded Word pages were rendered
  and visually inspected, with no clipping, unresolved fields or layout drift.
- Comparison with the preceding Word found exactly one changed paragraph:
  `symbolem 74` → `symbolem 7401`. Every other `word/` part was byte-identical;
  no legal wording was edited.
- Browser history retained v1 and v2. Downloading v1 again after replacement
  returned SHA-256 `af4cb14f1315504b8f3895facff2870c2cf687227fa55810086eb465bc1b0780`,
  identical to the pre-replacement download.
- Independent read-only execution `job-develocrm-hold-expiry-s51hamp` Succeeded:
  exact native SharePoint/template/snapshot hashes, deterministic Word-part
  reproduction, all six frozen appendix versions, one generation audit and one
  outbox for the new version. No duplicate main document was created.
- Observed new-revision log window after preparation: 276 rows, zero error-level
  entries, HTTP 5xx or RLS violations. This is bounded observed evidence, not
  a claim that no future error can occur.

Only the owned technical fixture was mutated. Real pilot contracts, payments,
units and approved source templates were unchanged. Signature and continuation
to SBK remain a separate pending human-confirmed technical E2E step.

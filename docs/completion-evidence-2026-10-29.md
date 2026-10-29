# Production readiness evidence, 29 October 2026

Status: **not complete**. Technical pipeline evidence does not prove a real
contract is ready. RS312 is now the explicitly selected real preparation case;
see `rs312-preparation-gap-2026-10-29.md`.

## Initial deployment used for inspection (historical checkpoint)

- Backend `ca-develocrm-api-pilot--appendix-unit-8d34cbd`.
- API digest `sha256:c98cc7d82450e4fd482d3255f6ea4082f7899445af8d0d9224ba3d0746cc77ff`.
- Private Sites 185, source Git tree identical to runtime source 8d34cbd.
- Eighty matching migrations through 0080, none pending at postflight.

## Read-only whole-workspace consistency run

Execution `job-develocrm-hold-expiry-ucpdrnc` Succeeded. Run ID
`29a0f864-587e-4c11-9022-0dfd61946314`.
Existing ConsistencyChecker covered 11 accessible projects and 20 defined
checks, returned complete=true and physicalEvidence=verified. Every database
transaction was forced read-only under the non-bypass application role and
existing permissions. SharePoint operations were read-only. No diagnostic
record, business mutation, archive or historical repair was written.

Results: **1 critical, 11 warnings, 8 legacy findings**. Not a clean audit.

- Critical RESERVED_WITHOUT_SIGNED_CONTRACT: TECH60-BLOCKED in TECH0060.
  Follow-up `job-develocrm-hold-expiry-ku9y4i8` Succeeded read-only. The
  technical case retains an active non-expiring reservation hold, cancelled
  previously signed RS and unsigned draft SBK. Earlier explicit TECH60 testing
  documented this preserved state under the old rule; this is not evidence of
  a newly failed termination. Do not automatically repair it or hide it from
  findings because its name looks technical. Historical reconciliation needs
  an explicit supported operation and verified preconditions.
- Four TEMPLATE_UPLOAD_HASH_DIFFERENT warnings: native physical evidence was
  verified, but earlier upload hash metadata differs. Do not silently overwrite
  old metadata or claim this discrepancy is resolved.
- Two PRICE_HISTORY_MISSING warnings on existing technical inventory. No
  unambiguous historic prices were inferred or backfilled.
- Five GENERATION_HASH_LEGACY_UNVERIFIABLE warnings remain unverified legacy
  generation evidence, not new valid exact signed evidence.
- Eight SIGNED_EVIDENCE_MISSING findings match the checker's reviewed legacy
  baseline. They remain exceptions to modern evidence requirements, not proof
  that every historical signature is compliant.

## Legal-source regression evidence

Pinned RS SHA-256:
`6d5265703063e33632450921cfeac1388a7004ec6483bf7149e4ee9f89b50886`.
Pinned SBK delivery-v2 SHA-256:
`2d320d0331e0c17f9d3e37c601420b54077da53f2e99eb0b2b0be0d51774af50`.
Both match the approved sources; no Word was changed in this pass.

legal-template-review, original-contract-snapshot, original-payment-plan and
sbk-business-pipeline: **59 passed, 0 failed, 0 skipped**, including real
PostgreSQL JSONB round-trip on the owned disposable local cluster. The cluster
was stopped after testing. This is automated preservation/mapper/calendar/
snapshot/retry evidence, not a new visual Word review or real buyer approval.

## Open requirements

- RS312 buyer fields, planned dates, remaining exact appendices and appropriate
  reviewed wording; known deferred accessory legal facts/files remain deferred.
- Live completed-handover client-change rejection remains unverified: earlier
  runtime test stopped before mutation because no owned completed technical
  handover fixture existed. Local/native tests passed; do not call that browser
  gate complete.
- Existing legacy consistency findings above remain visible and unmodified.

No SBK/KS legal changes, signing automation, refund rule changes or broad new
modules are justified by this report. Continue the existing domain architecture.

## Current deployment and completed follow-ups

Verified 29 October after the initial checkpoint:

- Backend `ca-develocrm-api-pilot--shared-17c0d49`, immutable API digest
  `sha256:29269b7b910f4562e69f85141721cbaf24d8d46d72e2b768ebbd75d577213d25`.
- Sites 187 remains compatible; no frontend source changed in the backend-only
  shared-appendix package. Latest runtime migration is 0081; its postflight
  verified exactly 81 applied migrations and every checksum.
- The explicit imported-RS preparation path is implemented, tested and live.
  Authorized RS312 preparation created working v2 with confirmed total
  CZK 15,350,000 and fee CZK 1,535,000 (10%). Version 1 remains historical.
- Signature-anchored payment terms use unit symbol 312. No actual payment,
  obligation or signature was manufactured to make the case appear ready.
- Exact approved catalogue, combined cellar/parking plan and standards now
  occupy positions 1/2/3/5. A real UI rejection of the shared PDF led to 0081;
  saving it in both positions now passes and survives reload without copying.
- 630 backend tests passed with zero skips/failures, including native PostgreSQL
  concurrency. Frontend regressions/interactions, typecheck, lint and production
  build passed. See the specific rollout reports for bounded runtime evidence.

## Fresh whole-workspace verification after 0081

Execution `job-develocrm-hold-expiry-lw9f2ed` **Succeeded**, run
`9518712c-410e-4b75-9434-97bf55289465`, receipt 29 October 12:19 UTC.
All transactions were forced read-only under the application role; exact
SharePoint versions were downloaded read-only and hashes checked.

Result: complete=true, **11 projects / 20 checks**, physicalEvidence=verified,
**1 critical / 11 warnings / 8 legacy**. Finding IDs/categories match the earlier
checkpoint: no new inconsistency was found by these defined checks. This is not
a claim that every possible product/security scenario has been verified.

Companion read-only assessment `job-develocrm-hold-expiry-vwhm8lq` Succeeded:
TECH60-BLOCKED still has an active case and a signature-created reservation,
one effectively cancelled previously signed RS, an unsigned SBK draft and one
preserved financial obligation. Neither contract currently blocks release;
the existing read-only assessment is eligible with no reasons. The persisted
historical blocked outcome was not replayed or rewritten, and the test case
was not repaired automatically. The same read found **zero** completed
handovers in the explicitly owned TECH74 context, so the outstanding live
post-handover negative test cannot be claimed as executed.

## Prioritized remaining work and decision boundaries

| Priority | Requirement | Current evidence / next action |
| --- | --- | --- |
| P0, case data | First real RS312 | Prices, plan and four appendices persisted. Buyer facts, dates, accessory rights, applicable reviewed variant and two deferred sources still block actual generation. Do not fill with dummy values. |
| P0, historical technical finding | TECH60-BLOCKED | Current assessment permits release, but no explicit historical reconciliation has been authorized/executed. Use a supported audited process only; do not change status with raw SQL or exclude it by name. |
| Approved safety correction | Unsigned sent/negotiating/approved successor | Adam confirmed on 29 October that an unsigned document alone must not block release. Migration 0082 extends the existing central predicate, retaining every signature-evidence, KS/ownership and independent-hold guard. Native concurrency and closed-case signature regressions pass; deployment evidence is tracked in `unsigned-successor-release-2026-10-29.md`. Historical cases are not reconciled automatically. |
| P1, verification | New changes after completed handover | Native PostgreSQL and UI tests pass. Live browser guard proof still needs an owned completed technical handover; no real completed sale will be used as a mutation target. |
| P1, historical evidence | 11 warnings / 8 legacy findings | Preserve discrepancies and originals. No guessed prices, invented historical document hash or silent metadata repair. |
| Operator readiness | Short working instructions | Added `rs-sbk-operator-guide.md`, using actual current UI labels, clear stop conditions and no implementation jargon. |

The approved-original-profile technical RS-to-SBK chain was already verified
using actual generated Word/SharePoint evidence and human-completed synthetic
signatures; its details and visual Word review are in
`approved-original-business-smoke-2026-10-26.md`. Today's read-only physical
check is additional evidence of persisted exact files, not a new real signature
or legal approval of a different buyer/accessory variant.

### Practical conclusion

The technical RS/SBK pipeline is demonstrated. **First real RS312 is not ready
for generation/signature.** Generic content approval of the complete DOB
variants is already recorded and must not be requested again. The remaining
blockers concern applicability and missing actual facts/files, not permission
to invent contractual content. The unsigned-state policy question has now been
answered explicitly; its focused implementation is tracked separately.
No new feature module or repeated audit is a substitute for resolving them.

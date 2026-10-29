# Unsigned successor documents and unit release

## Explicit business decision

On 29 October Adam confirmed: an unsigned document alone does not protect the
unit, including Sent, Negotiation and Approved. Partial signatures, another
effective commitment, independent holds and KS/ownership protection remain.
This is prospective behavior, not approval of historical reconciliation.

## Reproduction

New isolated regression scenarios first ran against migrations through 0081.
Draft allowed release, but Sent, Negotiation and Approved each produced
`blocked` instead of the newly required `released`. Those three test failures
reproduced the old policy; they were not unexplained infrastructure failures.

## Minimal implementation

Additive migration 0082 replaces only the existing central
`app.contract_blocks_unit_release` predicate. It excludes current unsigned
draft/sent/negotiation/approved documents only when there is no contract
signature timestamp, no signed/signed-at version and no signed party.
It retains effective termination and every signature-evidence condition.
An inconsistent signed status still fails closed. No legacy row is rewritten.

Existing contract-end assessment/synchronization uses that same predicate.
Unit-first locks, case closure, KS/ownership and independent-hold checks,
financial preservation, audit/outbox and idempotency are unchanged. No new
workflow engine, permission, frontend status calculation or legal text.

## Verification scope

- Every current unsigned working state: close the case and release the unit;
  preserve the successor's state/version/history and forbid advancement later.
- A prepared exact unsigned final document remains unchanged after release;
  both party-signature and external-signature entry points reject the closed case.
- A real recorded party signature on an approved successor still blocks release.
- Native PostgreSQL races exercise both operation orders, with actual lock
  waiting: unsigned advancement versus termination, partial signature versus
  termination, plus existing expiry/signature/reservation concurrency cases.
- Existing KS, independent-hold, future-effective-end, tenant/project and
  financial-preservation regressions remain required.

Full backend regression: **642 passed, 0 failed, 0 skipped**, with the native
PostgreSQL suite enabled on an owned disposable local cluster. Backend build,
frontend typecheck and lint passed. No frontend source changed.

Frontend production build, 214 interaction tests and 145 static frontend
tests passed, all with zero failures/skips. Existing bundle-size warnings
remain; no new dependency was added.

## Deployment

- Source commit `291d10dd2b7378185682f2dae08479f13e143cb9`, pushed to private GitHub.
- API ACR run `cg5u` Succeeded, digest
  `sha256:9b45dc6d6c3137f21bf99c6a146209712c1f3347019e3c0a1a8fc039754300cc`.
- Migration ACR run `cg5v` Succeeded, digest
  `sha256:2dd50981508d55b8ec034bab2e561dc6571e4c5e21df10eb7644d82181b66d61`.
- Preflight `caj-develocrm-migrations-pilot-rud6n2o` Succeeded: 81 migrations,
  every checksum verified against the previous healthy image.
- Migration execution `caj-develocrm-migrations-pilot-bwz0je9` Succeeded:
  applied only `0082_unsigned_successor_release.sql`, through the existing
  migration image/admin-secret job, not the runtime container.
- Migration SHA-256
  `3b3a948697ac527bf3c77348f0f21cdedd707bbeb74fad4995ae4a6a710978ac`.
- Postflight `caj-develocrm-migrations-pilot-kxu0z5z` Succeeded: exactly 82
  migrations, every checksum verified against the matching image.
- Revision `ca-develocrm-api-pilot--unsigned-291d10d`: Healthy / Running /
  Provisioned, one replica, latestReady and 100% traffic. Health and ready both
  returned HTTP 200 after confirming the new revision.
- Sites 187 is unchanged: no frontend source change or additional publication
  is needed for this database predicate correction.

## Live E2E checkpoint, not completion

Created only a new owned TECH83 fixture in the audit-verified TECH74 project,
using existing inventory, hold and commercial domain services. No existing
historical sale or real buyer was changed. Preparation execution
`job-develocrm-hold-expiry-fg0opdc` Succeeded.

- Unit 7483: `e0aa6fec-9501-472c-b157-acac27f30fa3`.
- Sales case: `3df5567d-2373-4e1d-8f7c-97f1498f9443`.
- RS: `467307b6-dc48-4352-bb4c-b386670e13ee`.
- Browser login through the normal existing Entra account succeeded.
- Browser uploaded `TECH83-unsigned-successor-synthetic.pdf`, explicitly
  labelled NO LEGAL EFFECT, through the existing protected SharePoint pipeline.
- Runtime read-only execution `job-develocrm-hold-expiry-ai0ycph` Succeeded:
  exactly one completed upload, contract v1 linked to exact document version
  `6c876887-9bf8-49c7-b5c7-60b237624ae2`; the pre-reserved case remained active.
- Browser transitions Draft -> Sent -> Approved persisted. The signature
  dialog was opened and handed to Adam for the explicit synthetic confirmation.
  No signature was inserted through a script or bypassed confirmation.

The browser-to-termination/release scenario is **pending that human action**.
It must still verify an unsigned Approved SBK survives, the case closes, the
unit becomes available, finances/history remain and the result survives reload.
Native PostgreSQL already verifies those states and both concurrency orders;
that is not a substitute for claiming a completed live browser test.

### Separate observed loading error

The upload itself completed, but its subsequent global refresh encountered
one HTTP 500 on `GET /v1/commercial`, correlation `req-j`, at 17:12:22 UTC.
Three log rows describe the same failed request, not three separate failures.
Retrying only the read restored the UI and showed the persisted exact document,
without repeating the upload. Existing sanitized logging records errorName
`error`, not a sufficient technical cause. Do not attribute this to rollout,
RLS or migration 0082 without evidence; its root cause remains unconfirmed.
No unrelated logging/refactor change was included in this package.

A forced `READ ONLY` diagnostic execution
`job-develocrm-hold-expiry-vhwob3k` returned SQLSTATE 25006 because existing
`contract_document_is_ready` invokes the locking document validator. This
diagnostic-mode mismatch is not evidence of the original HTTP 500 cause.
A follow-up uses only the audited repository SELECTs, permits their existing
row locks, applies a 10-second statement timeout and unconditionally rolls back;
it does not change production validation/locks or commit any business data.
Follow-up `job-develocrm-hold-expiry-kliwt5u` **Succeeded**: the same commercial
repository returned 32 contracts and 80 UUID/code price-breakdown entries with
rollbackOnly=true and noBusinessWrites=true. The initial request failure did
not reproduce. Its original root cause remains unconfirmed; a successful retry
must not be presented as proof that an underlying defect has been fixed.

**Later evidence supersedes the unconfirmed-cause checkpoint above:**
PostgreSQLLogs at 17:12:20.678 UTC records 40P01 in the commercial SELECT,
with context `assert_contract_document -> app.contract_document_is_ready`.
The read was taking signing-document row locks and participating in a deadlock.
This prompted a separate tested 0083 package, not a change to the approved
unsigned-successor rule. See `commercial-read-deadlock-2026-10-29.md` for
the preserved diagnostic evidence and subsequent verification.

## Completed live TECH83 E2E, 29 October

This supersedes the pending human-action checkpoint above. Adam completed the
synthetic RS signature manually; no signature confirmation was automated.
The browser showed its exact v1 PDF and the recorded signature.

The standard SBK preparation initially rejected an unpaid reservation fee, as
required by the approved SBK payment snapshot. The failed operation rolled back.
Using the ordinary payment UI, the test then recorded **CZK 1 solely in this
owned synthetic case**, with an explicit no-bank-transfer technical note.
No real money moved and no real buyer or historical pilot transaction changed.
SBK creation then succeeded in the same sales case, without a duplicate.

Through the browser, the same clearly nonlegal synthetic PDF was uploaded for
SBK `28f8ab09-20bd-4692-bcd7-d8b1ed56d128`, which advanced Draft -> Sent ->
Approved, without any signature. RS termination then ran once through the
existing workflow with a technical reason and the explicit no-refund decision
for the simulated CZK 1. No refund was created.

Read-only evidence executions, under the non-bypass application role:

- Before: `job-develocrm-hold-expiry-zsr83cu`, Succeeded.
- After: `job-develocrm-hold-expiry-zu2v47n`, Succeeded, receipt 19:10:13 UTC.
- Unit: reserved -> available. Case: active/reservation -> cancelled/interest,
  with closed_at. Signature-created reservation: cancelled, no active hold.
- Persisted end outcome: released, no blocking reasons; exactly one termination
  audit and one outbox event.
- The SBK remains Approved, unsigned, with zero recorded party signatures.
- Both exact document versions remain physically readable through managed
  identity / Graph, with content hashes verified against CRM.
- Financial rows (one obligation, transaction and allocation, each CZK 1;
  zero refunds) are unchanged: before/after SHA-256
  `a4df1f3acbb31cab6680cf6057b3b4bcf520ef72e267b99f193a437e79fe1f36`.
- Exact contract/document version evidence is unchanged: before/after SHA-256
  `9042d01059b9d46ade7b9b8ce5953b2f8cc63bcfb6c105cbe56fe536ad6457fc`.

Authenticated UI displayed “Obchod ukončen – jednotka uvolněna.” after reload,
and unit 7483 showed Volný with its historical contracts retained. The Approved
SBK explicitly explains that the case is closed and the working contract cannot
advance or be signed; no active signature or status-change CTA is present.
Backend rejection of signature entry points on a closed case is covered by the
native PostgreSQL suite, not by attempting to bypass the human signature dialog.

This closes the focused live unsigned-successor release gate. It does not
reconcile TECH60 history, make RS312 ready, or complete unrelated open gates.
Current runtime is revision `ca-develocrm-api-pilot--readiness-7dedd5b` with
migration 0083; compatible private Sites 187 is unchanged. These follow-up
records require no new deployment or migration.

Post-test bounded log sample on that revision: 420 completed requests,
41/41 commercial GETs HTTP 200, zero HTTP 5xx in the last 30 minutes.
This is a finite observation window, not a claim of universal error absence.

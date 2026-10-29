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

Deployment and live browser evidence will be recorded after the remaining
compatibility gates; this preparation is not a deployment claim.

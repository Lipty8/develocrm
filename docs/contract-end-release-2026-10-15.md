# Automatic contract-end reconciliation

## Scope and findings

The previous command reconciled RS only. Its `rollback_ended_rs` cancelled unpaid
obligations, and SBK/KS termination left the case/unit unchanged. Migration 0060
replaces that behavior for new base-contract status commands. It performs **no
historical data updates**. Effective termination in the existing model is immediate
(`ended_at=now()`); a missing/future end date fails the assessment.

## Safety policy

- Serialize on the unit row before contract, case and hold locks. Contract creation
  through the service follows the same lock order.
- Ended RS/SBK/KS may close an active case only when all other contracts are ended,
  there is no other active case, independent hold, blocked unit or live handover.
- Only the same case's system reservation (`signed-rs-reservation:<RS UUID>`) is
  retired automatically. Unrecognized/manual reservations fail closed.
- Any signed KS history, sold/handed-over unit, or handover blocks automatic resale.
  There is no trustworthy ownership-clearance record in the current model. No
  synthetic ownership flag or legal clearance workflow has been added.
- Release uses the existing commercial-status command, closes current buyer links
  with timestamps, closes the case, records stage/status events, audit and outbox.
- Payments, obligations (including unpaid), allocations, transactions and refunds
  are never changed by reconciliation. Existing explicit refund-decision rules
  remain in the termination command; there is no automatic refund.
- Receipt recording takes the same unit-first lock to avoid an obligation/unit
  lock inversion with termination. An uncancelled receivable remains payable in
  the UI after contract end; collecting it does not reopen the unit or sale.
- Retry checks authorization and exact contract/target before replaying. Persisted
  outcomes survive reload. A subsequent successful end of the same case supersedes
  an earlier blocked result in contract presentation.

## UI

Contract detail displays either “Obchod ukončen – jednotka uvolněna.” or
“Smlouva ukončena – jednotku zatím nelze uvolnit.” with actionable reasons.
The mutation refreshes commercial/catalog/client projections and histories.

## Unit 417 (read-only observation, 15 October 2026)

The live query confirms one active case, stored SBK stage, unit `contracted`, ended
RS and SBK, converted pre-reservation and two cancelled reservations. No historical
row was modified. Before any explicit reconciliation, inspect effective end dates,
signature history, all holds/handovers and the new read-only assessment. If eligible,
an administrator can authorize one explicit reconciliation of the existing case;
it must preserve all financial balances and unknown refund decisions. No automatic
backfill, repeated termination, legal assumption or bulk repair is included.

## Verification and release gate

Run `pnpm typecheck`, backend TypeScript build, full lint, frontend regressions,
interaction tests, production frontend build and backend tests. The native
PostgreSQL suite is run with `WORKFLOW_TEST_DATABASE_URL` pointing at an isolated
loopback PostgreSQL cluster; it creates/drops only its own test databases.

Tests cover RS release, SBK release after RS, remaining contract, KS ownership
block, independent hold, financial preservation, tenant/authorization denial,
replay, and actual lock contention with two new reservations. Existing signature,
expiry and document-evidence concurrency invariants remain covered.

Deployment evidence and authenticated technical-only E2E results are recorded
separately after release. Existing TECH SMOKE 0056/0057 and real business rows must
not be changed by this release.

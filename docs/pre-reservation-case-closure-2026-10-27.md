# Pre-reservation closure and a new buyer — 27 October 2026

## Evidence and confirmed decision

An isolated reproduction created a pre-reservation for A, cancelled it, and
attempted a new pre-reservation for B. The unit was available but the old sales
case remained active. The second command reused it and failed at
`sales_case_primary_party_uq`. The transaction rolled back; this was a blocked
resale, not proof that two buyers had already been persisted.

Adam explicitly chose: close the original deal and start a new one for the next
buyer, retaining historical drafts and preventing their accidental signature.

## Implementation

- Migration 0075 extends the existing operations; no new workflow engine or
  table. Cancel/expiry releases the last eligible pre-reservation and closes its
  case atomically. Closed case status is cancelled or expired as appropriate.
- Old case participants receive `left_at`; old converted interests are closed
  with an explicit history event. No history, document, contract, financial
  obligation, receipt, allocation, refund or snapshot is removed or rewritten.
- The next hold opens a new case and contains only the selected buyer(s).
- Existing signed/partially signed commitment, unverified KS ownership,
  independent unit block or noncancelled handover prevents release. Merely
  unsigned documents, including those awaiting signature, do not prove a signed
  commitment. Their historical content/status is preserved; the existing
  closed-case guard prevents subsequent advancement or signature.
- Expiry safely skips protected cases; manual release returns a specific safe
  Czech reason. Other active holds prevent final release/closure.
- The existing unit-first lock order is retained. If signature commits first,
  the reservation remains protected. If expiry/cancellation closes the case
  first, the waiting signature is rejected with `CONTRACT_CASE_CLOSED`, rather
  than reviving a historical transaction.
- No backfill/scanning changes historical cases. A residual case from old code
  can be closed only inside a new explicit hold command, with an ended
  pre-reservation, available unit, no live hold and the same safety assessment.
  This is not a migration-time mutation of unit 417 or other existing deals.
- Backend commercial context now includes interest lifecycle status. Shared
  frontend context selection never uses a historical/unknown-status interest
  or stale buyer without an active case as the implicit new customer.

## Verification gates

The original failing A → cancel → B reproduction now returns a new case with
exactly one buyer. Permanent tests exercise cancel and expiry, idempotence,
actual repository context, frozen historical contract versions/financial rows,
closed-draft transition rejection, runtime role and project/tenant context.
Native PostgreSQL regression/concurrency suite: 558 passed, zero failures or
skips. Strengthened financial-preservation tests then passed in a targeted
32-test run, including real receipts and allocations retained unchanged.
Frontend interaction and static regressions passed (167 interaction tests and
143 static regressions),
as did frontend typecheck, clean lint, backend build and frontend production
build. The existing large-bundle warning remains unrelated to this change.
## Published evidence

- GitHub runtime source: `9843ba97ca9ea269458ce406e7899ffefac6f363`.
- Sites source: `67c6b159487f317b509b2e447ddbf5523d0df1a2`.
  Both Git trees equal `e883a7374ac55812c03a52c5ffdb73be6b8bd61e`.
  An official OPEN-only helper invocation refreshed the stale checkout metadata
  before the normal build/package/push helper succeeded. No guard was disabled.
- ACR builds `cg59` (API), `cg5a` (migrations): Succeeded.
  API digest `sha256:c22215a47b3a9ae7d304f113b56e72e85a073a38b7bf8a2ce3ae860759619763`.
  Migration digest `sha256:08091ae6dbdc3ee1c9657dbfde8c6a104c2be1b59e2a3beb2e93db563512bf86`.
- Read-only preflight `caj-develocrm-migrations-pilot-7mdldxj`: Succeeded,
  74 matching checksums, only 0075 pending.
- Migration execution `caj-develocrm-migrations-pilot-mqkdgec`: Succeeded,
  applied only `0075_pre_reservation_case_closure.sql` via matching migration
  image and existing `database-admin-url` secret reference.
- Read-only postflight `caj-develocrm-migrations-pilot-va3arfw`: Succeeded,
  75 matching checksums, no pending migration; closure and replay guards present.
- Backend `ca-develocrm-api-pilot--pre-close-9843ba9`: Healthy / Running /
  Provisioned, latestReady, 100% traffic; Liveness and Readiness probes retained.
  `/health` and `/ready`: HTTP 200.
- Sites 174, deployment `appgdep_6ae09eccd28c8191abcd9139180e1f41`:
  Succeeded. Owner-only private audience unchanged.

## Authenticated browser and database smoke

Only a new synthetic unit 7406 was created inside the already-owned TECH74
project `cd3605bd-9ef7-461b-b3f2-54f0447fff60`.
Unit UUID: `20bf9b0f-1508-42d3-9353-fa43494a80d8`.

1. Standard UI created the unit with CZK 5,100,000 and then a new synthetic
   buyer A and pre-reservation.
2. Standard UI cancelled/released the hold. Adam manually confirmed the browser
   system confirmation because automation could not access it.
3. Unit became available with no current buyer; A remained visible in history
   as `Obchod ukončen`. This survived a full reload.
4. Reopening the sales form did not preselect the historical buyer. A new
   synthetic buyer B and pre-reservation saved successfully, without the old
   primary-buyer uniqueness failure.
5. Current buyer is only B, while A remains historical. Another full reload
   retained this state and the unchanged CZK 5,100,000 current unit price.
6. Read-only job `caj-develocrm-migrations-pilot-li9zmos`: Succeeded. Verified
   two distinct sales cases (cancelled / active), A's ended participant record,
   only B as current primary buyer, two historical/current holds with only one
   active, one closed interest, exactly one closure audit and one outbox event.

No existing actual customer/deal, unit 417, legal contract or payment was changed.
No contract was generated or signed during this smoke test. Cancel/release was
tested through the authenticated browser; expiry and signature races were
tested in native PostgreSQL, not artificially forced on pilot rows.
Bounded new-revision logs showed no 5xx/RLS/permission errors during this check.
The screenshot was inspected inline; no saved screenshot artifact is claimed.

This package is deployed and verified. It does not remove the separately
deferred real-contract prerequisites (verified parking rights/shares, legal
variant applicability and missing approved appendix files).

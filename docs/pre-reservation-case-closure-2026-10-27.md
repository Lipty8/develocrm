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
Frontend interaction and static regressions passed (143 static regressions),
as did frontend typecheck, clean lint, backend build and frontend production
build. The existing large-bundle warning remains unrelated to this change.
Deployment and authenticated pilot evidence will be recorded separately after
verification. No pilot release/expiry test is claimed yet.

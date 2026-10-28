# Client changes after completed handover

Business decision: after completed handover, new requests are complaints. Existing client changes, settlement, documents and history remain available.

## Implementation

- Additive migration 0079: tenant-scoped `app.client_changes_handover_completed` assessment and INSERT-only client-change guard.
- The guard locks the existing workflow unit and takes a fresh snapshot before checking actual completed handovers. Planned/cancelled handovers do not block creation.
- Existing update/transition/payment/complaint operations are unchanged; no historical rows are migrated.
- Existing sales directory publishes the same assessment; the new-change form shows a Czech explanation and disables submission.
- Error mapping exposes a safe business message, not a SQL trigger error.

## Concurrency scope

A proposed change to the existing handover function was rejected by safety review. It was NOT applied or deployed. The safer implementation leaves that function byte-for-byte unchanged. Both creation and actual handover completion already acquire the unit lock; client-change creation does not acquire a handover-row lock, so these two operations have no reverse handover-lock dependency.

Real PostgreSQL tests exercise both orderings, require actual lock waiting, reject creation after completion, retain creation before completion, and assert one handover audit record. All 73 workflow tests pass. The first native run used the wrong local socket; after correcting the isolated cluster configuration, all native tests passed. One test initially counted older fixtures reused on the same unit; it now counts its own named scenario.

Frontend interaction suite (197), frontend typecheck, backend TypeScript build, lint and production frontend build passed. Full backend regression: 492 passed, 10 environment-dependent tests skipped, zero failures. The separate native PostgreSQL workflow run passed all 73 tests without skips. Deployment verification remains pending at time of preparation.

No real pilot business records changed. Migration is prepared locally and not yet applied to the pilot. No claim of live verification until rollout and authenticated checks complete.

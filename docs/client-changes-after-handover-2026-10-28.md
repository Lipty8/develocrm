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

## Pilot rollout

- Source commit `21462aed48b3766219cfbef3641ff5e0c4768992`, pushed to private GitHub main.
- ACR API build `cg5h` and migrations build `cg5j`: Succeeded.
- API digest `sha256:dd2bf289a5a02a73eb8723061ed25112009fa2769501ee5f490e4dd562619249`.
- Migration image digest `sha256:f9cca9f75e17718d5e92fa44b897f56be6567d8d7c643c8e2f3f85dfb1cd588d`.
- Read-only preflight `caj-develocrm-migrations-pilot-53c2ib6`: 78 matching checksums, only 0079 pending.
- Migration `caj-develocrm-migrations-pilot-c51mpmy`: Succeeded; applied only 0079.
- Read-only postflight `caj-develocrm-migrations-pilot-21tn1a1`: Succeeded; 79 matching checksums, no pending migrations, assessment and enabled INSERT trigger present.
- Backend `ca-develocrm-api-pilot--handover-change-21462ae`: Healthy/Running, latestReady, 100% traffic. Health and ready each HTTP 200 after cutover.
- Private Sites 184, source `cd84197aa50344953645507f2648ade0da511987`, exact Git tree match `30fe79b9f008a175bec04cb097e038e2b4eafa82`.
- Deployment `appgdep_6ae1ac0e9c1c8191a32f791a71652d18`: succeeded, archive-backed. Owner-only audience unchanged.
- Bounded post-deployment log sample: 102 records, zero matched 5xx/RLS/startup-error signals. An initial log-stream connection reset yielded no evidence; the later successful sample is the basis of this statement.
- Additional frontend static regressions: 145 passed.

## Authenticated browser and live-proof limits

After publication, authenticated technical unit 7403 loaded successfully. Its new-change form still offered the actual current buyer before handover, and was cancelled without saving. No business records changed.

Live guard proof execution `job-develocrm-hold-expiry-69w3n4d` ended Failed with `TECHNICAL_COMPLETED_HANDOVER_MISSING`: no completed handover in an active technical project was available. It performed only reads before failing; it did not reach the attempted negative mutation. The completed-handover browser/production guard scenario therefore remains **not live-verified**, despite passing native PostgreSQL and frontend interaction tests. No real handover was created or modified to manufacture this evidence.

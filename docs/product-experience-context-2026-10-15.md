# Product Experience – business context and read states

## Verified live cause (read-only)

Unit 417 (`dd653a13-1310-4640-b886-926a8bb880ee`) has one active case
`b89c2afc-a195-42eb-a459-ddf2d6a12f91`, persisted stage `sbk`, unit status
`contracted`. Both base RS and SBK are `terminated`; the pre-reservation was
converted and both reservation holds are cancelled. The projection incorrectly
used the stored stage as evidence of valid contracts. The same read-only query
across the pilot found one matching advanced-stage/no-effective-contract anomaly.

No pilot business rows were changed. Diagnostic execution:
`job-develocrm-hold-expiry-wke96zo`, event `context.audit`.

## Safe changes

- Removed unsupported advanced-stage fallback. A conflicting case is flagged for
  administrator review; no restart/next-contract action is invented. Persisted
  commercial status is not silently changed. Valid signed RS still means
  reservation; the timeline explicitly labels its subsequent step as next step.
- Live unit contexts are keyed by unit UUID and include project/case identity.
  Contract DTOs carry unit UUID; current workflow filters by exact active case.
  Historical contracts remain visible in unit history/list, not as current facts.
- Holds and completed handovers in next-action reads belong to the active case.
  Contractual reservation holds are not treated as expiring pre-reservations.
- Payment context preserves projectId, unitId, partyId, contractId and salesCaseId.
  Unit/client navigation no longer picks the first equal display name/code.
- Document links expose authorized entity IDs from existing relation tables;
  document detail no longer guesses contract identity from text fragments.
- Shared cancellable read state separates loading, empty, forbidden and failure.
  Key changes hide the old result immediately; late responses are ignored.
  Client lazy loading no longer silently substitutes a stale local snapshot.
- Scoped workspace reads wait for matching catalog/client/contract data before
  displaying a new project/unit context. Sidebar stays mounted during transition.
- Dashboard uses real planned handovers, own task deadlines/high priority, unpaid
  fees/overdue payments and refund attention. Cancelled fees are not unpaid alerts.
  Activity aggregates authorized nonarchived projects rather than first project.
  Activity is deliberately limited to authorized unit/project events (not finance
  or client audit data exposed merely through project access). Placeholder project
  attention=0 was removed from the dashboard rather than presented as real KPI.

## Business decision received during work

Adam selected: terminating SBK/KS should close the sale and release the unit.
This package does not implement that new transactional termination workflow and
does not retroactively apply it to unit 417. It needs a separate implementation
covering contract/hold/case/unit and financial follow-up; no legal content or
payment/refund logic is changed here.

## Verification

- Backend regression: 277 pass, 1 optional real-PostgreSQL concurrency skip.
- Added UUID collision/current-case/late response/forbidden-retry/dashboard
  attention tests; database tests cover tenant/project/archive isolation and
  document links hiding targets without entity permissions.
- Frontend regression 143 pass; interaction and context tests 53 pass.
- Backend TypeScript and frontend production build pass; changed-file lint clean.
- Standalone frontend typecheck still has pre-existing repository diagnostics;
  it is not claimed green. Deployment and authenticated E2E evidence is recorded
  after publication, without mutating pilot commercial data.

No migration, new workflow engine, legal template, SBK/KS generation or new storage.

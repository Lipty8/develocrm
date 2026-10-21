# Exact document evidence coverage

## Verified gap

The operator-only consistency checker physically verified fully signed main
contract versions and approved templates, but omitted contract appendices,
frozen generation appendix bundles and partial-signature evidence. Inner joins
also silently omitted references whose document version could not be resolved.
This did not remove the existing signing-time guards, but made the readiness
report incomplete as evidence of long-term document integrity.

## Change

- Reuse the existing read-only checker and existing document/version model.
- Verify exact final contract documents, numbered appendices of frozen/signed
  versions, immutable generation appendix snapshots and approved templates.
- Include evidence after the first party signature; a fully signed contract
  must still have a fully signed logical version.
- Compare live appendix associations to the exact generation snapshot and
  report mismatches as critical, without changing either one.
- Left joins keep unresolvable references visible. Project/document context,
  configured managed identity and sensitive-document permission are checked
  before Graph reads. No arbitrary site or drive can be supplied by the caller.
- Download the pinned native version, compare SHA-256 and reuse a downloaded
  hash within one run when several associations reference the same exact file.
- Failed reads and hash mismatches both make physical evidence incomplete.
  Reports contain safe entity references, not storage keys, tokens or raw errors.
- Also fixed a missing explicit type in the previous PDF HTTP transport test.
  No business workflows, authorization mapping, legal templates or data change.

## Verification

- Full backend suite: 494 passed, zero failed/skipped, including native
  PostgreSQL and concurrency fixtures.
- Real SQL tests cover frozen appendices, exact native version selection,
  cross-tenant/project exclusion and corrupted snapshot detection. Corruption
  is simulated only in disposable test databases and rolled back.
- Unit tests cover missing/inaccessible files, deduplication, safe reporting and
  failure of the release gate when evidence is incomplete.
- Backend production build, frontend TypeScript, changed-file lint and diff
  checks passed. No frontend sources or database migrations changed.
- Deployment and live read-only verification are recorded below only after
  they have actually completed. Pending legal content/appendix approvals are
  not bypassed by this technical change.

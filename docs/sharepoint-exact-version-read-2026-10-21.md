# SharePoint exact-version read: runtime 406 fix

## Evidence and root cause

The expanded consistency check found seven blockers. Follow-up read-only
execution `job-develocrm-hold-expiry-8xjzqbw` distinguished their causes:

- Four approved technical template versions predate migration 0057. Their
  stored template hash matches the exact SharePoint bytes; their document-version
  checksum does not. Both values exist and this is not just a prefix mismatch.
  The pre-0057 upload implementation recorded the transport checksum without
  re-hashing the persisted Office package, while template registration downloaded
  the persisted file. Existing 0057+ uploads already correct this path. No old
  checksum was overwritten, and no reviewed exception was added automatically.
- Two old unsigned, superseded technical versions have valid project/document
  context, completed uploads and real native version IDs listed in SharePoint.
  They are not missing files. The adapter's JSON Accept header caused 406.
- `TECH60-BLOCKED` still has an active non-expiring reservation, an active case,
  a cancelled RS and a draft SBK. This is old test state; it was not repaired.

Read-only execution `job-develocrm-hold-expiry-bvk3z56` performed a controlled
comparison of beta/v1.0 and JSON/binary Accept headers for the same two pinned
versions. Both APIs returned 406 `notAcceptable` for `application/json`, and 200
with matching stored SHA-256 for `*/*`. No version, file, grant or DB row changed.

## Fix

- Content downloads explicitly request binary content (`Accept: */*`). Metadata
  requests continue to use JSON. Use the supported v1.0 content endpoint.
- A separate reproducible safety bug was found: any 400 previously retried
  against current content. Now this is permitted only when Graph's newest native
  version ID equals the requested pinned ID. Historical/unknown IDs and failed
  permission checks cannot silently become latest-file reads.
- Preserve pinned-ID/hash verification, bounded reads, configured site/drive,
  managed identity, Sites.Selected, RBAC and tenant/project context.
- No migrations, UI changes, legal content changes or data repairs.

## Verification

Both new regression scenarios failed before the corresponding fixes. Full
backend suite: 498/498, no skipped PostgreSQL tests. Frontend: 143/143;
interaction: 115/115. Backend production build, frontend typecheck, changed-file
lint and diff checks passed. Tests also cover permission failures, unknown and
historical version rejection, current-version fallback, exact appendix evidence,
upload retry/recovery, and bounded PDF reads.

Deployment and the post-deploy live read are recorded only after completion.

## API references

- [Download exact version content](https://learn.microsoft.com/en-us/graph/api/driveitemversion-get-contents?view=graph-rest-1.0)
- [Versions are returned newest first](https://learn.microsoft.com/en-us/graph/api/driveitem-list-versions?view=graph-rest-1.0)

These references support the stable endpoint/current-version semantics. The
specific 406 diagnosis above is supported by runtime requests, not inferred
from documentation alone.

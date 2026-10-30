# Project activity: current context and explicit read state

## Scope and reproduction

User requested skipping deferred real-case data. No buyer, legal variant,
appendix, signing date or financial record was filled or changed.

The independent project activity UI had its own state/effect. It retained the
previous activity array when the project changed and assigned a resolved result
without checking cancellation. A transport that resolves despite AbortSignal
could overwrite the new context. Every failure became an empty array, so both
403 and 500 appeared as “Zatím bez nové aktivity”. The repository also discarded
the response status/correlation ID by throwing a generic Error.

Four targeted regressions failed against that implementation before the fix.

## Existing shared mechanism, not a new data model

`ProjectOverview` now uses existing `useAsyncRead`, keyed by immutable project
ID, with the existing AbortSignal/cancelled-result guard. On a new key, previous
data is unavailable immediately, even before the new request resolves. Cleanup
aborts the request; a late resolution cannot install data for the old context.

Existing `AsyncNotice` renders loading, permission/error and retry states.
Empty-history copy appears only after a successful empty result. The notice is
outside the timeline's three-column row grid; no one-off CSS was introduced.

`activityRepository.projectTimeline` uses existing `readError(response)`, like
workspace/unit history. It preserves HTTP status and correlation ID without
showing the raw server response. Backend authorization/project/tenant filtering
is unchanged; this fixes client presentation, not a backend access grant.

No new dependency, API, migration, storage model, document generation or legal
text. No read is converted to a write. Deferred real RS312 facts remain deferred.

## Verification

- Four new interaction/transport tests cover initial loading, removal of an
  already-rendered prior project, two successive switches with late response,
  identical project names with different UUIDs, abort at switch/unmount,
  403 versus 500 versus successful empty result, retry, and safe correlation ID.
- 221 frontend interaction tests passed, zero failures/skips.
- 145 frontend static tests passed, zero failures/skips.
- Frontend typecheck, lint and production build passed.
- Existing large-bundle and build route-classification notices remain.

Failure/race simulations are deterministic local interaction tests, not injected
errors in the shared pilot. No business data was mutated by those tests.

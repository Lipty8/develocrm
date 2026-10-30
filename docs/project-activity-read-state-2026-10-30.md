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

## Initial publication and end-to-end follow-up

- GitHub source `024d153b53b1ccfaef223a19c1178479de39c654`.
- Matching Sites `9b239b4ccad93dadbd3127cc797128f80419312b`;
  643 source files matched, both Git trees
  `09242ea5cfa847be6f4a18e0b2bc16537bcfb9a0`.
- Private Sites 190, deployment `appgdep_6ae4475ab9848191919a19d15ebccd32`
  Succeeded. Owner-only audience/environment revision 3 unchanged.
- Authenticated browser loaded TECH74 activity, selected Rezidence Dejvice
  through the actual global-search project link, and reloaded that project.
  Each overview showed its own history; TECH74 termination events did not
  persist under the Dejvice heading. No form or business mutation was submitted.
- Bounded 15-minute backend sample: 198 completed requests, 4/4 project timeline
  reads HTTP 200, zero HTTP 5xx. The initial query used the frontend route name
  and matched zero activity requests; the reported 4/4 is the corrected query
  for the actual backend `/v1/projects/:projectId/timeline` route.
- Backend remains `ca-develocrm-api-pilot--readiness-7dedd5b`, migration 0083;
  health/ready each HTTP 200, no backend build or migration.

Source inspection of that BFF route then found that it dropped backend
correlation headers and did not forward the cancellation signal. A small
follow-up forwards the configured tenant/auth context, AbortSignal and validated
request correlation, returns the backend correlation header, and uses no-store
responses. Redirects are not followed; transport errors return safe HTTP 502
with correlation and log only errorName/status, not raw exception details.
Missing runtime configuration retains its existing fail-closed response.

A fifth transport test verifies the configured backend URL, scope headers,
correlation in both directions, cancellation signal, redirect rejection and
safe transport failure. The final full run passes **222 interaction tests**,
**145 static tests**, frontend typecheck, lint and production build. These
network failure simulations were local tests, not pilot fault injection.

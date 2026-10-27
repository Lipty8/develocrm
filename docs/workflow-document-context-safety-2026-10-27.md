# Workflow document context safety

## Reproduced issue

`WorkflowDocuments`, used by client changes, complaints and handovers, retained
linked rows, available project documents and selection when its target changed.
Its effect did not restore loading, did not clear old data, and allowed late
aborted results to set state. A read failure could leave old documents visible.
The generic link error also displayed arbitrary Error.message, and there was no
single-flight guard while linking.

An actual component regression (switch A to B while B's read is delayed) failed
before the fix: the A document remained visible in B's context. This demonstrates
stale UI, not proof of a successful unauthorized backend link.

## Focused correction

- Reuse existing `useAsyncRead` and `AsyncNotice`; no new cache or loader model.
- Key the inner panel by project, target type and immutable target UUID so all
  selection/mutation state resets when the context changes.
- Hide rows/choices during loading or a failed read, discard aborted responses,
  distinguish permission errors, allow explicit retry.
- Validate the selected ID against the currently loaded choices, disable controls
  during linking, and use a synchronous ref guard against a second submission.
- Link requests retain the exact clicked target; late mutation outcomes from an
  unmounted panel cannot alter the next panel. This does not pretend to cancel
  a server mutation already submitted before navigation.
- Refresh only the panel after success. Mutation failure shows a safe Czech
  message, without SQL/storage details.
- Existing document routes, backend authorization, tenant/project checks,
  audit/outbox and document contents are unchanged. No migration is required.

## Verification

15 targeted interaction tests pass (8 new workflow cases plus 7 existing
unit/client document regressions). Cases cover all three target types, forbidden
read/retry, delayed response, reset of selection, single-flight exact-target
linking, late failure after project switch and safe mutation error/retry.
Full verification passed: frontend typecheck, lint, production build,
191 interaction tests and 143 static regressions (zero failures/skips).
Private publication and live read-only evidence remain pending. No pilot
mutation has been submitted for this package.

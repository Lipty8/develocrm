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
The initial version was then published and tested with a new technical-only
fixture as documented below. No real pilot business data was changed.

## Live evidence and follow-up transport correction

First source commit `19421eabcd01d15694ead633085ac49c9d1bdf26` was published
privately as Sites 178 (matching Sites commit
`d805e726d5e9da2923a8afb0c9c7919d0964d4be`, equal source tree
`9eccddddaf37932262addc1c3f54b1a8746342aa`). Backend/migration unchanged.

Authenticated browser created only an unpriced synthetic client change
`TECH WF78 – ověření dokumentového kontextu` on owned TECH74 unit 7406,
explicitly choosing its actual current technical buyer B. No approval, price,
payment obligation or signature was created. The panel displayed only project
documents and submitted a link to the clearly nonlegal technical appendix 6
(`eca8dfd3-c8fe-424e-9c5e-f8cdc8142381`), not an upload or legal-document change.

The real request exposed a second integration defect: repository.link used the
default global invalidation, resetting the enclosing form despite successful
persistence. The actual transport/listener regression failed with three global
events for the three workflow targets. The follow-up uses the existing
`dataInvalidation: none` option because this panel already reloads its linked
and available document lists. It does not suppress invalidation for unrelated
mutations, bypass authorization or introduce a new cache/event system.
The complete follow-up frontend gates passed again: 192 interaction tests,
143 static regressions, typecheck, lint and production build.

Another independently observed P1: the new client-change form initially chose
historical buyer A even while unit context correctly showed buyer B. The test
did not submit with A. Its candidate source includes historical unit relations;
the current backend permits a project-linked party with a nullable sales-case
link. This needs a separate current-buyer/context safety package, not a silent
historical data repair. Do not call the entire workflow ready before addressing it.

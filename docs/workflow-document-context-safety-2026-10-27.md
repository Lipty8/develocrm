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

Independent read-only regression of the core approved-original TECH74 chain
also passed on the currently healthy backend `gen-recover-3e78f1e`:
`job-develocrm-hold-expiry-fppyoja` Succeeded. Exact SharePoint file hashes,
signed RS v2/SBK v1, immutable version links, signature audit/outbox,
signature-anchored first payment (1,100,000 CZK, due 3 November) and next KS
action were verified by the existing operator. No upload/signature/financial
mutation or scheduled-job update was performed by that verification.

Another independently observed P1: the new client-change form initially chose
historical buyer A even while unit context correctly showed buyer B. The test
did not submit with A. Its candidate source includes historical unit relations;
the current backend permits a project-linked party with a nullable sales-case
link. This needs a separate current-buyer/context safety package, not a silent
historical data repair. Do not call the entire workflow ready before addressing it.

## Follow-up publication repair

Code commit `59ef3831a8008fb129f424dfaf3962e02be7b141` passed all local gates
and official local packaging. Saved Sites version 179, deployment
`appgdep_6ae0fdacfe90819184a8d60f6d21b8fd`, nevertheless failed in a remote
fallback build: Lucide icon modules were unresolved. Site version metadata
confirmed `archive_storage: null`. The publication invocation incorrectly used
`archive_path`; the native tool's actual schema expects `archive`, so the local
artifact was not supplied. The working source/dependency graph itself was not
changed in this follow-up (only repository link invalidation, its test and docs).

Retain the failed source-only saved version as evidence, and do not claim it
deployed. The corrective source checkpoint records this diagnosis and supplies
the official matching output archive using the supported native parameter.
No icon rewrite, dependency downgrade, hosting-access change or bypass is needed.
Sites 178 remained serving while this repair was prepared.

## Correct archive-backed publication and browser results

- Corrective GitHub source checkpoint `2ef84a4`, matching Sites source
  `21255c04c032b73188d5d9bd923e25648c485ab8`, equal tree
  `165023a16660ab7ff32c7c0cbd1331bb371ee45a`.
- Sites 180, `appgdep_6ae0ffaa1e2881918a2ea602a7ef2b1b`: succeeded.
  Saved-version metadata confirms archive storage with SHA-256
  `41d01fca266652f98c148d586fdafa67cd0f7322b99e68e975c4bc73ce6807b2`.
  No remote rebuild/icon workaround or dependency change was needed.
- Live browser on the reloaded Sites 180 linked the second clearly nonlegal
  technical appendix (`17123c73-b8e5-4fd9-a31d-5ba82c1fb48d`). The dialog stayed
  open, its unsaved note remained intact, the selection reset, and both links
  appeared after the targeted reload. No parent status form was submitted.
- First persisted link returned 201 with correlation ID
  `70b64485-fac0-42ec-a8e8-0e52b980e70d`; the change UUID is
  `233b8e7c-b9e3-49a6-bd91-27ef83cd3ae4`.
- Read-only non-bypass application-role proof execution
  `job-develocrm-hold-expiry-es91pbg`: Succeeded. Retained Log Analytics summary
  confirms active current-buyer/case linkage, null surcharge, one creation audit,
  one creation outbox and zero unit payment obligations. It observed the first
  link before the second browser action, so its linkedDocuments=1 is not a claim
  that it separately counted the later two-link state.
- Screenshot inspected inline. Artifact-file saving was denied by the browser
  execution filesystem even after requesting the exact output-path permission;
  no saved screenshot link is claimed.

## Measured layout follow-up

Visual/DOM QA found modal content width 518px but scroll width 659px; the link
button ended at x=934.58 while the modal ended at x=794.5. This is real clipped
interaction, not only a cosmetic preference. Shared modal labels need to be
shrinkable, and the shared metadata list needs container-based compact columns
inside a dialog regardless of the desktop viewport. A narrow layout must retain
the document open link and status, not merely hide overflow. The follow-up changes
only these shared presentation rules.

## Modal layout deployment and live verification (28 October)

- GitHub source `54a5e54`, matching Sites source
  `ccc79e27e57ad77926f0b74cfafadf6ae9ccf4f4`; equal source tree
  `c045c6abab703c3700c801edbf530a7ed4b82d87`.
- Private Sites 181, deployment `appgdep_6ae19561669c819182931437a8b4133a`,
  succeeded. Saved-version metadata confirms an archive-backed version with the
  expected source commit. Sharing/access was not changed.
- Authenticated reload of technical unit 7406 and reopening TECH WF78 preserved
  both document links. No parent status form was submitted.
- Desktop: modal width 520px, body client/scroll width both 518px. The link button
  now ends at x=775.5, within the modal right edge x=794.5. Both document open
  links end at x=756.5. Previously scroll width was 659px and the button ended
  outside the dialog at x=934.58.
- At a 390px viewport: modal spans x=10..380; body client/scroll width both 368px.
  All visible selectors/buttons/document links stay inside the modal. The
  responsive viewport override was reset and the dialog closed without saving.
- New static layout regression tests plus existing gates passed: 192 frontend
  interaction tests, 145 static regressions, typecheck, lint and production build.
  No backend code or migration changed in this presentation-only package.
- Backend `/health` and `/ready` both returned 200. Bounded console inspection
  returned 152 log records with zero matching 5xx/RLS/unhandled/startup-error
  signals; the browser reported no warning/error messages in the inspected log
  window. This is a bounded check, not a claim about all historical logs.
- Screenshots were inspected inline on desktop and the narrow viewport. The
  previously documented filesystem restriction still prevents claiming a saved
  screenshot artifact.
- The unpriced TECH WF78 fixture remains clearly marked as technical evidence;
  no real sales record, signature, price, payment or SharePoint file was changed.
  The separately identified historical-buyer default/backend validation gap
  remains open for the next focused safety package.

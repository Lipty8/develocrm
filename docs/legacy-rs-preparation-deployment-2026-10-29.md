# Explicit imported RS preparation: pilot rollout

## Matching application release

- GitHub main `fe83c3c741df6ed72d3162a147596897fe284928`, pushed successfully.
- ACR run `cg5r`: Succeeded; sanitized context 167 runtime/dependency/migration
  files, excluding local environments, tests, original legal Word files,
  output and runtime data. No migration image or migration execution.
- API image `develocrm-api:legacy-rs-fe83c3c`, digest
  `sha256:c20e1b251d2e6c6838eca1bee913ea469e4a1f9d749fed9d0942ea44fdac77c9`.
- Backend `ca-develocrm-api-pilot--legacy-rs-fe83c3c`: Healthy, Running,
  Provisioned, latest=latestReady, one replica, 100% traffic. `/health` and
  `/ready` returned 200 after cutover. Existing liveness/readiness retained.
- No migration source changed compared with prior deployed 8d34cbd; last
  deployed migration remains 0080. No automatic historic reconciliation.
- Initial matching frontend Sites **186**, source
  `357f0fd91843bf9a375e0c60b56c5a35d96dab47`, deployment
  `appgdep_6ae2f61b7140819180c1b7fda1fb452e`, Succeeded.
- GitHub and Sites source trees both
  `068f7d44e515fc9dec816b903589aedf246b7c9d` before publication.
  Owner-only audience retained: one owner, zero groups/external visitors.

## Authenticated read-only real-case check

After reloading Sites 186, DEJ-312-RS displayed the new explicit preparation
action and no longer incorrectly said there was no accessory when the
contract basis was missing. Opening the modal performed a read-only request
and returned actual unit list price CZK 13,770,000, P18 CZK 1,290,000 and S2
CZK 290,000, total CZK 15,350,000. Agreed-price and fee inputs were blank.
The modal was cancelled without filling/confirming/saving. The real case
remained sent with version 1. No real data or legal wording was changed.

## TECH82 browser → BFF → API → PostgreSQL

New scoped fixture execution `job-develocrm-hold-expiry-f83t88s`: Succeeded.
New technical unit 7482 in the explicitly audit-owned TECH74 project:

- Unit `a8c1ebd2-24f8-44c0-b784-57cbce568619`.
- Contract `6ec614c3-fbe3-4fa8-a467-5e8c2e2fcb89`, reference TECH82-LEGACY-RS.
- Original imported version `f4dfdd8b-05b5-4e8b-8545-aacf4e4c7d0c`.

The authenticated browser deliberately copied the technical list unit price
CZK 2,500,000, entered technical fee CZK 10,000 and a clearly nonlegal test
reason, and confirmed the displayed accessory TECH82-S1 (CZK 100,000).
Only `Potvrdit a vytvořit verzi` was submitted. No signing/generation/payment
action was submitted. The modal closed; the page showed version 2, agreed
total CZK 2,600,000, TECH82-S1 and fee CZK 10,000 without a manual refresh.
An explicit reload retained all values and version count 2. The preparation
CTA disappeared after the missing basis was resolved.

Read-only verification `job-develocrm-hold-expiry-8css7u6`: Succeeded.
Its replica was gone when streaming logs were requested; the **same**
execution's historical Log Analytics receipt was retrieved instead. No job
was restarted to replace missing observation. Receipt at 07:38 UTC:

- unit price `2500000.00`, total `2600000.00`, fee `10000.00`;
- status draft, versions 2;
- one `contract.legacy_terms_prepared` audit and one matching outbox event
  (in addition to normal version-created evidence);
- original imported payload hash unchanged;
- catalog unit/accessory prices unchanged;
- signatures 0, obligations 0, contract documents 0.

The new unit/accessory/buyer/hold/import fixture remains clearly technical;
no real case, old test case, signed evidence or SharePoint file was rewritten.
No new permission or project access grant was created.

## Checks and visual follow-up

- 214 frontend interaction tests; 145 static tests; no failures/skips.
- 86 targeted backend/legal/snapshot/payment/native preparation tests; no
  failures/skips. Full backend regression passed, with separately reported
  environment-gated suites rather than claiming they all ran natively.
- Backend build, frontend typecheck, lint, primary and matching Sites
  production builds passed.
- Bounded new-revision log sample: 152 records, zero HTTP 5xx and zero
  matching startup/RLS/DB failure signals. This is a bounded sample, not a
  claim about every historical log. The PG driver printed its existing
  future TLS-alias deprecation warning; current verification was not weakened.

Visual browser QA caught a CSS defect: the new native checkbox inherited
text-input sizing and appeared oversized/stacked. A frontend-only follow-up
adds a shared FormConfirmation and reuses the existing compact signature
confirmation styling through a common selector. Existing signature JSX and
business logic are unchanged. Its 214 interactions, 145 static tests,
typecheck, lint and production build passed. The follow-up was published as
Sites **187**, source `aae303eafa307bbe1d4c0a4e6e5655863356448a`, deployment
`appgdep_6ae2f9e5bb7c8191af9c6a657f875580`, Succeeded. Its source tree
`27dc8ed11726a4b942fa2bcb922533dc755f577e` matches GitHub `c9255c9`.
Desktop visual/DOM QA confirmed a 19 by 19 pixel unchecked native checkbox
with its inline label and focus state, not a stretched text input. Separate
small-viewport visual verification was not completed. The backend source
tree is identical to fe83c3c; no API redeploy was needed for this UI-only fix.
Live Sites metadata later confirmed owner-private access (one user, zero
groups and external visitors).

## Overall readiness is still not complete

This closes the technical missing-legacy-terms path after its final visual
verification, not the full RS/SBK production goal. RS312 subsequently received
explicitly confirmed agreed amounts and an authorized new working version;
see the dated follow-up in `rs312-preparation-gap-2026-10-29.md`. Buyer facts,
applicable reviewed legal variant and exact appendices remain incomplete.
Deferred accessory rights/files remain deferred. No legal clause was removed
or guessed, and no actual signature/financial transaction ran.

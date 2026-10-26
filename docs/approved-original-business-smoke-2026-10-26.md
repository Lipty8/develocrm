# Approved original RS/SBK business smoke

## Scope

The existing TECH72 operator now supports an explicit `approved-original`
profile. It owns a separate TECH74 project and audit marker, never adopts a
real project by name, and uses the existing application role, RLS context,
inventory/commercial/document services and managed identity upload pipeline.
There is no new runtime endpoint, workflow engine or database migration.

Only the two content-approved inputs are accepted, pinned by SHA-256 and the
authoritative 32/38-field schemas. Every persisted `word/` package part must
match before the template copy can be approved in the owned technical project.
Office document-property normalization is not treated as legal-content change.

Preparation uses synthetic buyer/seller/unit/accessory data and clearly named
nonlegal technical appendices. These appendices prove binding and persistence
only; they do not prove that the real project's legal appendix package is ready.
The original-profile preparation returns readiness without generating the main
contract, so the authenticated browser can exercise the ordinary Generate action.
RS creation uses signature-based payment terms, not a hardcoded creation-date
deadline. No original legal wording is modified by this operator.

## Guards and local verification

- Explicit synthetic-data confirmation, active administrator, non-bypass
  application role and exact fixture ownership are required.
- TECH72 and TECH74 ownership markers are not interchangeable.
- Technical appendix input is pinned separately from the approved legal sources.
- 17 operator tests passed, including source substitution, Word-part fidelity,
  fixture isolation and the existing signed-chain/calendar checks.
- Changed-file lint and backend TypeScript build passed.
- 48 related backend tests for RS generation, original snapshots, signature
  payment terms and exact appendix evidence/input also passed.

## Repeatable verification and native PostgreSQL safety pass

The committed `run-sbk-smoke-job.mjs` now accepts an explicit optional third
argument `approved-original`; omission retains the original TECH72 profile.
For example, `node backend/scripts/run-sbk-smoke-job.mjs verify_generated
cd3605bd-9ef7-461b-b3f2-54f0447fff60 approved-original` performs read-only
verification of this owned TECH74 fixture. A failed start instructs the operator
to inspect existing executions before any retry. The definition never updates
the job schedule or API revision and keeps the runtime database secret reference.

The live `argument list too long` regression is covered using both actual legal
DOCX inputs: each environment entry is bounded and the Node command stays small.
Six launcher tests plus 17 operator tests passed, as did changed-file lint.
No arbitrary raw database URL is serialized into the definition.
Versioned-launcher execution `job-develocrm-hold-expiry-o5lp76s` Succeeded:
the exact RS, 32-field snapshot and six frozen physical appendix versions were
verified again, with one generation audit and one outbox event.

A fresh local PostgreSQL 17 cluster was started with only a private Unix socket,
no TCP listener. All 134 focused backend tests passed with zero skips, including
the real PostgreSQL variants: signature versus expiry/release, competing holds,
duplicate signatures/expiry events, concurrent appendix selection, immutable
signed evidence, initial-price races, contract termination and preservation of
payments, native JSONB roundtrips and RS/SBK upload failure recovery. Each fixture
removed its own temporary database; no databases remained beyond PostgreSQL's
defaults. The cluster was then stopped. Frontend TypeScript check and backend
TypeScript build also passed. These tests do not prove live browser signing.

## Pilot verification

- Operator preparation commit `5fc43e3` pushed to private GitHub.
- First execution `job-develocrm-hold-expiry-afrph85` Failed before Node started:
  `argument list too long`. Both replicas terminated before database access.
  The one-execution launcher was corrected to pass bounded source/payload
  environment values rather than one oversized command argument. No role,
  secret model, job schedule or API image was changed.
- Preparation `job-develocrm-hold-expiry-ac05z4v` Succeeded, using the existing
  API image `sha256:4fec3d87a7d815d30ddfed471232c93139facb59a0b048495f708296ee41ffa0`.
  Owned project `cd3605bd-9ef7-461b-b3f2-54f0447fff60`, unit
  `ab05c2b9-f537-4f18-b2c5-d73c44a21c1a`, RS
  `f25f7eb4-b119-45c3-a90e-807f0efdb1e1` returned ready with no issues.
- Authenticated Adam UI showed the 5,000,000 CZK unit, 500,000 CZK accessories,
  5,500,000 CZK total, 250,000 CZK fee and three working days from the last
  required signature. No fee obligation existed before signature.
- The ordinary `Vygenerovat RS` action created document version
  `4a07f0a6-2bda-4807-aa8f-9142e0364e39`, bound to contract version
  `3f67e7d6-0612-4558-be39-a490cf791d54`. Browser download succeeded. All four
  pages were rendered with the bundled document renderer and inspected; no
  unresolved placeholder, clipped content or broken signature block was found.
- The generated version and approved workflow state survived full reload.
  No signature was recorded and no real deal was edited.
- Independent read-only execution `job-develocrm-hold-expiry-tfev2ax` Succeeded:
  exact native SharePoint hash, pinned template hash, 32-field snapshot hash,
  deterministic reproduction of all Word parts, six frozen exact appendix
  versions and their physical hashes, one generation audit and one outbox event.

## New discrepancy requiring a business choice

The approved original text labels the payment variable symbol as the apartment
number. The current plan command in migration 0066 instead strips digits from
`contracts.reference`. TECH74-RS-SYNTHETIC therefore produced symbol `74`, while
the actual unit is `7401`. The generated Word and payment snapshot agree with
each other, but not with that meaning of the legal label. This is not a renderer
or stale-cache defect. It is reproduced in the real approved-profile flow.

Adam was asked whether these RS/SBK profiles should use the exact numeric unit
code rather than the contract reference. No legal text, existing plan, payment,
signed snapshot or database function has been changed pending that choice.
The technical RS remains unsigned; the complete RS-to-SBK chain is not claimed.

Adam also explicitly deferred the three missing real appendix files. They are
not being searched for further in this package; technical appendix fixtures
remain distinguished from real legal-package readiness.

## Decision and corrected RS version

Adam confirmed use of the exact numeric unit code for these RS/SBK profiles.
Migrations 0072 and 0073 implement the calculation and safe explicit version
repreparation, without rewriting historical documents or financial records.
See `unit-variable-symbol-2026-10-26.md` for complete deployment/test evidence.
Authenticated ordinary generation produced RS version 2 with symbol `7401`;
the earlier Word remains downloadable with its original hash and symbol `74`.
All four new Word pages were visually reviewed; only the symbol changed.
Read-only physical evidence execution `job-develocrm-hold-expiry-s51hamp`
Succeeded, including all six exact technical appendices. The real legal-package
availability caveat above remains unchanged.

## Signed RS and live original-profile SBK continuation

The human manually confirmed TECH74 RS version 2. The authenticated UI now
shows Signed and its 250,000 CZK reservation-fee obligation due 30 October 2026
(three working days, excluding the 28 October public holiday). This supersedes
the earlier unsigned fixture status; it is not a signature on a real contract.

Preparation execution `job-develocrm-hold-expiry-s05465d` Succeeded against
the existing healthy immutable backend revision
`ca-develocrm-api-pilot--unit-vs-f0a6934`. Only the owned TECH74 fixture changed:
a ledger-only technical fee receipt, the exact 38-field original-profile SBK
template copy, five explicitly nonlegal appendices and the same sales case.
No real pilot payment, buyer, unit, template or signature was edited.

Authenticated ordinary UI readiness returned no issues. Twenty compared
business fields matched signed RS v2; the SBK plan showed 1,100,000 CZK first
instalment, 4,150,000 CZK balance, and unit-based variable symbol 7401.
The ordinary Generate SBK action created:

- contract `2228075b-b021-4cc3-a64d-081dabee91c5`;
- contract version `a7b32374-ada8-4b75-b4c9-81aa2d2b7980`;
- exact document version `28f65edf-4ca4-4590-9c6d-cdbf0833ad25`.

The exact document downloaded through the normal UI had SHA-256
`b7175487dea8fed4053f4955c69fa3f4c00a2535a350e991a1661095b04c09ce`.
All eleven pages were rendered using the bundled renderer and individually
reviewed: no unresolved fields, clipping, overlap or broken signature block.
All `word/` parts other than the intended document text part remained identical
to the pinned original-profile source. Its existing legal text/highlighting
was not rewritten or harmonized. This is not Microsoft Word desktop testing.

Independent read-only execution `job-develocrm-hold-expiry-dtvu44s` Succeeded:
both latest RS/SBK exact native and template hashes, generation snapshot hashes,
deterministic reproduction of every Word part, six/five physical frozen
appendices and exactly one generation audit/outbox/upload operation per output.
The runtime log summary over the observed 30-minute window contained 1,039 rows,
zero error-level entries, zero HTTP 5xx and zero RLS violations.

The SBK was moved through Sent to Approved only in this owned technical case.
The deployed Sites 168 signature dialog correctly displayed its exact filename,
version 1 and unchecked explicit confirmation, with disabled submit. Its
optional note disclosure worked in the authenticated browser. Human completion
was requested; at this checkpoint SBK signature/payment-deadline verification
remains pending. Do not claim the signed original-profile chain is complete.

## Contract-stage history display safety

During the regenerated RS flow the detail could pair the newest entry into a
stage with an exit from an earlier visit, displaying completion before start.
The view previously ran two independent `find` calls over the whole history.
The small shared `contractStageHistory` selector now pairs only the latest visit
and its subsequent exit, and never marks the authoritative current stage
completed. It preserves deterministic API tie order, ignores invalid dates and
same-state metadata events for visits, and does not change persisted history or
any business transition. Unit plus rendered-detail regression tests cover
reopening, later completion, partial histories, same timestamps and empty input.
All 141 frontend interaction tests and 143 frontend regression tests passed;
typecheck, lint and production build passed. No migration/backend change.

## Human signature completion and final technical-chain verification

Adam subsequently confirmed the technical SBK manually. After a full browser
reload its exact version 1 remained Signed, with the explicit nonlegal-test
note, 1,100,000 CZK first instalment due 3 November 2026, and 4,150,000 CZK
balance awaiting evidenced notice delivery. No balance obligation or due date
was invented. Re-downloading the signed Word produced the same SHA-256
`b7175487dea8fed4053f4955c69fa3f4c00a2535a350e991a1661095b04c09ce`
as the pre-sign download.

Read-only execution `job-develocrm-hold-expiry-18ifgqu` Succeeded. The verifier
checked both exact native documents; all required parties signed; the last
required signature timestamp matched the contract and locked version; exactly
one signature audit, status event and outbox event per contract; exactly two RS
business/generation versions and one SBK version; same unit and sales case;
the existing central pricing/payment/calendar projection; unit status
`contracted`, sales stage `sbk`, RS/SBK complete and next action KS.
Both contract types use sales case `6ac6fa74-6eb3-4733-9d6d-48eda1267737`.

Authenticated unit UI agreed: SBK commercial state, RS and SBK complete, KS
the next step, unchanged 5,500,000 CZK price and same synthetic buyer. Only the
owned technical project was used. No real signature or payment was created.
This completes the approved-original-profile **technical** RS-to-SBK chain,
not the availability of the actual project's missing legal appendix files or
approval of additional buyer/accessory variants.

History implementation `6bec8bc` was pushed to private GitHub. Publication was
initially stopped by the automatic approval review's usage limit, not a code or
build failure. After the stated reset had passed, the normal approved helper
completed; no review bypass or access change was used. Sites **169** source
`2802118ba4deae02f1a01d30ba76e1cf45ea2f00`, deployment
`appgdep_6adfb6c43cb08191a335cdae2b931a93`, Succeeded. Its 581-file tree
`3067b9840df3a3e5b4cfefce98deeee8a70235a8` exactly matches the implementation.
Backend and migration 0073 remained unchanged; health/ready returned 200.

Post-publication authenticated read-only E2E opened the regenerated signed RS
and selected its Preparation stage: latest entry 26 October 09:52, completion
10:01, correctly paired within the new-version visit rather than the original
earlier departure. No historical record was rewritten by this check.

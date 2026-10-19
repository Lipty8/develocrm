# Signature-bound RS/SBK payment terms

Status: implemented, locally verified and deployed; authenticated pilot E2E is
in progress. No real pilot business data was changed. The separate
content-review gate for newly parameterized original legal templates remains
closed.

## Cause and scope

The existing create-contract command created a real obligation immediately using
a fixed date from the form; signing did not recalculate that date. Historical
obligations must not be silently reinterpreted. The legacy fixed-date template
flow remains unchanged. There is no historical backfill.

Migration `0066_signature_payment_terms.sql` stores a payment plan on the
existing contract version, not in a parallel ledger or the document generation
payload. Actual obligations still require a real, non-null due date and use the
existing transactions, allocations, events, audit and outbox.

## Agreed original-template policy

- RS fee: three Czech working days after actual effective signature.
- SBK first installment: 20% of the contract total-price snapshot, five Czech
  working days after actual effective signature.
- SBK final installment: remaining price after the first installment and paid RS
  fee, 30 calendar days after evidenced notice delivery.
- User decision confirmed 2026-10-19: the effective anchor is the **last required
  signature**, even when an earlier signature is entered later.
- Pinned calendar policy `cz-2026-v1`; every supported date in 2016–2099 is
  checked against the canonical TypeScript calendar. A future legal change
  requires a new policy version rather than edits to an applied migration.
- Current complete-original variant supports one buyer/payment debtor. A changed
  buyer composition fails closed; multi-debtor allocation is not invented.

## Domain and UI integration

- One shared project-template selection drives generation and creation. Ambiguous
  selection blocks only its own contract type. Draft legal templates remain
  unavailable for generation, even when a draft contract can be prepared.
- The backend determines the payment mode. A client cannot force a fixed date
  for the original variant or arbitrary installment amounts for SBK.
- The creation form keeps the RS fee input, omits creation-relative due dates in
  signature mode, and derives SBK installments from authorized CRM data.
- Current-version readiness validates the stored plan against price, buyer, paid
  RS fee and exact predecessor ID. The planned variable symbol is available
  before an actual obligation exists. A plan cannot silently use a different
  template variant.
- New versions inherit the plan. Bound/signed versions and already materialized
  schedule identities are immutable. Intentional due-date extensions survive
  retry and retain their original due date/history.
- Signature and creation paths use the canonical unit lock first. Repeated
  creation and concurrent signatures do not duplicate contracts or obligations.
- The existing SBK detail supports actual delivery date plus PDF/DOCX evidence.
  Upload uses the existing SharePoint service, deterministic operation key and
  standard document/version/business links, not a separate file store.
- If Graph persistence succeeds but the following DB transaction fails, retry
  reuses the same file and finishes the single delivery event/final obligation.
- Contract readers can inspect only that contract's delivery context without
  acquiring general ledger access. The proof URL is withheld without document
  read permission. Recording requires contract management and document upload.
- The shared CZK formatter now retains nonzero halere; integer amounts keep
  their compact representation. User-facing errors remain Czech with correlation
  IDs; missing domain data is not misclassified merely because its code ends in
  REQUIRED.
- No Signi, PDF conversion, new legal types, refund rules or legal content changes.

## Verification

- Full backend suite: 391 tests, 387 passed, 4 optional native suites skipped.
- Separate PGlite + actual PostgreSQL integrity suite: 35/35, no skips. Covers
  real parallel creation/signatures, exact signed-document evidence, scoped
  grants, a signer without financial management, contract-only delivery reads,
  calendar parity, reverse signature-entry order and downstream DB-failure retry.
- Full frontend interaction suite: 93/93. Includes the actual creation modal,
  stale-unit responses, failed discovery, evidence upload/retry and no fabricated
  due date.
- Frontend regression suite: 143/143, repeated after the delivery-panel addition.
- Root TypeScript, backend production build, frontend production build and
  changed-file lint passed. The existing large-bundle/static-route-analysis
  warnings remain.
- A native test fixture previously selected an unrelated zero-price unit left
  by the price-history test because it used unordered LIMIT 1. It now chooses a
  deterministically ordered, properly priced unit for commercial scenarios;
  zero-price behavior remains tested independently.

## Pilot preflight

- Backend remains `ca-develocrm-api-pilot--accessory-legal-cc5f0dd`, Running,
  Succeeded, immutable image digest
  `sha256:b1c91a0bc52393d309d337f2522b1a16111ba0782b15cba87980db9411822871`.
- Read-only job `caj-develocrm-migrations-pilot-40z54rs` Succeeded and confirmed
  latest migration 0065 with checksum
  `09ca00dacfa89ec212a39080e689ff09eab5f7cb382c5b18e3984a50ff0e6971`.
- The migration/admin identity has BYPASSRLS and is not a superuser; the narrow
  security-definer functions can execute their scoped duties without granting
  financial privileges to the runtime user. No runtime role or secret changed.
- Sites is still private/custom owner-only, version 151. Audience is unchanged.
- No pilot migration 0066, deployment or browser E2E has been claimed yet.

## Release checklist

1. Freeze the tested source in a commit and build matching API/migration images.
2. Apply only additive 0066 via the existing migration job/admin secret reference.
3. Deploy matching healthy backend, then matching private Sites frontend.
4. Authenticate and test only clearly labeled technical data: signature-based RS
   and SBK, exact-document signature, installments, delivery proof, repeat and
   reload. Verify audit/outbox and DB without touching real historical cases.
5. Keep original RS/SBK legal profiles review-only until separate content approval.

## Coordinated deployment evidence

- Source commit: `44a77fd4ff7891b8c3cf09c9490a4706b348b062`, pushed to private GitHub.
- Migration execution: `caj-develocrm-migrations-pilot-36amirl`, Succeeded.
  Only 0066 was applied. Read-only verification execution
  `caj-develocrm-migrations-pilot-3r1ol52` confirmed its stored checksum
  `2b619c7e1b5ec34ee7b17fadc10eec1971b1c548bc1c1490289521fde5abc6b9`;
  the previous migration remains 0065.
- API image: `develocrm-api:signature-payments-44a77fd`, immutable digest
  `sha256:57a0d6168ec528e69cf4dee3355fd3347df8ee91c5f366f9fa76141303109a33`.
- Migration image digest:
  `sha256:79e1252e8795b808ec868a07494465baa8abab7afe064ae6f242d1ca9af1020f`.
- Backend: `ca-develocrm-api-pilot--signature-payments-44a77fd`, Healthy/Running
  and latestReady. Liveness and readiness probes remain active. `/health` and
  `/ready` both returned 200. Startup log contains successful probes, not a
  startup failure. The existing PostgreSQL SSL-mode deprecation warning remains.
- Frontend: private Sites **152**, deployment
  `appgdep_6ad65c03bfac81918349451c91dd123d`, Succeeded.
  Sites source `fcf748ee786bbccd2c0a2c5814388fd41ac35b38` has exactly the same
  Git tree `e47b50137f3034dee8ee0079c7eaad3359ece653` as the GitHub source.
  Audience is unchanged.
- Authenticated UI reached projects and created only the isolated TECH66
  technical project and TECH66-A unit. Initial unit price is 10,000,000 CZK in
  both the table and unit detail. Further signature/payment E2E is pending.
- Existing unrelated UX issue observed: the newly created project's edit actions
  were initially absent until reload refreshed project permission context.
  No permissions were broadened and no backend authorization was bypassed.

### Authenticated E2E checkpoint

- Isolated project: `fc56a75f-8941-44c6-b4cc-2e998b04e80d` (TECH66).
  Unit: `54f2496c-d727-42ce-8ee4-2bb2e511f3e4` (TECH66-A).
  Existing synthetic buyer reused; no real buyer or historic case changed.
- Both original-profile RS/SBK files were uploaded only as draft review versions.
  UI displays "Generování smluv z ní zatím není dostupné". Neither was approved
  or activated. RS has 32 fields, SBK 37 fields.
- Created RS `bfcacf61-2b48-4068-a2e9-68a1e36cf810` through the unit UI.
  Form correctly omits a fixed due date and displays three working days after
  the last required signature. Plan amount is 200,000 CZK, variable symbol 66.
- Read-only DB job `caj-develocrm-migrations-pilot-cdavw7r` Succeeded: draft
  contract's stored plan has `signatureAnchor=last_required_signature` and zero
  actual obligations. UI independently displays zero prescriptions.
- Uploaded an explicitly NON-BINDING single-page test PDF via the existing
  external-document action; endpoint returned 201 (correlation `req-7r`). UI
  displays "Dokument připraven", version 1, the exact technical filename and
  a SharePoint link under this project's UUID-based folder. No legal document
  was generated or signed.
- Existing allowed workflow transitions draft -> sent -> approved returned 200.
- The signature form was set to actual test signature day 16 October 2026
  (recording on 19 October), so expected RS due day is 21 October. This expected
  outcome is **not yet verified**: a native confirmation dialog blocked browser
  automation before the final mutation. User handoff requested. Do not repeat
  the signature request while that confirmation is outstanding.
- SBK signature, delivery proof/final installment and post-signature reload
  remain pending; local/native PostgreSQL tests are not represented as a live
  browser pass. This release is deployed but not fully E2E-verified.
- No 5xx/RLS/startup failure was found in the inspected new-revision log windows.

### Project onboarding follow-up

The authenticated test exposed stale project permission context immediately after
creating a project. Catalog mutation invalidation did not re-fetch the identity
session; an administrator's project-scoped permissions therefore did not include
the newly created project until a reload. The backend authorization was correct.

The frontend now subscribes to the existing successful mutation event for the
exact same-origin project-create endpoint and re-fetches the normal identity
session. It does not infer administrator grants, add permission keys, broaden a
role, or refresh identity for ordinary unit/payment/contract mutations. Aborted
old session responses cannot overwrite a newer response. Listener cleanup is
covered. Failure remains fail-closed through the existing session error UI.

Verification: 99/99 frontend interaction tests (six new cases), 143/143 static
regression checks, TypeScript, changed-file lint and production build passed.
The existing large-bundle/static-route-analysis warnings remain. No backend
change or migration is required. Live new-project UI verification is pending
while the outstanding native TECH66 signature confirmation blocks browser
automation; this is not represented as a completed browser test.

Follow-up deployed: GitHub `f5b011d34a089733d4827c116e25fb74cba53a1b`, private
Sites **153**, deployment `appgdep_6ad672b7aa5c8191822fb79c2e730619` Succeeded.
Matching Sites commit `acc204e0c1eef6595cb7bf56eb9023f95bfbd146` and GitHub
have identical source tree `4efba981122bdd09acd8e873b4c976b54eca0108`.
Backend remains `signature-payments-44a77fd`; `/ready` returned 200 after
publication. No additional migration, image build, permission change, audience
change or pilot business mutation was performed for this frontend follow-up.

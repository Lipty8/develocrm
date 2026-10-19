# Signature-bound RS/SBK payment terms

Status: implemented and locally verified; coordinated deployment and authenticated
pilot E2E are pending. No real pilot business data was changed. The separate
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
- Frontend regression suite: 143/143 (latest run before delivery-panel addition;
  repeat as part of final release gates).
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

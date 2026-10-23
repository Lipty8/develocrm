# Isolated RS to SBK technical smoke

This operator harness exercises existing domain services and the configured
SharePoint upload pipeline. It does not activate any supplied legal original,
alter an existing deal, send money, or prove legal-content readiness.

## Scope and safeguards

- New fixture project only: TECH72, exact project UUID required on resume.
- Project name alone is insufficient: the same actor's ownership audit marker
  is required. Recovery of a missing marker additionally requires a recent
  domain creation audit and an empty project with the exact technical note.
- Runtime database role must be non-superuser, subject to RLS, and authorized
  for system management. Project operations retain their own permission checks.
- Generated fixture DOCX files contain no legal prose. Both explicitly state
  that they are invalid technical files and create no obligation. Their hashes
  and exact authoritative placeholder schemas are checked before any mutation.
- Existing template upload, validation and approval services are used only for
  these newly created synthetic templates in this isolated project. Real
  parameterized RS/SBK versions remain subject to separate content approval.
- Exact persisted source XML is checked before synthetic approval. Generation,
  SharePoint upload, immutable document evidence and ledger services are reused.
- Signatures are deliberately not performed by the operator harness: the
  browser must exercise the existing evidence/signature action.
- Repeated upload/generation requests use stable idempotency keys; appendix
  selection uses the current expected-version token. Active accessory links
  must point to the same test unit before they can be reused.
- Cleanup retires only the synthetic templates and archives the new technical
  project; SharePoint files and audit/history are not deleted.
- No automatic schedule or API deployment is introduced. The launcher uses a
  one-execution override of the existing job with the current immutable API
  image. It does not change that job's scheduled definition.

## Verification so far

- Six harness guard tests passed, including context/confirmation, no adoption
  by name, archived-project restrictions, exact RS/SBK schemas/hashes, invalid
  files and safe error output.
- Sixteen existing generation/payment-plan tests passed, including the actual
  mapper, renderer, upload-service recovery and PostgreSQL numeric comparison.
- Backend TypeScript no-emit check and changed-script ESLint passed.
- Both technical Word fixtures rendered successfully; all four pages were
  inspected. This is fixture QA, not comparison of legal originals.
- Current backend revision was verified as
  `ca-develocrm-api-pilot--sbk-v2-9b7bd71`, Running, with the expected immutable
  image digest. No backend or frontend deployment was needed for this harness.

## Live execution evidence

1. `job-develocrm-hold-expiry-b1rfw93`: Failed. A PostgreSQL parameter-type
   ambiguity (`42P08`) in the new harness's ownership-audit INSERT occurred
   after creation of the empty technical project, before units/contracts or
   SharePoint upload. This is not a production workflow defect. Automatic job
   retries refused to adopt that project without an explicit UUID.
2. Fixed explicit UUID casts and made future domain creation plus ownership
   audit atomic in a single transaction.
3. `job-develocrm-hold-expiry-40choot`: Succeeded. Recovered only the empty
   fixture's marker after exact UUID, same-actor recent domain creation and
   zero-child checks. No name-based adoption of another project.
4. `job-develocrm-hold-expiry-ki3yai6`: Succeeded. Created the technical unit,
   accessories, buyer and pre-reservation through existing operations; uploaded
   and validated the synthetic template; generated RS and retried the same
   request without duplication. Exact persisted Word file evidence verified,
   44,231 bytes. Contract `36e1a199-aa94-4d8a-8191-1246de446ea9`, current version
   `a2f944d2-347e-45fd-bd60-234398b3a137`, unit
   `3ed7e245-12ad-4956-9898-d18a01788692`. Signing remains a browser step.

Technical project UUID: `b25ea9f3-0dcd-4c67-a6d4-e7e521f0c6e8`.
Authenticated browser as Adam displayed the exact technical RS as Approved,
document ready, version 1, price 5,000,000 + accessories 500,000 = 5,500,000 CZK,
and fee 250,000 CZK. The signature modal opened with that exact document.
Automatic confirmation was rejected because its checkbox asserts an actual
signature rather than a simulation. No backend workaround was attempted. The
dialog was handed to Adam for the explicitly technical scenario; the RS is not
reported as signed until a subsequent authoritative check proves it.

The positive live RS signature, SBK generation/signature, payment-plan checks,
browser reload and final cleanup remain unverified until their executions and
browser evidence are actually observed. A passed fixture test must not be
reported as an approved-original RS/SBK production E2E.

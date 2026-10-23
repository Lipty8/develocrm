# SBK appendix schema and generation filename corrections

## Observed runtime failure

The isolated TECH72 RS was generated, physically verified and manually marked
signed by Adam through the existing browser flow. Its signed state and exact
version 1 were subsequently visible after a new detail navigation.

SBK preparation execution `job-develocrm-hold-expiry-v81mg05` failed. A second
execution with safe phase/code diagnostics,
`job-develocrm-hold-expiry-lnlth4j`, identified
`DocumentGenerationError: contract_appendices_required` at `sbk.generate`.
Readiness had passed; the guard rejected the persisted template appendix schema
before reserving generation or starting its output upload.

The guard compared `JSON.stringify(template.schema.appendices)` to the source
catalog. PostgreSQL jsonb reorders object keys (`label`, `number`) whereas the
catalog constructs (`number`, `label`). The values are equal, but those strings
are not. Existing in-memory positive tests retained insertion order and missed
the production failure. This was a real runtime blocker, not missing approval
or a failed Graph upload.

The corrected guard compares exact appendix count, position, number and label;
object key order is irrelevant. Missing, reordered, additional or modified
appendices remain rejected before upload. No legal text or approval is changed.
A native PostgreSQL jsonb roundtrip regression reproduces the original string
inequality and verifies the actual mapper/renderer/upload-service pipeline.

## Generated filename defect

The live technical RS filename contained `Fri Oct 23 202`. The pg driver returns
`timestamptz` as a JavaScript Date, but the repository used `String(created_at)`.
The generator then removed ISO punctuation from that locale Date string.

The repository now normalizes explicit timestamps and driver Date objects to
ISO before generating a deterministic compact filename stamp. Date-only,
timezone-less and invalid values fail closed. Template effective dates are
selected as date text instead of locale Date strings.

Already-reserved uploads retain their original filename, document name and
version label, loaded from the existing tenant/project-scoped upload operation.
This preserves its immutable request hash when recovering across deployment.
Completed generations still return immediately. Existing documents, physical
items, snapshots and signed evidence are not renamed or rewritten.

## Scope

Backend document generation only. No migration, schema change, new permission,
frontend workflow, legal-template activation or changes to actual business data.
Only the isolated synthetic test fixtures have been mutated by smoke operations.
Deployment and verification results must be appended after they are observed.

## Local release verification

- Backend: 512 passed, 0 failed, 0 skipped, with native PostgreSQL tests enabled.
  Includes JSONB roundtrip, pg Date values under three session timezones,
  preserved legacy upload naming and unchanged rejection of invalid appendices.
- Frontend: 143 passed; interaction: 121 passed.
- Backend production TypeScript build, frontend typecheck, changed-file ESLint
  and frontend production build passed. Existing vinext route-classification
  and large-chunk notices remain non-failing build warnings.
- Six operator-harness guard tests also passed.

## Deployment

- Implementation commit `4dc5624`, pushed to the existing private GitHub main.
- ACR build `cg50` Succeeded. Whitelisted context contained 155 source/config
  files only; no legal DOCX/PDF, credentials, runtime data or Git history.
- API image `develocrm-api:sbk-jsonb-4dc5624`, immutable digest
  `sha256:eab45e48d2711ccb87a9ea8a3f4097aedae8267e009345489ec321eabe0db8fb`.
- Revision `ca-develocrm-api-pilot--sbk-jsonb-4dc5624` verified Healthy, Running,
  latestReady and 100% latest-revision traffic. Existing `/health` liveness and
  `/ready` readiness probes retained; both endpoints returned 200 after the
  latestReady check. Previous healthy `sbk-v2-9b7bd71` retained for rollback.
- Sampled new-revision console logs: 44 entries, 0 structured HTTP 5xx,
  0 RLS findings and 0 fatal/uncaught-exception findings. This is a bounded
  post-deployment sample, not a guarantee about future requests.
- No migration or public API/DTO change. Existing Sites 162 is retained:
  frontend source and its backend API contract are unchanged. No unnecessary
  frontend publication or access/sharing change.
- Matching post-deployment SBK smoke execution
  `job-develocrm-hold-expiry-g0jxyjm` Succeeded on the new ready immutable image,
  resuming the same TECH72 fixture with the same idempotency keys. Generated
  output was 43,736 bytes; exact physical file and appendix evidence verified.
  Generation replay returned the same document and contract versions.
  Technical SBK contract `5216b67d-c508-405e-bf2c-be839658032d`, version
  `07e52631-8a65-4582-a335-a4f462dfd334`.
  This proves the JSONB correction through the actual managed-identity Graph,
  SharePoint and database path, but does not substitute for legal approval or
  the still-pending browser signature/payment-plan verification.
- Authenticated browser opened that SBK as Approved with document ready,
  version 1 and corrected filename `tech72-synthetic-sbk-20261023215610.docx`.
  It displayed the same buyer/unit/project, all five pinned technical
  appendices, total price 5,500,000 CZK, fee 250,000 CZK, first installment
  1,100,000 CZK and final installment 4,150,000 CZK. No fabricated due date or
  pre-signature obligation was shown. The default technical RS correctly
  requires manual comparison rather than pretending its snapshot is equivalent
  to the legal-original profile; original-profile comparison is not claimed.

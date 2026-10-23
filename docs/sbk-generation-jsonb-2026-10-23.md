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

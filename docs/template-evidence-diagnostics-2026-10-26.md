# Exact native template evidence diagnostics

## Runtime finding and cause

Read-only execution `job-develocrm-hold-expiry-foskdac` checked Dejvice and
TECH74 with the existing application role, actor/project permissions and exact
native SharePoint downloads. Dejvice had three critical
`APPROVED_TEMPLATE_HASH_MISMATCH` findings, two historical checksum warnings and
seven explicitly reviewed legacy signed versions without document evidence.
All scoped physical files were verified. TECH74 had no findings.

Targeted execution `job-develocrm-hold-expiry-teiwgs3` confirmed that the three
hash findings belong only to `technical-3d51977`, `technical-3d51977-proof` and
`technical-8791d93`. Their context and both hash formats are valid; upload and
document-version hashes agree, while the approved template pins different exact
native bytes. The approved original RS and SBK source hashes match their document
versions and are not affected by these findings.

The registration service deliberately pins the bytes read from the exact native
version. Office normalization can happen after upload finalization. The older
diagnostic SQL instead demanded equality with the earlier upload-version hash,
even after physical verification of the approved native source succeeded.

## Minimal correction

Invalid hashes, missing versions and wrong source context remain critical.
Valid but different upload/template hashes remain visible as
`TEMPLATE_UPLOAD_HASH_DIFFERENT` warnings, never as an implicit physical pass.
The physical checker still downloads the exact approved native version and
compares its bytes with the immutable template hash. Missing access or changed
bytes remain critical; the readiness gate still requires physical evidence to
be verified. No exception IDs, source hashes or stored metadata are rewritten.

No migration, contract/payment behavior, RBAC, RLS, audit or outbox changes.
No legal prose or template bytes changed. No frontend implementation changed.

## Verification

- The new PGlite regression failed against the old SQL for the reproduced
  discrepancy, then passed after the correction. It uses the real upload,
  registration, validation and approval services with delayed Office-property
  normalization in its Graph fixture, not an invented consistency fact.
- The same regression passed on native PostgreSQL. Deliberately changing the
  exact native source still yields a critical physical hash mismatch.
- Full backend: 519 tests passed, zero skips, with a fresh local PostgreSQL
  cluster available for every native/concurrency variant.
- Operator/launcher: 23 tests passed. Frontend: 143 static plus 138 interaction
  tests passed. Backend build, frontend typecheck and production build passed;
  changed-file lint and diff checks passed. The production frontend build retains
  its existing large-chunk advisory; it is not a build failure.
- Candidate read-only execution `job-develocrm-hold-expiry-8l7qu0t` ran the new
  compiled checker in a one-execution override before deployment: Dejvice
  0 critical / 5 warning / 7 legacy, physical evidence verified; TECH74
  0 / 0 / 0, physical evidence verified. Coverage is these two explicitly scoped
  projects and the checker's 20 checks, not a claim that all CRM issues are closed.

## Deployment

Pending. Existing healthy backend and Sites frontend remain unchanged until the
matching API image is built and independently verified. No database migration
is needed or to be run for this change.

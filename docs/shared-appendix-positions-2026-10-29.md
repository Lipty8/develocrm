# Shared physical document in numbered appendix positions

## Reproduction, not inferred from source

Authenticated Sites 187 / backend `legacy-rs-fe83c3c`, RS312 working v2:
the approved combined PDF contains both cellar and parking plans. Selecting
its exact v1 for appendix 2 succeeds. Selecting the same exact version for
appendix 3 fails with the safe duplicate-document message. Backend logs at
11:14 and 11:17 UTC confirm `CONTRACT_APPENDIX_DOCUMENT_ALREADY_LINKED`,
correlations `req-1hy` and `req-1iy`. The failed selection did not persist.

## Root cause and bounded change

Migration 0068 rejects any repeated document ID within a contract version,
and the older version-level unique index from 0009 enforces the same rule.
Neither distinction is appropriate for one approved combined plan serving
two explicitly numbered appendix roles. Creating a duplicate physical file
or mislabelling it as a coordination plan is not a solution.

Migration 0081 retains unique numbered positions and uniqueness of ordinary
non-appendix document links. The setter permits the same **exact** document
version in different numbered positions; mixing different versions of that
same document remains rejected. Unit-first locks, optimistic replacement,
tenant/project/permission checks, applicability, upload evidence, hash/native
version validation, audit/outbox and generation/signature freezes are retained.
There is no historical backfill, legal-text edit or storage duplication.

## Verification so far

- 29 focused tests passed, no failures/skips, including actual PostgreSQL.
- Concurrent selection/retry of one file in two slots yields two links and
  exactly two appendix audit/outbox pairs, not duplicate physical documents.
- Removing one slot retains the other. Different versions are rejected.
- Generation preserves all six numbered positions even when positions 2/3
  share one exact document; native generation evidence and hash checks pass.
- Existing cross-project/tenant, wrong-unit, immutability and signed evidence
  tests pass unchanged.
- The initial native test attempt did not find the expected local socket;
  the running owned cluster was inspected and restored to its isolated Unix
  socket/port with TCP disabled. The subsequent native run passed; no pilot
  database was involved.
- Full backend regression with the configured native workflow database:
  **630 passed, zero failures/skips**. Backend production build, frontend
  typecheck, interaction/static regression commands, full lint and frontend
  production build also passed. Dependency and lock inputs were unchanged.

## Pilot deployment and authenticated evidence

- Implementation GitHub commit `17c0d49b2d6120e4fa789c00272866c3b88c7176`, pushed.
- Sanitized context: 170 tracked runtime/dependency/migration files; no
  environments, tests, legal Word originals or runtime/output files.
- ACR API run `cg5s` and migrations run `cg5t`: Succeeded.
- API digest `sha256:29269b7b910f4562e69f85141721cbaf24d8d46d72e2b768ebbd75d577213d25`.
- Migration digest `sha256:db926646a7383ea1ff8c93c9704bea7e9d502be3f9b4a0a1d32232677d07728e`.
- Read-only preflight `caj-develocrm-migrations-pilot-923qq34`: Succeeded,
  80 applied migrations, all hashes verified against the prior runtime source.
- Migration execution `caj-develocrm-migrations-pilot-gn5rolr`: Succeeded,
  log contains only `Applied 0081_shared_appendix_positions.sql`.
- Read-only postflight `caj-develocrm-migrations-pilot-nwresr0`: Succeeded,
  exactly 81 migrations and all hashes verified. 0081 SHA-256:
  `a754edde3c02babe18f170c44b2f1758c81b5922b8b48d0e7d8995ecd25204cb`.
- Existing migration/admin Key Vault reference retained; one-off execution
  overrides only. No persistent migration/expiry job configuration change.
- Backend `ca-develocrm-api-pilot--shared-17c0d49`: Healthy, Running,
  Provisioned, one replica, latest=latestReady, 100% traffic. Health/ready
  both HTTP 200 after verified cutover. Probes/identities/secrets unchanged.
- Sites **187** remains the matching compatible frontend. Git diff confirms
  no application/package/config frontend source change since c9255c9, so no
  redundant frontend publication was performed. Private audience unchanged.
- Bounded new-revision log sample: 153 records, zero HTTP 5xx and zero
  matching RLS/DB/startup/deadlock signals. This is not a universal log claim.

After cutover the authenticated browser saved the previously rejected exact
combined plan in position 3. Positions 2 and 3 both use document
`b56f5483-fff3-4bdd-80ca-8591b1d67558`, business version
`6822e462-59e0-424d-8980-dc4ecca73245` (v1). The form closed successfully;
both displayed immediately without a manual refresh, then survived an
explicit reload together with catalogue 312 (position 1) and standards
(position 5). There was no file upload/copy or second physical document.

Read-only runtime-role verification `job-develocrm-hold-expiry-wxddffd`
**Succeeded**. It used the active actor, exact tenant/project/contract scope
and `contract.read`, with read-only transactions. Receipt confirms positions
`[1,2,3,5]`, the same exact version in positions 2/3, two contract versions,
draft status, zero signatures/obligations, symbol 312 and exactly one
appendix-3 audit/outbox pair. No signature, generation or actual financial
transaction was performed. The mandatory buyer/variant/accessory/legal-source
gates remain.

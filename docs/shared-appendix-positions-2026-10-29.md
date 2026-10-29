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

This section is local verification, not a claim of migration/deployment.

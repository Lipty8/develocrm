# Imported RS terms preparation — implementation in progress

This package addresses the concrete missing-price/accessory/fee preparation
path identified on RS312. It does not infer agreed prices or legal variants,
repair real data, create a second contract, render a legal document or sign.

## Implemented internal backend code

- Strict command schema: expected current version, server preview token,
  explicit agreed unit price, explicit fee, idempotency key and reason.
  Unexpected fields, including tenant/project/Graph destinations and render
  data, are rejected. Decimal money uses the existing exact parser.
- Read-only preview uses canonical current price/accessory projections and
  stable UUID assignments. Missing price is null, not zero. Stable token binds
  contract/project/unit/case/version, current price and exact assignments.
- Internal transactional preparation locks the workflow unit first, verifies
  active actor and project contract.manage plus price.read (canonical current
  prices must not leak to a contract-only role), and re-reads facts under the lock.
- Only an unsigned active RS with wholly missing terms and no existing
  signatures, locked/document versions, payment terms/obligations, document
  links, generation or upload operations may be prepared by this path.
  Other legacy inconsistencies remain review cases, not silent repairs.
- Existing create_contract_version appends a working version and reopens
  approval. The old payload remains unchanged. Confirmed terms and previous
  missing values are retained in the new payload, audit and outbox. Retry
  compares the full normalized request in JSONB and returns the same version.
- No new table, migration, financial model or SharePoint upload implementation.
  Payment-plan preparation remains the existing separate operation.

## Deliberately not yet exposed

There is no new HTTP route or frontend action in this commit. It must not be
deployed or reported as the finished preparation feature. Remaining gates:

- Expand negative/RBAC/project scope and real concurrent price/assignment/
  signature transition tests before exposing the write operation.
- Audit row/advisory lock compatibility with all price/assignment writers;
  ensure canonical preview is consistent under each supported transaction mode.
- Add safe public error mapping and correlation logging without input values.
- Wire authorized preview and explicit confirmation UI into the existing
  preparation panel; show agreed unit/accessory/total amounts and missing fee
  without defaults. Do not offer this for signed/financially active cases.
- Interaction tests, production builds, matching deployment and authenticated
  E2E on new technical data. RS312 stays unchanged pending agreed amounts and
  an applicable reviewed legal variant.

## Current verification

Exact decimal/token/input tests and full-migration PGlite/native PostgreSQL
tests cover preservation of imported versions, stale expected version/token,
actor/tenant/member mismatch, request replay/mismatch, one-version concurrent
retry, distinct concurrent confirmations and rollback after version creation.
Failure injection uses a trigger only inside a newly created disposable test
database; it is removed before retry and the entire database is dropped.
No pilot DATABASE_URL or credentials are used by these tests.

Latest targeted result: **18 passed, 0 failed, 0 skipped**, including native
PostgreSQL same-request and distinct-request races plus injected rollback.
The broad backend regression completed with **508 passed, 0 failed, 11 skipped**
(environment-gated native tests); the new native tests were run separately as
above. This is not proof of the remaining writer-race or HTTP/browser gates.

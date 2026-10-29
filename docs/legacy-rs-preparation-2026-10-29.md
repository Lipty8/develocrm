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

## Local HTTP wiring; not deployed

GET/POST `/v1/contracts/:contractId/legacy-preparation` now use the existing
authenticated session and the repository checks. The path UUID is validated;
missing token is 401, inaccessible contract 404, stale/review conflicts 409,
invalid input 422, unexpected failure 500. The public response never contains
raw database messages. Logs contain correlation ID and allowlisted codes, not
request money/contact data or SQL. Retry returns 200, first preparation 201.

At the HTTP-only checkpoint there was no frontend/BFF action or new pilot
deployment. The following UI package implements the form below. Remaining gates:

- Extend remaining negative fixtures as needed during UI integration. Correct
  project/contract-edit/price-read scope, suspended memberships and signed
  evidence protections are now tested under real non-bypass roles.
- Matching deployment and authenticated E2E on new technical data. RS312 stays
  unchanged pending agreed amounts and
  an applicable reviewed legal variant.

## Current verification

Exact decimal/token/input tests and full-migration PGlite/native PostgreSQL
tests cover preservation of imported versions, stale expected version/token,
actor/tenant/member mismatch, request replay/mismatch, one-version concurrent
retry, distinct concurrent confirmations and rollback after version creation.
Failure injection uses a trigger only inside a newly created disposable test
database; it is removed before retry and the entire database is dropped.
No pilot DATABASE_URL or credentials are used by these tests.

Initial checkpoint (`46f0b8a`): **18 passed, 0 failed, 0 skipped**, including native
PostgreSQL same-request and distinct-request races plus injected rollback.
The broad backend regression completed with **508 passed, 0 failed, 11 skipped**
(environment-gated native tests); the new native tests were run separately as
above. This is not proof of the remaining writer-race or HTTP/browser gates.

## Follow-up: canonical writer and authorization safety

The price basis is now read in **one SQL statement at one timestamp**, using
the existing STABLE canonical price functions. This is the confirmation's
linearization point. A committed intervening price/assignment change invalidates
the token; a truly concurrent writer may serialize before or after the confirmed
basis. A later catalog update never silently rewrites agreed contract terms.

No inverse proposal/accessory row locks were added: proposal decisions hold a
proposal lock before inserting a price with a unit FK, and assignment release
holds an assignment before the accessory overlap trigger. Adding those locks
after the unit could create new lock cycles. Existing writer behavior is
unchanged; no migration is needed for this consistent-snapshot solution.

Native PostgreSQL tests now run real proposal creation/approval, accessory
price updates and assignment releases. They verify committed-before-confirm
stale rejection and concurrent approval/release with either the exact original
confirmed snapshot or a stale-preview refusal, never mixed values/deadlock.
A final external document added after preview blocks preparation. A concurrent
signature attempt without evidence remains rejected (not a successful-signature
simulation). Additional RBAC fixtures prove that contracts-only or other-project
grants cannot read price previews; correct project units-read plus contracts-edit
works, and suspension denies it again.

Latest targeted database/core run: **27 passed, 0 failed, 0 skipped**. Separate
real HTTP route test passed, covering authentication, actor context, idempotent
response status, safe failures and correlation IDs. Browser/E2E remains pending.

After the HTTP/snapshot changes the full backend suite completed: **510 passed,
0 failed, 19 environment-gated skips**. The new preparation-native cases among
those skips were separately executed in the 27-pass native/core run above;
this does not claim that all other gated suites ran. Backend build, full
TypeScript typecheck and lint passed. No frontend source was changed in this
follow-up, no new migration was added, and no deployment or pilot write ran.

## UI package and release gates

The existing RS preparation panel now offers `Doplnit smluvní údaje` only for
an editable/manageable RS candidate with absent unit/total price and fee, no
current final document and no closed-case issue. Backend eligibility remains
authoritative: price scope, evidence, financial history and current state are
rechecked before a preview or write is permitted.

The shared FormModal shows current list price/assignments separately from the
explicitly agreed unit price, current accessory price and resulting agreed
total. Both money inputs start empty. `Použít aktuální cenu jednotky` is a
deliberate copy action; the fee is never inferred. The existing CZK formatter
and exact money parser are reused. Exact addition is shared with the backend,
not another independent pricing projection. Changing amounts clears the
confirmation checkbox. The submit label explicitly creates a working version,
not a generated or signed document.

Unknown network/server outcomes freeze the command and retain its idempotency
key, including closing/reopening the modal. A proven rejection requires a new
preview/confirmation. A successful write followed by a failed refresh offers
refresh only, never another write. API/BFF transport disables global invalidation;
successful preparation refreshes the existing commercial/preparation context.
Changing contract aborts the old preview rather than filling the next case.

- Frontend interaction suite: **214 passed, no failures/skips**.
- Targeted original legal/template/snapshot/payment/SBK and preparation tests:
  **86 passed, no failures/skips**, including native PostgreSQL.
- Full backend regression, static tests, backend build, frontend typecheck,
  lint and frontend production build passed. Broad backend environment-gated
  suites remain distinguished from the explicitly executed native subset.
- No migration files changed compared with deployed 8d34cbd.

The narrow TECH82 operator is prepared for pilot E2E: new unit 7482, one new
technical accessory/buyer/hold and a new *synthetic imported* unsigned RS in the
previously owned TECH74 project. It verifies exact project ID plus existing
ownership audit marker, active admin/non-bypass role, and its own idempotent
fixture audit marker; it never identifies safe data from names alone. New
legacy-style rows use the existing import record shape from the start, not
UPDATEs that erase a normal contract's terms/evidence. The operator neither
signs nor generates nor creates a payment obligation or SharePoint file.
Verification expects browser-created v02, one preparation audit/outbox pair,
unchanged original payload and unchanged unit/accessory catalog prices.
Its availability is not evidence that the live test already ran.

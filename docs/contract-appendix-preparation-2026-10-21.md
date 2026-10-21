# RS/SBK appendix preparation — technical package deployed, legal activation pending

## Follow-up: source appendices and PDF transport (21 October)

- The matching API `appendix-unlink-42f476f` is ready, digest
  `sha256:bd3bf7a2f038ea3cb7286dbc4be9256118af75f0df78ae2cd93f5ffd76bc6423`;
  `/health` and `/ready` both returned 200. Sites 160 is unchanged because
  this follow-up did not change frontend sources.
- Read-only readiness execution `job-develocrm-hold-expiry-vobxvag` completed
  with a failing consistency gate, not an infrastructure failure. Migration
  hashes, health/readiness, Sites.Selected, configured SharePoint read and
  frontend compatibility passed. The remaining critical finding is the old
  synthetic `TECH60-BLOCKED` reserved unit without an effective signed contract;
  there are also eight legacy evidence exceptions and six warnings. No records
  were repaired automatically. This is not proof of legal-template readiness.
- The user authorized copying only approved appendices from the separate
  `immobuilding / Dejvice TEST` source library to the configured
  `DeveloCRM / Dejvice TEST` library, retaining originals and existing site grants.
- Source inventory: 19 main unit catalogue PDFs plus a separate 519 sauna
  supplement; 12 situation/floor-plan PDFs; one standards PDF. Names are only
  inventory, not sufficient evidence for automatic contract/unit assignment.
- The standards PDF has 20 pages and 10,183,053 bytes, SHA-256
  `a79e5e7830b7fdd6f00a77b9c937c03194bd39c572d58833d1541b152844b4c0`.
  Static parsing found no JavaScript, embedded files or opening action.
  SharePoint's source preview failed with a generic warning, while normal
  download and the details thumbnail worked. Static inspection is not an
  antivirus verdict. The authorized copy was uploaded without overwrite into
  the exact configured target library and returned the same byte count;
  CRM ingestion, native-version hash verification and appendix selection remain
  pending. No original was modified, and no template was activated.
- This exposed three real limits: generic upload 4 MiB, JSON/base64 transport
  sized for 4 MiB, and Graph readback 8 MiB. Migration 0071 and shared limits
  support PDF documents up to 25 MiB (matching MIME and extension); other
  uploads remain 4 MiB. PDF magic is checked in the service. Template and
  external-signature endpoints retain their existing stricter limits.
- Graph content reads are now bounded while streaming, with Content-Length
  prechecks and cancellation on overflow. Exact native-version retrieval and
  stored-byte SHA-256 validation remain unchanged.
- Local verification: all 491 backend tests passed, including actual PostgreSQL
  and concurrency coverage, plus a new HTTP transport test (>8 MiB accepted,
  >25 MiB rejected, template endpoint still restricted). Backend production
  build, frontend TypeScript and changed-file lint passed. Deployment of 0071
  and a live >8 MiB pipeline smoke test are not yet claimed by this section.


## Scope and current state

This package prepares explicit selection of exact appendix versions inside the
existing contract preparation panel. It does **not** activate either original
legal template. The technical package is deployed as backend `appendices-67f169c`
and private Sites 160. Migrations 0068/0069 are applied in the pilot. Only a clearly
technical contract's appendix association is exercised by the browser smoke test;
real/historical pilot business data are not changed.

Generation/signature bundle validation is implemented and verified in the
follow-up section below. Full original-profile generation/signature browser E2E
and live exact SharePoint appendix-byte verification remain required. Do not remove `original_profile_review` or
`generationSupported:false` before full original-profile business validation,
content approval and authenticated browser E2E have passed.

## Existing model reused

`contract_documents` already associates an exact contract version with an exact
document version. Migration 0068 adds only an optional appendix position and a
partial unique index; it introduces no second document store or appendix table.
Existing unclassified associations remain unchanged.

`app.set_contract_appendix` requires active actor context and project-scoped
`contract.manage` plus `documents.manage`. A selected document must belong to the
same project, be accessible to the actor, have a completed SharePoint upload,
SHA-256 and native version, and have a ready/sent/negotiation/signed exact version.
Sensitive-document access is checked separately. Request bodies cannot specify
a drive, site, path, file name or arbitrary URL.

Selection changes are limited to the latest editable working contract version
without a final document or signature. An explicit expected document-version ID
prevents lost updates. Same-selection retries do not duplicate audit/outbox rows.
Removing a draft selection removes only the association, not the document/file.
After final document binding the selection is immutable. Signed appendix documents
also participate in the existing central signature-evidence predicate, so existing
archive/upload/link guards protect them.

## Readiness and UI

The supplied original profiles have explicit numbered requirements (RS: six,
SBK: five). No file-name matching or automatic legal approval is used.
Readiness exposes selected exact versions and missing/unavailable positions;
unexpected positions also block readiness. Existing project document permissions
control whether document names/IDs are returned.

The same preparation panel is used for RS and SBK. It loads project documents on
request, asks the user to select a specific ready version, retains an optimistic
concurrency token, refreshes the preparation summary after saving, and displays
safe Czech errors. It does not upload files through another mechanism.

## Initial selection-package verification (e2764ee)

- Backend regression: 431 total, 426 passed, zero failed, five optional native
  suites skipped in the ordinary full-suite run.
- Targeted appendix PGlite + actual PostgreSQL: 12 passed, zero skipped. Native
  tests use `develocrm_app` transactions in a disposable database, not the pilot.
- Native scenarios: six identical concurrent assignments produce one link and
  one audit/outbox pair; competing different selections have one winner and one
  stale-token rejection; final-document binding vs selection has no deadlock and
  leaves the bound version uneditable.
- Exact version/tenant/project/actor checks, draft rejection, stale working-version
  rejection, retry, replacement/removal, signature protection and canonical SQL
  source read were exercised.
- Frontend interaction regression: 115 passed, including exact version selection,
  draft exclusion, immutable selection UI and retained values after a rejection.
- Static frontend regression: 143 passed.
- Frontend TypeScript, backend TypeScript build and changed-file lint passed.
- Vinext production build passed; existing large-chunk warning remains.

These initial results did not prove live Graph appendix-byte verification or
published browser E2E. The deployment and limited browser checks are recorded below;
full original-profile evidence verification remains required before activation.

## Source discovery

Read-only SharePoint discovery found the known `Dejvice TEST` library, with three
original contract files and the `projects` hierarchy. A full list traversal
returned 82 entries and no continuation, but no newly uploaded appendix folders.
The default Documents library root was empty. Access to the previously referenced
`/sites/immobuilding` location returned 403. The user has been asked for the exact
uploaded folder URL; do not copy arbitrary similarly named files from elsewhere
or expand Graph permissions to compensate.

## Follow-up work after e2764ee

Migration 0069 and the generation/evidence services now prepare a frozen appendix
snapshot on the existing `document_generation_operations` record. The snapshot
pins the working contract version, exact document-version IDs, native versions,
hashes and SharePoint item identities. Selection changes and archiving/rebinding
used documents are blocked while generation/final evidence depends on them.
Template registration adds explicit appendix requirements to the existing
immutable `placeholder_schema`; existing template versions are not backfilled.
Pre-sign verification reads exact native appendix bytes and checks SHA-256 through
the same Graph adapter used for the main document.

The new trigger initially also intercepted legacy no-appendix test transitions
that intentionally do not establish a session context. It is now limited to
versions with appendix links or an original template profile; legacy primary-
document enforcement remains independent. The original signed-document rejection
code is preserved when both old and new document guards apply.

After a temporary approval-review usage limit reset, the final backend regression
ran with `WORKFLOW_TEST_DATABASE_URL`: **484 passed, zero failed, zero skipped**
(60.2 seconds), including every available native PostgreSQL suite. The synthetic
SBK fixture now uploads all five appendices through the real upload service with
a Graph test adapter. It renders the supplied parametrized SBK, simulates upload
timeout, retries the same reserved operation, binds the exact main document and
checks all exact appendix versions before signing. Altered appendix bytes are
rejected; the original frozen snapshot stays unchanged. Public approval/generation
of the review-only profile is still explicitly rejected in this fixture.

Frontend TypeScript, backend production compilation and changed-file lint passed.
One redundant assertion in a concurrency test had narrowed an error branch to
`never`; removing it did not change the test's failure behavior.
## Pilot deployment — 2026-10-21

- Implementation commits: `e2764ee`, `38f5f06`; final deployable commit
  `67f169cd5fe1b391a94352bb36a1c3cc7a4d971c`, pushed to private GitHub.
- API ACR build `cg4p` succeeded. Immutable image digest:
  `sha256:cd1a5e934c64cc32b3f67ca95ace930417a334f94ff9f94e6513e844bbf60be3`.
- Migration ACR build `cg4q` succeeded. Immutable image digest:
  `sha256:678f97188bb24ec9eb10211441a145a9077b02a5bb3fd6b5e6a5fd912b4efae4`.
- Existing migration job, existing managed identity and Key Vault-backed admin
  secret reference retained. Execution `caj-develocrm-migrations-pilot-cr29twh`
  succeeded and applied only 0068/0069. Independent read-only execution
  `caj-develocrm-migrations-pilot-0fz9kxm` confirmed 69 migrations and exact hashes:
  - 0068: `1675f5627cc09bc68a92c99a889d3d8082d09d11c54f3008c7000d5483b00bb3`
  - 0069: `0444d1d3058d99d944e507b1ddafd645b92d480f93206121cab7b197d19549d8`
- Active revision `ca-develocrm-api-pilot--appendices-67f169c`: Healthy, Running,
  one replica, 100% latest-revision traffic; liveness/readiness probes enabled.
  `/health` and `/ready` returned 200.
- Private Sites 160 publication succeeded, deployment
  `appgdep_6ad8c214e3f081919c05e20022647a1d`, Sites commit
  `7ff19abb286c773bd2a0da2b14179ecc87dc0d28`. All 539 source files matched GitHub;
  both Git trees were `2dda3575c65645bdfa1856c6e98486451264be95`.
  Site access remains private/custom; no sharing changes.
- Last production frontend build succeeded through the official Sites helper.
  Existing large-chunk warnings remain. Packaging-only follow-up reused unchanged
  frontend inputs and reverified the final matching source tree.
- Frontend interaction tests 115/115, static frontend tests 143/143; full backend
  484/484 with every optional native PostgreSQL suite enabled, plus the separate
  new migration-image packaging regression 1/1. Typechecks/build/lint passed.
- Post-cutover log sample: 252 entries, zero completed-request 5xx, zero fatal
  startup/module failures and zero matched DB/RLS errors. This is a bounded sample,
  not a claim that future errors cannot occur.

### Packaging incident and recovery

The first cleaned build context for 38f5f06 omitted `backend/scripts/migrate.ts`.
ACR built the image but migration execution `caj-develocrm-migrations-pilot-5mx0kun`
failed before connecting to PostgreSQL with a missing entrypoint. A read-only check
confirmed the schema stayed at 67; neither API nor frontend was switched to it.
Commit 67f169c adds a Dockerfile fail-fast existence check and a packaging regression
test. The corrected context includes the committed launcher, excludes secrets and
attachments, and produced the successful matching images above.

### Authenticated browser verification and limits

Microsoft sign-in returned the expected Adam Liptak administrator session.
Projects, the TECH62 project, contract list and preparation readiness loaded with
HTTP 200. The technical `TECH62-PREPARE-RS` renders all six required appendix slots
and explicit missing-version messages, while original-template generation remains
blocked. Selecting the existing technical `TECH62-DRAFT-RS` file and its exact
`externi finalni dokument` version saved slot 1 with HTTP 200 (`req-4j`) and refreshed
the panel/readiness without a full application reload. This file is a disposable
smoke fixture, **not** a real catalogue or approved legal appendix.
The selected document/version remained visible after a full browser reload.
The first removal attempt returned 409 (`req-5z`): the pre-existing global
`guard_signed_document_link` rejected removal because this same technical file is
signed evidence in another contract. It wrongly protected an unrelated editable
draft association as if it were the original signed association. No data were
lost. Migration 0070 scopes only this exception to an explicit appendix command
on a working version without final document, signature or generation reservation;
signed/final associations, file identity/bytes and other link tables remain
protected. Regression tests cover replacement, removal, idempotent/concurrent
removal, preserved signed association and denied direct deletion/archive.
Migration-only follow-up commit `42f476f8d8c5cedd2907fefefc986a64ae0e3892`
was pushed to private GitHub. ACR build `cg4r` succeeded; migration image digest
`sha256:0ba6461dadc85c1b9af4c245f295a510408ca83968975064ce90fb2f4e97d257`.
Execution `caj-develocrm-migrations-pilot-0qi1t0c` succeeded and logged only
`Applied 0070_shared_appendix_draft_link.sql`. Independent read-only execution
`caj-develocrm-migrations-pilot-gbmq219` succeeded, confirmed 70 migrations and
0070 checksum `aaf6870cc9dddb934e1d5f10e4a19e00f5dc130e18b0eb490024c33e56d1760f`.
The final removal through the same authenticated UI succeeded, cleared the slot
without an application reload, and stayed cleared after a full reload. Underlying
files/versions were not deleted. `/health` and `/ready` both remained 200.
API revision `appendices-67f169c` and Sites 160 were retained because this follow-up
changes only a compatible database guard, regression tests and documentation.
Source-content classification/approval is not inferred from this technical link test.

The 0070 regression explicitly restores the old guard in each disposable fixture,
reproduces `SIGNED_DOCUMENT_IMMUTABLE`, reapplies 0070, then proves replacement and
removal while preserving the other signed association. Four parallel native
removals yield one mutation/audit/outbox outcome. Direct runtime DELETE still
fails with PostgreSQL 42501; direct owner DELETE without the domain command also
fails. After the fix, full backend regression passed **487/487, zero skipped**
(62.5 seconds). Targeted appendix/evidence tests passed 17/17. Backend production
compilation, frontend typecheck and changed-test lint also passed. No frontend or
API runtime source changed in this follow-up; the existing healthy API/Sites
versions remain compatible with this narrowly scoped database correction.

No template approval/activation, real contract signature, financial operation or
real project/deal mutation was performed. The full real-original pipeline remains
unverified until the actual approved appendix folder is identified and content
review/variant data gates are satisfied.

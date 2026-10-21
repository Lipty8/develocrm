# RS/SBK appendix preparation — implementation in progress

## Scope and current state

This package prepares explicit selection of exact appendix versions inside the
existing contract preparation panel. It does **not** activate either original
legal template and is **not yet deployed**. Migrations 0068/0069 have only been executed
in disposable local databases. No historical or pilot business data were changed.

Generation/signature bundle validation is implemented and verified in the
follow-up section below. Published browser E2E and a live exact SharePoint file
check remain required. Do not remove `original_profile_review` or
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

These results do not prove live Graph appendix-byte verification or published
browser E2E. Those checks remain required before deployment/activation.

## Source discovery

Read-only SharePoint discovery found the known `Dejvice TEST` library, with three
original contract files and the `projects` hierarchy. A full list traversal
returned 82 entries and no continuation, but no newly uploaded appendix folders.
The default Documents library root was empty. Access to the previously referenced
`/sites/immobuilding` location returned 403. The user has been asked for the exact
uploaded folder URL; do not copy arbitrary similarly named files from elsewhere
or expand Graph permissions to compensate.

## Follow-up work after e2764ee — tested locally, not yet deployed

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
No pilot migrations, publication or business-data changes have been performed.

# RS/SBK appendix preparation — implementation in progress

## Scope and current state

This package prepares explicit selection of exact appendix versions inside the
existing contract preparation panel. It does **not** activate either original
legal template and is **not yet deployed**. Migration 0068 has only been executed
in disposable local databases. No historical or pilot business data were changed.

The next required integration gate is generation/signature bundle validation:
pin the selected appendix set when generation starts, validate it again when the
final document is bound, preserve it on retry/new business versions, and verify
the exact appendix bytes through the existing SharePoint evidence layer. Do not
remove `original_profile_review` or `generationSupported:false` before those gates,
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

## Verification completed

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

# Approved RS and SBK live preview verification

## Scope

Read-only follow-up to the explicit 25 October content approval and deployment
of API `rs-original-1f3d65b` / private Sites 164. This is template preview evidence,
not a substitute for full contract generation, upload, frozen appendix binding
and signature evidence on a technical case. No legal prose, template bytes,
real deal, area, price, payment or signature was changed in this follow-up.

## Live authenticated preview

Adam's authenticated Dejvice template UI downloaded both previews through the
normal `Testovací náhled` actions. The backend downloaded the exact pinned
SharePoint source versions, verified their hashes and rendered the sample
values from the shared catalog using the existing strict renderer.

The downloaded preview DOCX files were compared part-by-part with a local render
of those exact stored sources and the same committed shared catalog. Every ZIP
part matched for both outputs. The inspection found zero unresolved or malformed
placeholders: 32 supported fields in RS, 38 in SBK delivery v2.

Output hashes:

- RS preview: `099e43b601ca3b57bd5f603a791cdbab95cb65d546ee0b70d042c536e2515eb2`.
- SBK preview: `d7bcbfb35941a2924fe27f37f2722d075e08cf366f7a84917474c1b9ab2566cd`.

The bundled document renderer produced four RS pages and eleven SBK pages.
All fifteen page images were inspected. No unresolved field, overlap or clipped
signature block was confirmed. A truncated multi-image tool display initially
suggested the SBK final line was clipped; opening the full last-page image
disproved that observation. No template/layout modification was made.

These are deliberately synthetic sample values, including a test buyer explicitly
marked not to sign. They are not authorized CRM business inputs and were not
uploaded or registered as final legal contract versions. No PDF workflow was
added; the local PDFs/images were QA intermediates only.

## Current external gates

- The connector's source-folder listing at `immobuilding / Dejvice TEST` returned
  HTTP 403 on 25 October. The user's ordinary authenticated SharePoint browser
  session subsequently loaded the supplied library URL and its Dispozice folder
  normally. This is not a general loss of user access and does not require a
  broader backend Graph grant. No permissions were changed and no blocked PDF
  content was opened or ingested through an alternate route.
- Exact target standards-PDF metadata still confirms the known 10,183,053-byte
  file, not an antivirus verdict. The Microsoft 365 administrator has been asked
  to clarify whether it is marked malicious/quarantined; a generic content
  approval is not treated as overriding the earlier security stop.
- The separate explicit approval request to apply the 19 authoritative catalogue
  area corrections remains distinct from approval of Word content/appendices.
  No area repair has been executed.
- Exact per-position appendix mapping and original-profile business E2E remain
  incomplete. No coordination plan, power of attorney, client-change rules or KS
  wording is inferred from a similarly named file.

## Current project readiness, read-only database proof

Existing job execution `job-develocrm-hold-expiry-4qgir4h` completed Succeeded
(18:01:22–18:01:52 UTC). It used the current matching immutable API image,
existing runtime database secret reference and non-superuser/non-RLS-bypass
application role. The schedule/job definition was not modified. Every database
transaction was explicitly REPEATABLE READ READ ONLY; actor membership and
project-scoped contract/document permissions were checked before inspecting data.
No Graph writes or business mutations were performed.

The existing central project-template selection SQL chose exactly one effective
approved RS original v1 and one SBK delivery v2 profile v1, with the same persisted
hashes recorded at approval. There is no ambiguity from the old technical
templates in this project.

Project document inventory visible to this authorized actor contained 15 active
DOCX records and zero PDFs. The physical appendix copies are therefore not yet
registered as ready CRM appendix document versions. Existing active contracts
were evaluated through `RsGenerationService.readiness`, not a new workflow
calculation. No editable candidate was ready. The remaining sent RS reported
missing seller settings, all six appendix positions, buyer identification/contact
data, applicable complete-variant accessories/garden, signing dates, payment
reference/terms, price and reservation fee. These are readiness findings, not
authorization to repair that historical deal or to remove variant clauses.

The source projection also reported no populated seller settings (including
signature identity, client-change bank account and delivery address). These must
be verified against the approved originals/current authorized company data before
being set. No bank account or other value was guessed from a technical sample.

The source library's browser root contains KL, Dispozice and Standardy folders
and the three original contracts. The fully loaded Dispozice list contains twelve
PDFs: floor plans, cellar/parking plans, combined unit/floor plans and the known
three-page situation file. This inventory does not establish a coordination
plan, power of attorney or client-change rules. Those must be located and
classified explicitly; absence from this inspected list is not claimed to prove
absence from every location in the user's SharePoint.

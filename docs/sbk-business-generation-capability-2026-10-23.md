# SBK v2: technical generation capability, without legal activation

## Concrete remaining runtime gap

The authorized scalar mapper, signing/payment preparation and numbered exact
appendix evidence existed, but `generationSupported=false` and an unconditional
`original_profile_review` issue prevented even an explicitly approved, complete
SBK from ever reaching the renderer. Template approval also could not proceed
through its existing authorized lifecycle for that profile.

This package enables technical capability **only** for the 38-field
`dejvice-original-dob-delivery-v2` SBK profile. The older 37-field SBK and RS
profiles remain blocked. The RS legal fee-credit conflict is not reinterpreted
or silently resolved. No DOCX template, legal text, manifest, approval record,
project selection, signature or financial value is changed.

## Approval remains a separate, mandatory decision

- Current draft/validated versions do not become approved through this change.
- Existing template repository selects only approved, effective versions in
  the authorized tenant/project; ambiguous selection still fails readiness.
- The generation service additionally checks explicit per-version approval for
  original profiles before reserving or uploading anything.
- Existing template approval requires `documents.review` and the database's
  validated-to-approved lifecycle, with immutable content/hash and audit/outbox.
  No automatic call to this operation is added or executed.
- Missing canonical buyer/seller/address/price facts, unsupported accessory
  rights/share, missing exact appendices, stale payment terms, missing effective
  RS/paid fee and closed cases still prevent generation. The complete variant
  still requires its supported combination; no legal paragraph is removed.
- Only the backend builds the snapshot. The public general-generation route
  cannot supply arbitrary snapshot values or bypass contract preparation.

## Verification

- New multi-service test uses the actual SBK v2 DOCX, `RsGenerationService`,
  strict renderer, `DocumentTemplateGenerationService` and the existing
  `SharePointDocumentUploadService`. Only persistence and Graph are in-memory
  ports. It verifies all 38 mapped fields, unresolved-token absence, exact
  template hash/version, native file version, frozen generation snapshot and
  contract/document-version binding.
- Retry of a complete request does not re-upload. DB failure after physical
  upload finalizes the same operation without another copy. Changed data on
  retry cannot replace the reserved snapshot. Missing approval, effective RS,
  paid fee, appendix, delivery address and closed case fail before upload.
- General generation rejects draft/validated/retired/missing approval even
  though the catalog supports the profile. Existing legal-content preservation
  tests continue to require inactive review manifests and unchanged Word parts.
- Full backend: 503 passed, 0 failed, 0 skipped, including native PostgreSQL
  isolation/concurrency. Frontend 143 passed; interaction 115 passed. Backend
  production TypeScript build, frontend typecheck, changed-file lint and diff
  check passed.

This is not a claim of a live approved-original generation or a complete
RS-to-SBK browser E2E. That test remains gated by content approval and the exact
approved appendix bundle. No ordinary-user legal template is activated here.
Deployment and authenticated read-only smoke results are recorded separately
once actually observed. No migration is required. A matching frontend wording
change explains that SBK v2 uploads remain concepts pending explicit content
approval, instead of incorrectly claiming the profile can never be activated.
The upload control does not approve anything; RS and old SBK keep their existing
review-only explanation.

The current Sites helper identified a conflicting obsolete npm starter
`package-lock.json` alongside the declared pnpm package manager and maintained
pnpm lockfile. The obsolete npm lockfile was removed from source (recoverable
in Git). No dependency version or pnpm resolution changed, and no dependency
installation was performed. API Docker builds already use pnpm exclusively.

## Deployment and live observations

- Backend implementation `9b7bd71`; matching UI wording `1b12946`; canonical
  lockfile cleanup `d9f2d91`. All pushed to private GitHub. Backend build inputs
  are identical between `9b7bd71` and `d9f2d91`.
- ACR run `cg4y` succeeded. Sanitized context 419.474 KiB, excluding DOCX/PDF,
  runtime data and credentials. API immutable digest:
  `sha256:d13a9c67c765762be6bd193f66c3054a953e003f90d46948ec839c606373a144`.
- Revision `ca-develocrm-api-pilot--sbk-v2-9b7bd71`: Healthy, Running,
  latestReady and 100% traffic. Previous binary-versions revision retained.
  `/health` and `/ready` returned 200. Sampled new-revision logs had no
  structured HTTP statusCode >= 500, RLS or startup failure findings.
- Sites helper completed the production build, source push and archive.
  Sites commit `d79164ab16a63175a7049d1419a76b411787a81d` has exactly the same
  Git tree `eaa8a6722d3092ce985872de5b3e26e3aee05586` as GitHub `d9f2d91`.
  Sites **161**, deployment `appgdep_6adb36fa4c1481918b2bf73eaa2267f6`,
  succeeded. Owner-only custom access and zero external viewers preserved.
  Existing large-chunk warning remains; it is not a failed build.
- One-execution read-only runtime smoke
  `job-develocrm-hold-expiry-en2igli` succeeded, using the runtime database role.
  The real SBK v2 template remains `draft`; technical support is true, and
  preparation of the existing technical case is not ready because approval,
  canonical facts and appendices are missing and that case is closed. The old
  unconditional profile-review blocker is absent. No DB or Graph write.
- Authenticated browser as Adam loaded templates and selected TECH67 DELIVERY
  SBK. It still displays Concept, 38 fields and no active version. After a full
  reload, the upload modal shows the new explicit-approval explanation, with
  the correct technical project, SBK type and v2 variant prefilled. The modal
  was cancelled without selecting a file, validating or approving a version.
- Browser inspection also observed that the list's `project` URL parameter
  did not initialize its project filter (All projects remained selected).
  Explicit template selection correctly supplied the upload project. This
  separate context-navigation gap was not silently counted as fixed here.
  Follow-up: this gap was subsequently fixed by `5a72e10`, already included in
  Sites 163. On 24 October an authenticated direct project-scoped templates
  link, normal Microsoft sign-in/return and full page reload retained the exact
  TECH72 project UUID and displayed only its two synthetic templates. Do not
  treat the earlier observation as a currently unresolved defect.
- No migration, existing-unit update, signature, payment, template approval,
  appendix association, SharePoint write or other pilot business mutation.
  The isolated local PostgreSQL instance was stopped after the final tests.

The positive multi-service generation test is automated and uses in-memory
Graph/persistence ports. The live checks above verify deployment and fail-closed
preparation, not a newly approved-original SharePoint write/browser generation.
The full objective remains incomplete until content approval, authoritative
data/appendix preparation and the actual RS-to-SBK end-to-end run are complete.

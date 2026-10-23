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
once actually observed. No migration or frontend source change is required.

# Original RS generation capability

## Authorization and scope

Adam confirmed on 25 October that the already supplied parameterized RS/SBK and
appendix package are approved as written. See the exact-file approval record.
This package changes no Word bytes, legal sentence, financial calculation,
existing document version, signed snapshot, project selection or DB approval.

The existing 32-field RS original profile now supports the existing business
mapper → strict renderer → upload-service → SharePoint pipeline. The separate
38-field SBK delivery v2 remains supported. The older 37-field SBK stays review
only; no existing schema silently changes meaning.

Capability is not per-version approval. Original-profile readiness now requires
an explicit approved status even if a replacement repository omits that field.
The generation service's independent approved-version check remains in place.
The existing authorized lifecycle must still validate and approve the immutable
project/tenant version. No automatic approval or broadening of RBAC is added.

The existing profile picker derives its explanatory text from the same catalog:
RS and SBK v2 upload as concepts and require explicit approval of a specific
version. Existing default RS and old SBK semantics are unchanged.

## Evidence

- 516 backend tests passed, zero failed/skipped, including real local PostgreSQL
  concurrency, RLS, tenant/project isolation and signature/payment invariants.
- 143 frontend tests and 126 interaction tests passed.
- Frontend typecheck, backend production build, changed-file lint, frontend
  production build and diff checks passed. Existing bundle/route notices remain.
- New multi-service RS tests render the actual original-based 32-field source,
  require six exact appendices, bind the generated document/version, preserve
  its snapshot, replay idempotently and recover from DB failure after upload
  without another physical copy. Graph and persistence are in-memory ports in
  those specific tests; this is not an original-profile live E2E claim.
- Missing/undefined/draft approval, a missing final appendix and a closed case
  reject generation before upload. General-generation tests independently reject
  every non-approved original RS/SBK v2 version. Template management still uses
  its existing explicit lifecycle, rather than approving during upload/preview.
- Exact RS template SHA-256 remains
  `6d5265703063e33632450921cfeac1388a7004ec6483bf7149e4ee9f89b50886`.
- Exact SBK v2 template SHA-256 remains
  `2d320d0331e0c17f9d3e37c601420b54077da53f2e99eb0b2b0be0d51774af50`.

No migration is required. Deployment, actual project-template activation and
live original-profile generation are not established by local tests and must be
recorded only after they occur. The prior passed TECH72 synthetic chain is
separate evidence, not a substitute for the approved original-profile test.

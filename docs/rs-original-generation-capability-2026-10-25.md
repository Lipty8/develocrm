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

## Deployment evidence

- GitHub implementation `1f3d65bd9e6f7e0b6f193b629c49474d324e4fab` pushed.
- ACR build `cg51` succeeded; API image digest
  `sha256:4fec3d87a7d815d30ddfed471232c93139facb59a0b048495f708296ee41ffa0`.
- Revision `ca-develocrm-api-pilot--rs-original-1f3d65b` is Healthy/Running,
  provisioned and latest-ready with 100% latest traffic. `/health` and `/ready`
  returned HTTP 200, database reachable. Azure CLI update polling lost its
  connection; authoritative follow-up checks confirmed successful deployment,
  so the update was not repeated.
- Sites 164 succeeded with commit `7a1071aba2c623d666182fabab420d7cbea2ad2d`;
  its source tree `9d3da1853abcb6f7b76be2dc52d9611608d741a1` matches GitHub
  exactly (563 tracked files). Owner-only private audience preserved.
- Authenticated browser reload loaded the actual Dejvice template view.
- Original RS source uploaded through the normal UI/upload service to SharePoint
  as a new concept (32 fields), not over an existing technical template.
  Downloading that exact stored version produced hash
  `756458ea3a07c0b9c7fb0dd2be4267e7ff01b78a95031df2bbdc5faefa547689`.
  A complete ZIP-part comparison found every `word/` part byte-identical to the
  approved source, no missing parts; differences were SharePoint custom XML,
  custom properties and added ZIP trash parts. No legal text/layout part was
  changed by this upload. The persisted template hash correctly pins the actual
  SharePoint bytes rather than pretending the original ZIP hash is unchanged.
- Console-log retrieval failed with a connection reset; no clean-log claim is
  made from that failed observation. No migration or real deal mutation occurred.

## Approved project versions

The user-approved legal source profiles were uploaded, validated and explicitly
approved through the authenticated Adam UI for Rezidence Dejvice. RS v1 has 32
fields, SBK delivery v2 profile v1 has 38 fields. Existing technical versions
were not replaced or retired. This changes template configuration only; no
actual sales case or signature was created.
Authenticated full-page reload subsequently showed both RS and SBK as Active v1;
the RS detail retained its approval timestamp and persisted hash.

SBK persisted source hash:
`29d60ffb5ea16ca8c19aa7ed5b1fa2bcd718f59bdbc10f3bfbe53cf3b8c995af`.
The downloaded stored SBK was compared against the approved input: every
`word/` part is byte-identical, no source part missing. Only SharePoint custom
XML/properties and added ZIP trash parts differ. The application pins and
validates the persisted native version/hash for each template.

Content approval of the appendix package is recorded. It does not prove each
required appendix already has a verified CRM mapping, resolve the prior
standards-PDF security stop, authorize guessed missing files, or establish
original-profile generation E2E. Those gates must remain enforced; this is not
a claim that both legal workflows are ready for unrestricted production use.

# Contract generation validation transport

## Reproduced defect and correction

`RsGenerationService.generate` already refused incomplete CRM data with
`RsGenerationError('not_ready', issues)`. Both generation routes sent those
issues, but the global Fastify `preSerialization` error mapper replaced the
envelope and discarded them. The frontend repository consequently received only
a generic error, despite supporting `issues[].message`. The preparation panel
also retained its earlier `ready` result after the refused generation.

The existing mapper now preserves explicitly server-constructed validation
issues for HTTP 422 only. A private WeakMap brand prevents arbitrary JSON,
request payloads or diagnostic errors from opting in. Output is limited to
bounded code/field/message/internal-action fields; SQL details, external links,
extra properties, and 403/500 diagnostic data remain excluded. Generation uses
the same issue-to-CRM-action mapper as readiness. Both `/generate` and the
compatibility `/generate-rs` route use the same safe transport.

After generation failure the existing panel reloads readiness, retaining the
generation idempotency key. Changed data can no longer leave the old ready CTA
as the final displayed state. No new endpoint, document model or workflow engine.

## Verification before deployment

- Backend: 415 tests total, 411 passed, 0 failed, 4 optional native PostgreSQL
  suites skipped. This package changes no SQL, migrations or lock ordering.
- Frontend interaction: 112 passed, including ready -> server refusal -> new
  missing-data result, correction link and removed generation CTA.
- Frontend static regressions: 143 passed.
- Actual Fastify route injection covers authentication-hook boundary and global
  serialization for both generation routes, trusted 422 issues, correlation ID,
  ignored request-supplied issues and safe generic SQL-error response. IAM and
  generation-service boundaries are mocked; this is not a live DB/Graph test.
- Frontend typecheck, backend production compilation and changed-file lint pass.
- Frontend production build passes; existing bundle-size and route-analysis
  warnings remain. No dependency/lockfile changes.

No legal text, template approval, payment calculation, RBAC/RLS, SharePoint
permission, pilot business data or existing document version is changed. No
migration is needed. Original RS/SBK profiles remain review-only. Successful
production legal generation/signature is not established by these tests.

## Remaining original-contract readiness gates

The source RS is still inconsistent about fee credit: III.2 credits the first
part while IV.2(b) credits the final balance. The selected SBK final-balance rule
is retained; the legal original is not rewritten by this package. Updated RS
content requires separate review. The complete accessory variant, project legal
facts and referenced appendix package also require their existing content/data
checks before activation. No approval blocker is bypassed.

## Deployment and live verification

- Implementation: `f5ed2b27f180fe5d6b37befedf02137dbc9d18a3`, pushed to private
  GitHub main. Unrelated pre-existing untracked reports were not included.
- ACR run `cg4j` succeeded. Backend image `develocrm-api:validation-f5ed2b2`,
  immutable digest `sha256:5ade2f2275fc18106a026908008690c60e69d5176c1b4974b87bd5fbff05362a`.
- Revision `ca-develocrm-api-pilot--validation-f5ed2b2`: active, Healthy, Running,
  latestReady; liveness/readiness enabled. `/health` and `/ready` both HTTP 200.
  Previous healthy revision retained. No migration executed; latest schema 0067
  is not changed by this package.
- Official Sites helper built and pushed `db930d620a3d9c548a2b5a9b4583fabb4cb7ba45`.
  All 527 tracked files match implementation; both Git trees are
  `7f9c3ae883864a75e2a0ca0812df04627f7859ef`. Archive-backed private publication
  succeeded as Sites 158, deployment `appgdep_6ad864b9d4e08191a63f7089b994a19f`.
  Owner-only custom access remains unchanged, zero external viewers.
- Authenticated read-only browser smoke on existing technical SBK
  `TECH60-BLOCKED-SBK`: detail/reload, repeated readiness check, concrete missing
  fields, internal buyer correction link and return-to-contract link. No generate,
  signature, payment, upload, approval or business-record mutation was submitted.
  The original profile is intentionally unready: the generation-POST 422 and
  stale-ready transition are proven by actual-route/interaction regressions,
  not falsely claimed as a production generation E2E.
- First bounded 15-minute new-revision log query: 28 completed requests, zero
  queried HTTP 5xx, DB/RLS or startup errors. This is not a lifetime-error claim.

The broader RS/SBK production-readiness goal remains open. Legal-template
activation and complete original-profile generation/signature E2E are not done.

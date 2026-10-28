# External contract upload: lost-response retry

## Reproduction and root cause

The first external upload creates a document and binds it to the contract. The same request, replayed after this binding, previously inferred the upload target from the latest contract document. A request originally classified as `create` thus became `version`. The generic upload service correctly rejected this changed request hash with `idempotency key payload mismatch`.

The defect was reproduced through the actual local database/upload/binding pipeline, not inferred solely from source. It fails the same-key retry immediately after the first successful upload.

## Minimal correction

The authorized contract lookup now also reads the existing upload reservation by tenant, project, contract UUID and idempotency key. Retry reuses only its original `existingDocumentId` target. The existing upload service still validates the complete request hash, bytes, filename and business links; no second uploader, new table, migration, permission or idempotency bypass is added. Signed/closed-contract upload restrictions are unchanged.

## Tests

- Lost successful response after initial upload: same document/version/binding, replay true.
- Deliberate new business version and its retry: same SharePoint item, exactly two native versions for two intentional uploads.
- Retry of the old first request does not restore it as current.
- Changed bytes or another contract under the same key are rejected without a new file.
- DB binding failure after successful physical upload resumes without another upload, with one binding audit.
- Existing signature, sensitivity, tenant/project and signed immutability tests remain intact.
- Native PostgreSQL + PGlite: 46 targeted tests passed, no skips. Backend build, frontend typecheck and lint passed.
- Broad backend: 493 passed, 10 environment-dependent skips. The separate pending cross-unit appendix rejection reproduction was explicitly filtered, not declared fixed.

## Planned pilot verification

An explicit one-execution operator can prepare only a new TECH80 / unit 7480 fixture inside the previously audit-marked TECH74 project. Unit/client/hold/draft RS creation shares an atomic transaction, with exact project UUID, owner marker, non-bypass runtime-role and system permission checks. It neither signs a contract nor records a payment. Existing real cases are outside its allowlist.

The browser will upload a visually verified, one-page, nonlegal PDF. Verify mode requires that exact completed browser upload and its SHA-256 before performing two identical retries through the existing service. It checks one native SharePoint version, one contract version, one operation and one binding audit, plus exact bytes. Existing approved originals and actual contracts are not test inputs.

PDF: `output/pdf/TECH80-external-upload-retry.pdf`, SHA-256 `bba833ff38479a586d456a06a3d8ede7403ff30464cff3c8cca5411900c3a2d4`. It contains no client identity, legal terms or payment instructions.

## Pilot result, 28 October 2026

Retry fix commit: `c538beb7b3aeaca9e62cb7672c6e547875c4e94e`. During preparation, a separate initial-price transaction-time defect was reproduced and fixed in `ba6de44397843fd450aec3f07954b96729906bd6`; see the separate initial-price report. Failed preparation transactions did not reach upload.

Active backend: `ca-develocrm-api-pilot--initial-price-ba6de44`, image digest `sha256:a9ecf6c50377e65c1d251b717e1e2272a63855ce0bcc416e99063e0dedcab5de`, ACR run `cg5n` succeeded. Revision Healthy/Running, latest equals latestReady, 100% latest traffic. `/health` and `/ready` both returned 200 after cutover. Liveness/readiness configuration retained. A bounded 102-record console sample contained zero startup/5xx/RLS error signals, not a claim about all historical logs.

Private frontend remains Sites 184; no frontend publication or migration was needed for these backend-only changes.

Preparation execution `job-develocrm-hold-expiry-qjmgfyv`: Succeeded. It created only the explicitly marked TECH80 unit 7480, synthetic buyer, pre-reservation and draft RS inside owned TECH74. Authenticated browser upload of the nonlegal PDF succeeded; the UI displayed `Dokument připraven`, version 1 and the expected filename. Reload showed the same document and version.

Verification execution `job-develocrm-hold-expiry-6e13wao`: Succeeded. Two replays used the browser's persisted request key; exact downloaded bytes matched the PDF SHA-256. One SharePoint native version, one contract version, one completed upload operation and one binding audit remained. Zero signatures and zero payment obligations. The technical artifact remains clearly labelled; no real pilot case was changed.

CRM evidence: contract `7b5bbc34-0daf-4eee-83d8-1a50a31bb408`, document `12c52bc9-4f08-4820-9492-28a9f230bdb0`, document version `7ad0a87e-00be-427f-a8cd-a03f622763de`.

No rejected 0080 migration is included; its approval boundary remains in force. This successful upload check does not establish general RS/SBK production readiness or resolve the independent appendix-isolation gap.

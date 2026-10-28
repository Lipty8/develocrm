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

Rollout, browser upload and live verification are pending. No rejected 0080 migration is included; its approval boundary remains in force.

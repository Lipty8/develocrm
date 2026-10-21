# Final contract DOCX validation

## Reproduction

Before this change, the external-contract service rejected recognized
`{{buyer.name}}` tokens (misclassified by its catch as `invalid_final_docx`), but
`{{buyer name}}`, `[doplnit]` and `[●]` reached the database boundary. The existing
strict DOCX inspector already recognized malformed and legacy placeholders;
the final-file validator checked only its `tokens` array. This is an isolated
reproduction, not a claim that a real incomplete pilot contract was signed.

## Correction and boundaries

- Use that same inspector's tokens, malformedTokens and legacyMarkers before
  external upload. No separate parser, template model or upload service.
- Preserve the typed `unresolved_document_fields` error instead of catching it
  as a corrupt ZIP. User receives a Czech instruction to complete the fields;
  uploaded content/marker values are not logged or returned in diagnostics.
- Both signature routes and document-readiness use `signableFile`: existing
  authorization, exact native version, existence and hash checks first, then
  final-file validation on those exact bytes. The MIME type comes from the
  immutable upload operation, never from a signature request.
- Previously stored unsigned documents are also checked. A new upload is not
  the only gate. Existing signed evidence is not retrospectively reclassified;
  already signed retries retain their existing DB idempotence and constraints.
- Exact historical download remains a separate read operation and is not
  blocked by the new content check. No existing bytes, versions or snapshots
  are rewritten, and no backfill, migration or pilot-business edit is needed.
- Frontend preserves the safe server error, selected file and retry key after
  rejection. No successful mutation/invalidation notification is emitted.

This detects the existing supported syntactic placeholder classes, not every
possible human omission. It is not legal review. PDF content is not OCRed or
newly parsed; its existing format checks remain unchanged. A privileged direct
SQL caller still has DB metadata/integrity enforcement, not a Word-content
parser inside PostgreSQL. No claim of preventing every possible legal error.

## Automated verification

- 40 unresolved-marker/Word-part combinations (8 marker classes x main text,
  header, footer, footnotes, endnotes) rejected before DB/storage.
- Clean ordinary text and bracketed prose accepted by content validation;
  corrupt DOCX rejected. Stored unsigned content rejected before signing;
  historical read and already-signed retry preserved.
- Actual Fastify routes for both signature operations and readiness reject
  unresolved content without calling the commercial mutation. Exact-download
  route remains HTTP 200. Boundary mocks are explicit; this is not a live
  production signature test.
- Existing SQL/Graph-fixture evidence test now calls the same pre-sign method
  and proves MIME comes back from the operation. Full backend: 419 total,
  415 passed, 0 failed, 4 optional native PostgreSQL suites skipped.
- Frontend interaction includes rejected upload, Czech message, retained file
  selection and identical retry key. Full interaction: 113 passed. Static
  frontend regressions: 143 passed.
- Frontend TypeScript, backend production compilation, changed-file lint and
  production frontend build passed. Existing chunk/route-analysis warnings
  remain. No dependency changes.

Original RS/SBK remain review-only. Appendix package completion, original legal
content approval and full production legal-generation/signature E2E remain open.

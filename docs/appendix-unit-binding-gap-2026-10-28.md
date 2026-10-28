# Confirmed appendix unit-binding gap

Read-only source review followed by isolated database reproduction after release 21462ae.

`app.set_contract_appendix` validates tenant, project, exact ready document version, upload evidence, permissions and immutability, but not the document's existing `unit_documents` applicability. The picker also lists all project documents.

Reproduction in `backend/tests/contract-appendices.test.ts`: create a ready document through reserve/record/finalize upload; explicitly link it to another unit in the same project with `app.link_document_to_unit`; try selecting it as RS appendix 1 for this contract. The request succeeds when it should reject `CONTRACT_APPENDIX_UNIT_MISMATCH`. The new regression fails with `Missing expected rejection`; test cleanup removes only its own local fixture link. No pilot contract was used or changed.

This is confirmed locally, not asserted as an observed incorrect pilot binding. It is not fixed in Sites 184 / backend 21462ae. The new red regression is intentionally uncommitted pending implementation.

Next implementation must cover selection, later changes to document/unit associations, readiness and generation/signature evidence, not just hide picker options. Shared project appendices without unit restriction must remain usable. Do not infer catalogue applicability from filenames. Preserve signed history and validate lock ordering; adding a document-link trigger without checking the existing unit → document lock ordering could introduce a deadlock. Audit existing associations read-only before any remediation.

## Read-only pilot audit

Execution `job-develocrm-hold-expiry-juddkxh` Succeeded on 2026-10-28. All 22 classified appendix links had unit associations; zero links were scoped exclusively to a different unit than their contract. No business records or SharePoint files changed. This proves the observed current links are consistent; it does not remove the reproduced future-selection defect.

## Prepared local presentation/readiness changes

The picker now uses existing `businessLinks` unit UUIDs, not `units` display codes. It offers current-unit documents and unrestricted project documents, excludes unknown scoped identities, and rechecks the returned detail after selection. Contract readiness independently marks selected foreign-unit documents unavailable using existing `unit_documents` UUID links. Tests cover a shared document, a correct unit, another unit with the same display code, missing identity metadata and a changed detail response.

These changes are not deployed and are not a substitute for server-side enforcement. The backend rejection regression remains red until the database guard is implemented.

Local prepared changes passed 199 frontend interaction tests, 28 related generation/appendix unit tests, frontend typecheck, backend TypeScript build, lint and production frontend build. The deliberately red database regression is excluded from the checkpoint commit, not treated as passing or removed. The active pilot remains backend 21462ae / Sites 184.

## Pending safety approval

Update: Adam explicitly approved implementation and tested deployment of the
extended database protection in reply to `call_cd833c6d413b4b789661a1bf23033363`.
The approval blocker below is historical. Implementation now proceeds as
migration 0080; see `appendix-unit-protection-2026-10-28.md` for current evidence.

Safety review rejected creation of the proposed 0080 migration before writing the file because it would add persistent guards to multiple lifecycle tables. No 0080 file was created and no such migration was applied. User approval was requested through the app. Do not retry or route the rejected migration through another executor without resolving that approval.

Proposed scope for approval: validate applicability at appendix selection; freeze unit association edits while the document is selected as an appendix (an editable selection can first be removed); recheck existing selections before generation, final-document binding and signature. Project-level shared appendices remain supported. Existing tenant/project/RBAC/snapshot/immutability checks remain in force. No silent historical repair. Unit-first selection and document-only metadata locks must be verified in real PostgreSQL tests in both operation orderings before deployment.

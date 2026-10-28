# Confirmed appendix unit-binding gap

Read-only source review followed by isolated database reproduction after release 21462ae.

`app.set_contract_appendix` validates tenant, project, exact ready document version, upload evidence, permissions and immutability, but not the document's existing `unit_documents` applicability. The picker also lists all project documents.

Reproduction in `backend/tests/contract-appendices.test.ts`: create a ready document through reserve/record/finalize upload; explicitly link it to another unit in the same project with `app.link_document_to_unit`; try selecting it as RS appendix 1 for this contract. The request succeeds when it should reject `CONTRACT_APPENDIX_UNIT_MISMATCH`. The new regression fails with `Missing expected rejection`; test cleanup removes only its own local fixture link. No pilot contract was used or changed.

This is confirmed locally, not asserted as an observed incorrect pilot binding. It is not fixed in Sites 184 / backend 21462ae. The new red regression is intentionally uncommitted pending implementation.

Next implementation must cover selection, later changes to document/unit associations, readiness and generation/signature evidence, not just hide picker options. Shared project appendices without unit restriction must remain usable. Do not infer catalogue applicability from filenames. Preserve signed history and validate lock ordering; adding a document-link trigger without checking the existing unit → document lock ordering could introduce a deadlock. Audit existing associations read-only before any remediation.

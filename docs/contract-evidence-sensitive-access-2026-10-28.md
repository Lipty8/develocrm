# Contract evidence: sensitive document authorization

## Confirmed defect

The ordinary document repository requires `documents.view_sensitive` for sensitive files. `ContractDocumentEvidenceService.evidence` previously checked only contract/document read permissions. Exact historical downloads, document readiness and pre-sign file verification reuse this method, so knowledge of exact contract/version IDs could bypass the extra sensitivity check.

A disposable PGlite reproduction created an ordinary restricted project reader, a real uploaded-and-bound contract document through the existing upload service, then classified the local fixture as sensitive. The ordinary document detail returned null, but contract evidence incorrectly returned a row. The regression failed with `Missing expected rejection` before the correction.

## Minimal correction

The existing evidence query now joins its exact document and applies the same `documents.view_sensitive` predicate. No new permission, role mapping, document model, migration, SharePoint write or workflow transition is introduced. Generic public errors remain unchanged.

## Verification

- Actual `develocrm_app` role and tenant/user context in both PGlite and native PostgreSQL.
- An ordinary file remains accessible with contract/document read access.
- Sensitive evidence, exact download and signable-file access are rejected without the additional permission, before any Graph access.
- The same reader succeeds after an explicit `permission_overrides` grant in the current project-area matrix, only in the disposable DB. Workspace administrator status alone is not treated as business-data access.
- All 44 targeted price/document integrity tests passed on PGlite and native PostgreSQL, with no skips.
- Backend TypeScript build, frontend typecheck and lint passed.
- Broad backend run: 492 passed, 10 environment-dependent skips. The separately documented pending appendix-unit rejection reproduction was explicitly filtered out, not treated as fixed.

## Read-only pilot classification audit

Execution `job-develocrm-hold-expiry-5kcp0hh`: Succeeded. Current contract-bound evidence comprised 16 document versions across 13 contracts, all labelled normal. Zero sensitive-tagged versions were found; zero file downloads or classification changes were performed. This is not a claim that files contain no personal data, nor evidence of exploitation or an exhaustive access-log audit.

Backend-only rollout is pending. The prepared appendix UI is not being published, and no rejected 0080 migration is included.

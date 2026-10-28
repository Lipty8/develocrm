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

## Backend-only rollout

- Commit `c265c5fcd73a2d38c6b443706cc88cf9fc161253`, pushed to private GitHub.
- ACR build `cg5k`: Succeeded. Immutable API image `sha256:1b1a11c71a822111938074fe47155f080f7ebded1f0e58f176401a92f825ef2b`.
- Revision `ca-develocrm-api-pilot--evidence-sensitive-c265c5f`: Healthy/Running, latestReady, 100% traffic. Health/ready each HTTP 200 after cutover; liveness/readiness probes unchanged.
- No migration: existing 0079 schema is sufficient. No 0080 file or rejected guard is included.
- Frontend remains private Sites 184. The pending appendix picker is NOT published. This release changes no API shape and is backward-compatible with that frontend; it is not described as a new matching Sites publication.
- Source includes the previously prepared readiness check from 882e5ce; this marks inconsistent appendix context unavailable but is not a substitute for the still-pending database enforcement.
- Successful bounded new-revision log sample: 102 records, zero matched 5xx/RLS/startup-error signals.

## Live verification

Execution `job-develocrm-hold-expiry-9w13qcy` Succeeded using the new matching image, verify-only against the existing TECH74 approved-original-profile fixture. Exact SharePoint hashes verified for RS v2 and SBK v1; signature audit/outbox, current commercial state and SBK installment state remained consistent. No new upload, generation, signature or payment was performed. Hash verification does not claim fresh visual inspection in Word.

Authenticated browser opened the existing signed TECH74 RS on Sites 184 and downloaded its exact Word successfully (`tech74-synthetic-rs-20261026085740 (1).docx` in the user's Downloads). No pilot business record changed. Sensitive-denial behavior was tested on disposable databases with a real restricted application role; it was not simulated by changing a real user's permissions or reclassifying a real pilot file.

The signed TECH74 SBK also opened and downloaded successfully through the authenticated CRM (`tech74-synthetic-sbk-20261026093644 (2).docx`). The UI retained its existing evidenced-signature version, installment balance and deferred final-notice state. No signature, notice, payment or generation action was submitted. Downloads are local technical test artifacts, not new SharePoint or CRM records.

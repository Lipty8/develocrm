# Approved original RS/SBK business smoke

## Scope

The existing TECH72 operator now supports an explicit `approved-original`
profile. It owns a separate TECH74 project and audit marker, never adopts a
real project by name, and uses the existing application role, RLS context,
inventory/commercial/document services and managed identity upload pipeline.
There is no new runtime endpoint, workflow engine or database migration.

Only the two content-approved inputs are accepted, pinned by SHA-256 and the
authoritative 32/38-field schemas. Every persisted `word/` package part must
match before the template copy can be approved in the owned technical project.
Office document-property normalization is not treated as legal-content change.

Preparation uses synthetic buyer/seller/unit/accessory data and clearly named
nonlegal technical appendices. These appendices prove binding and persistence
only; they do not prove that the real project's legal appendix package is ready.
The original-profile preparation returns readiness without generating the main
contract, so the authenticated browser can exercise the ordinary Generate action.
RS creation uses signature-based payment terms, not a hardcoded creation-date
deadline. No original legal wording is modified by this operator.

## Guards and local verification

- Explicit synthetic-data confirmation, active administrator, non-bypass
  application role and exact fixture ownership are required.
- TECH72 and TECH74 ownership markers are not interchangeable.
- Technical appendix input is pinned separately from the approved legal sources.
- 16 operator tests passed, including source substitution, Word-part fidelity,
  fixture isolation and the existing signed-chain/calendar checks.
- Changed-file lint and backend TypeScript build passed.

## Pilot verification

Pending. No claim of approved-original business E2E completion is made from
the local guards or earlier synthetic-placeholder template smoke.

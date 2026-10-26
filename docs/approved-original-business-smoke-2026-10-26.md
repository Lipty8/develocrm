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
- 17 operator tests passed, including source substitution, Word-part fidelity,
  fixture isolation and the existing signed-chain/calendar checks.
- Changed-file lint and backend TypeScript build passed.
- 48 related backend tests for RS generation, original snapshots, signature
  payment terms and exact appendix evidence/input also passed.

## Pilot verification

- Operator preparation commit `5fc43e3` pushed to private GitHub.
- First execution `job-develocrm-hold-expiry-afrph85` Failed before Node started:
  `argument list too long`. Both replicas terminated before database access.
  The one-execution launcher was corrected to pass bounded source/payload
  environment values rather than one oversized command argument. No role,
  secret model, job schedule or API image was changed.
- Preparation `job-develocrm-hold-expiry-ac05z4v` Succeeded, using the existing
  API image `sha256:4fec3d87a7d815d30ddfed471232c93139facb59a0b048495f708296ee41ffa0`.
  Owned project `cd3605bd-9ef7-461b-b3f2-54f0447fff60`, unit
  `ab05c2b9-f537-4f18-b2c5-d73c44a21c1a`, RS
  `f25f7eb4-b119-45c3-a90e-807f0efdb1e1` returned ready with no issues.
- Authenticated Adam UI showed the 5,000,000 CZK unit, 500,000 CZK accessories,
  5,500,000 CZK total, 250,000 CZK fee and three working days from the last
  required signature. No fee obligation existed before signature.
- The ordinary `Vygenerovat RS` action created document version
  `4a07f0a6-2bda-4807-aa8f-9142e0364e39`, bound to contract version
  `3f67e7d6-0612-4558-be39-a490cf791d54`. Browser download succeeded. All four
  pages were rendered with the bundled document renderer and inspected; no
  unresolved placeholder, clipped content or broken signature block was found.
- The generated version and approved workflow state survived full reload.
  No signature was recorded and no real deal was edited.
- Independent read-only execution `job-develocrm-hold-expiry-tfev2ax` Succeeded:
  exact native SharePoint hash, pinned template hash, 32-field snapshot hash,
  deterministic reproduction of all Word parts, six frozen exact appendix
  versions and their physical hashes, one generation audit and one outbox event.

## New discrepancy requiring a business choice

The approved original text labels the payment variable symbol as the apartment
number. The current plan command in migration 0066 instead strips digits from
`contracts.reference`. TECH74-RS-SYNTHETIC therefore produced symbol `74`, while
the actual unit is `7401`. The generated Word and payment snapshot agree with
each other, but not with that meaning of the legal label. This is not a renderer
or stale-cache defect. It is reproduced in the real approved-profile flow.

Adam was asked whether these RS/SBK profiles should use the exact numeric unit
code rather than the contract reference. No legal text, existing plan, payment,
signed snapshot or database function has been changed pending that choice.
The technical RS remains unsigned; the complete RS-to-SBK chain is not claimed.

Adam also explicitly deferred the three missing real appendix files. They are
not being searched for further in this package; technical appendix fixtures
remain distinguished from real legal-package readiness.

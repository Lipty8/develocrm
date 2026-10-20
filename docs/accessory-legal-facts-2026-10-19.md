# Canonical accessory rights for original RS/SBK preparation

Status: deployed; scoped authenticated save/reload and DB verification passed. Original legal profiles remain review-only and cannot be activated by this package.

20 October follow-up: manual accessory floor/location editing is now deployed
and browser/DB verified in migration 0067 / Sites 155. See
`docs/accessory-location-2026-10-20.md`. Historical pending notes below describe
the original 0065 checkpoint, not the current location-editing status.

## Model and behavior

- Migration `0065_accessory_legal_details.sql` adds nullable legal form and an optional numerator/denominator pair to the existing `accessories` table. No new inventory, commercial status, template or document model.
- Supported facts describe a cellar as a separate unit, an outdoor parking use right, or a garage coownership share. Physical category alone is not legal evidence. No backfill from codes, names, descriptions, inventory counts or buyer shares.
- The existing accessory edit action sends optional `legalDetails`; omitted data preserves existing values. The same transaction runs the authorized legal-details command and existing accessory update. A later price/code failure rolls back legal facts and audit/outbox too.
- Existing `accessory.manage`, active membership, current actor, tenant and project checks remain server-side. Category mismatch, incomplete/invalid fraction and direct uncommanded changes are refused. Repeating identical legal details emits no additional legal-details audit/outbox event. The preexisting generic accessory edit still records its normal edit audit; this is not a claim of global mutation deduplication.
- Catalog and original-contract source projections return explicit canonical facts. Existing old-schema inventory reads return null rights rather than inventing them. Writes require migration 0065.
- Project inventory uses its existing detail/edit modal. Czech legal-form labels and optional garage fraction are available without a new administration screen. Readiness links point back to the corresponding project inventory.
- Original RS uses its existing `1 / final number of stalls` formula and requires explicit garage coownership, not an invented final denominator. If supplied, the share numerator must be 1. The pinned original SBK profile additionally requires its fixed 1/25; another fraction needs an appropriate separately reviewed template, not automatic legal-text modification.
- The strict scalar mapper independently refuses missing/incompatible legal facts; readiness is not the only guard. Template approval and `generationSupported:false` remain unchanged. Existing signed documents, snapshots, assignments and prices are not rewritten.

## Verification

- Focused schema/normalization/RS/SBK/field interactions: 31 passed.
- Final full backend: 374 passed, four optional native suites skipped. Final targeted native PostgreSQL/PGlite evidence suite: 23 passed, no skipped tests, including isolation, category mismatch, atomic rollback and audit/outbox retry behavior. Eight concurrent updates over the real runtime Database connection pool produced exactly one legal-details audit/outbox event and the correct final share.
- Frontend regression suite: 143 passed. Final complete interaction suite: 82 passed, including the whole accessory edit modal and its invalid-fraction pre-submit guard.
- Frontend/backend typechecks, targeted lint and production builds passed, including a repeated build in the official Sites checkout. The final navigation correction passed 29 focused contract tests and the complete backend suite.
- Early test fixture mistakes (missing accepted membership timestamp and wrong custom-access area name) were corrected to match real constraints; no constraints were weakened. An old block-B read fixture exposed direct references to newly added columns; the catalog now reads nullable facts through the existing row JSON, preserving old read compatibility without guessing facts.

## Remaining production gates

- Scoped authenticated browser save/reload smoke passed as documented below; this is not an original RS/SBK production-generation acceptance test.
- No real accessory records have been populated or changed. Their legal facts require authorized source data.
- Original legal template activation, signature-anchored payment-policy integration, complete-variant data and separate human content approval remain open.
- Accessory floor/location is already stored, but the current edit form does not yet let users complete it. This remains an actionable field-gap for full original-template preparation, not a reason to invent floor values.
- No Word file or legal paragraph was edited in this package. No production RS/SBK readiness signoff is claimed.

## Deployment

- Source commits `3234bc10714b11db9e69c66c822b23313886b9d2` and final navigation correction `cc5f0dd` pushed to private GitHub main.
- Official Sites helper final commit `02ee95520583ca188f4f0c6c614c61b0d92dcade`; tree `8e295cf3a3127dc48ab16081fa8869f47fdb165f` exactly matches GitHub. All 496 source files were byte-compared before the navigation correction; final helper tree verified identical after it. Clean Sites checkout.
- Private Sites 151, deployment `appgdep_6ad60ec0e0e881919993378bb91dac10` succeeded, version `appgprj_6a5f2c904d308191a901be8e347ea76f~appgver_12f1f408c4248191be17626c743856c8`. Existing custom owner-private audience unchanged.
- ACR final API build `cg47` Succeeded; `develocrm-api:accessory-legal-cc5f0dd`, digest `sha256:b1c91a0bc52393d309d337f2522b1a16111ba0782b15cba87980db9411822871`.
- ACR migration build `cg45` Succeeded; digest `sha256:59fb1e4c3fb22ef768fdd4b3da3b892875d16694abf04bb97b25607a50c03de3`. Migration source unchanged by final navigation commit.
- Read-only baseline job `caj-develocrm-migrations-pilot-wrbrvta` Succeeded and confirmed 0064. Migration execution `caj-develocrm-migrations-pilot-tnrplw4` Succeeded and logged only `Applied 0065_accessory_legal_details.sql`.
- Read-only postcheck `caj-develocrm-migrations-pilot-396ot04` Succeeded; latest 0065 checksum `09ca00dacfa89ec212a39080e689ff09eab5f7cb382c5b18e3984a50ff0e6971`, all three new columns confirmed. Existing Key Vault secret reference retained; no secret value read or printed.
- Final backend `ca-develocrm-api-pilot--accessory-legal-cc5f0dd` Healthy/Running/latest ready, 100% latest traffic, probes retained. `/health` and `/ready` 200.
- No security approval bypass: source helper owns Sites Git/packaging. Its generic build wrapper rejected historical mixed lockfiles; they were preserved and the already tested direct Vinext build was used inside the official helper. Initial API ACR `cg44` failed because sanitized context omitted backend/tsconfig.json; adding the exact committed config fixed it. One upload reset created no run (verified in ACR before retry); Azure CLI polling also reset after successful update, so the actual existing revision was inspected rather than redeployed blindly.
- Initial postdeploy observation: 52 completed requests, zero 5xx, zero RLS/server errors for the final revision. This is only the observed window, not a permanent error-free claim.

## Authenticated pilot verification

- Used only existing technical project `6c1ccb03-122d-4e32-8d6d-6f6faa12b019`. Created two clearly labeled, unassigned technical items at 1,000 CZK each: `TECH65-LEGAL-P` and `TECH65-LEGAL-S`. No real inventory, unit 417, contracts, signatures or payments were changed.
- Browser saved the cellar as a separate unit, then a full reload and reopened detail showed `Sklep jako samostatná jednotka`.
- Browser selected garage coownership for the parking item. An incomplete fraction (numerator only) showed the Czech validation error and left the modal open. Completing 1/25 saved successfully. A full reload and reopened detail showed `Spoluvlastnický podíl na garáži · 1/25`; reopening edit correctly prefilled 1 and 25.
- Visual inspection of the actual pilot modal confirmed readable labels, complete controls and no horizontal overflow at the observed viewport. Screenshot was emitted inline by the browser tool. Local screenshot-file export remained unavailable in the browser sandbox even after a write grant; no nonexistent screenshot file is presented as an artifact.
- Read-only execution `caj-develocrm-migrations-pilot-9xaalgf` Succeeded. Parking ID `fa4ecf13-6076-45cf-8e92-cf8a5d52059e`: garage_coownership, 1/25. Cellar ID `f34bb5e8-d59d-4c32-a71d-9505413d324f`: cellar_unit, null fraction. Both had exactly one price-history row, zero assignments, one legal-details audit and one corresponding outbox event. No synthetic legal facts were inferred for existing items.
- Final `/health` and `/ready` were 200. Technical artifacts intentionally remain clearly named; no destructive cleanup or real-data archival was performed.
- Existing workspace-wide mutation invalidation still causes unnecessary loading; not confused with failed persistence. Accessory floor editing and simpler cellar-specific help copy remain follow-up UX/data-completion work. Signature-anchored payment persistence is the next blocking original-contract integration package.

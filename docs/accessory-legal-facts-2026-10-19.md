# Canonical accessory rights for original RS/SBK preparation

Status: implementation and local verification; not yet deployed. Original legal profiles remain review-only and cannot be activated by this package.

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
- Full backend after compatibility correction: 373 passed, four optional native suites skipped. Final targeted native PostgreSQL/PGlite evidence suite: 23 passed, no skipped tests, including isolation, category mismatch, atomic rollback and audit/outbox retry behavior. Eight concurrent updates over the real runtime Database connection pool produced exactly one legal-details audit/outbox event and the correct final share.
- Frontend regression suite: 143 passed. Final complete interaction suite: 82 passed, including the whole accessory edit modal and its invalid-fraction pre-submit guard.
- Frontend/backend typechecks, targeted lint and production builds passed. A final check is required on the exact committed tree before publication.
- Early test fixture mistakes (missing accepted membership timestamp and wrong custom-access area name) were corrected to match real constraints; no constraints were weakened. An old block-B read fixture exposed direct references to newly added columns; the catalog now reads nullable facts through the existing row JSON, preserving old read compatibility without guessing facts.

## Remaining production gates

- Pilot migration/deployment and authenticated browser save/reload smoke remain required.
- No real accessory records have been populated or changed. Their legal facts require authorized source data.
- Original legal template activation, signature-anchored payment-policy integration, complete-variant data and separate human content approval remain open.
- Accessory floor/location is already stored, but the current edit form does not yet let users complete it. This remains an actionable field-gap for full original-template preparation, not a reason to invent floor values.
- No Word file or legal paragraph was edited in this package. No production RS/SBK readiness signoff is claimed.

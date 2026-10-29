# Contract termination: accurate refund guidance

## Observed defect

The paid-contract termination dialog claimed that “Vytvořit vratku” sends
money. That contradicts the existing ledger-only refund workflow. The payment
detail and refund form already explain that CRM does not transfer money.

## Focused correction

Only the guidance in `ContractWorkflowModal` changes:

> Rozhodnutí určí částku k vrácení. Provedenou vratku pak zaevidujete v detailu
> platby. CRM peníze neposílá.

No calculation, permission, state transition, API, transaction, allocation,
refund, audit, idempotency or database definition changes. No migration or
backend deployment is needed. No business data is changed for this package.

## Verification

The new interaction test failed against the old text, then passed after the
correction. It verifies both the accurate guidance and unchanged behavior:
missing refund decision prevents submission; an explicit partial decision
submits the original obligation ID, amount, transition and idempotency key.

- 215 frontend interaction tests passed, zero failures/skips.
- 145 frontend static tests passed, zero failures/skips.
- Frontend TypeScript, lint and production build passed.
- Existing large-bundle/code-generation and route-classification build notices
  remain; no new package dependency was introduced.

The test fixture is fully typed. Its first incomplete fixture was rejected by
TypeScript and corrected before these checks passed; type safety was not relaxed.

This is a small UX safety correction, not completion of RS312's missing actual
facts, applicable reviewed variant or deferred source documents.

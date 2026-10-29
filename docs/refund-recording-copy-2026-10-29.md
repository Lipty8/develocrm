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

## Published verification

- GitHub source `12fe076772244f78b20a2cd79df11488c44afc5c`, pushed to main.
- Official Sites workflow opened an isolated checkout from the existing remote,
  then built and pushed `1027282ddd02e66066ff786076fb426ff53eea71`.
  All 641 source files matched; both Git trees were
  `0dc1affb3672eafb1171da733e8938e2732c899c`, no extra source files.
- Private Sites **188**, deployment
  `appgdep_6ae3c23bc5e881919b2d98253e5eec44`, Succeeded.
  Owner-only audience preserved, environment revision 3 unchanged.
- Backend remains `ca-develocrm-api-pilot--readiness-7dedd5b` with migration
  0083. Health and ready each returned HTTP 200. No backend image was rebuilt.
- Authenticated browser reloaded the published app, opened the existing
  TECH74-RS-SYNTHETIC paid-contract workflow and displayed the new exact text.
  The confirmation stayed unchecked; no reason or refund decision was entered.
  “Zrušit” closed the dialog without saving. This was a read-only smoke test;
  no signature, termination, payment or refund was submitted.

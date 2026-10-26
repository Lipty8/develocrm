# Unit creation: grouped Czech price input

## Runtime reproduction

Authenticated pilot UI, owned synthetic project TECH74, unit 7402:
entered `5 100 000` in the price field (the form itself suggests this format).
Creation succeeded but the list showed a missing unit/total price, also after reload.
No real project or historic commercial record was changed.

The create form used `numberValue`, which passed the grouped string directly to
`Number`. Conversion failed, returning `undefined`; the form did not reject it,
so the API received no price. This is a form parsing defect, not a missing backend
initial-price writer. Existing canonical price history remains unchanged.

## Fix

- Reuse the existing numeric input helper, stripping whitespace (including Czech
  grouping NBSP/narrow NBSP), accepting comma decimals and rejecting nondecimal syntax.
- Explicitly reject an entered invalid/negative price before making a request.
- Distinguish blank price from a stored zero.
- Reject an entered invalid usable area instead of silently omitting it.
- Preserve the existing creation idempotency key across retries.
- No backend, schema, permissions or pricing projection changes.

## Checks

- TypeScript: passed.
- Interaction suite: 156 passed, 0 failed/skipped (13 added form cases).
- ESLint: passed.
- Production build: passed (existing large-chunk/Babel warnings only).
- Static regression suite: 143 passed, 0 failed/skipped.
- Targeted price/document backend suite: 21 passed, 0 failed; native PostgreSQL
  variant skipped because no external test database was configured. PGlite covers
  initial zero/nonzero price, single history entry on retry, changed-payload
  rejection, subsequent price change and canonical current-price projection.

## Published verification

- GitHub implementation `6550bfe0275c8959c25515d4bf0056539405105c`.
- Sites 171, source `ca19d91141bc3c1caa4d0e44ee648014de374574`;
  exact source tree matches GitHub: `3013221dadc49baca15342e4d151f93a8724ff2e`.
- Deployment `appgdep_6adfc07f71e481918ba99bbdf3801874`: succeeded,
  unchanged owner-private audience, no external visitors.
- No migration or backend deployment. Existing backend `/health` and `/ready`: 200.
- Authenticated UI: invalid text price rejected with Czech validation, no creation.
- Corrected input on the same form: unit 7403 created once with `5 100 000`.
- After full reload, the project list and unit detail both show 5,100,000 CZK.
- Price history UI contains exactly one entry: initial unit price 5,100,000 CZK.
- Technical unit UUID: `c6fdff2d-b304-4df9-a8fb-688c50ee8703`.
- Original reproduction unit 7402 remains unpriced as evidence; no retroactive
  price correction or real project data change was performed.

## Adjacent client workflow smoke

On 7403, authenticated Adam used `V jednání` → create new client → continue.
Synthetic client `TECH74 NOVY TEST 7403`, `example.test` contact only, was saved
without the old party-scope/update-permission error. The unit immediately showed
the current buyer, interest history and a hold until 28 October 2026 22:07 Prague.
After full reload, buyer and hold remained. Opening the client card reached
`688bea88-2ddb-4d7f-8ba3-ce5be5955cd7`; its project/unit link points back to the
exact unit UUID and its interest history shows the same active negotiation.
No real buyer, agreement, payment or project was mutated.

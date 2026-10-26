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

Live verification of the fixed release is recorded separately after publication.

# Initial unit price: transaction visibility

## Runtime finding

The technical external-upload fixture failed in `create_contract`, SQLSTATE `P0001`, safe code `PAYMENT_TERMS_FEE_REQUIRED`. No upload was attempted. Unit, party, hold and contract preparation shared one transaction; the failed transaction rolled back. An earlier read-only check confirmed zero owned fixture units, parties and markers.

The inventory service used `clock_timestamp()` for initial price validity. A downstream contract snapshot uses transaction time (`now()`), which is earlier. Consequently a unit created with a real positive price was seen as zero by the contract snapshot in that same transaction, rejecting even the synthetic 1 CZK fee.

## Reproduction and minimal fix

A new regression creates a priced unit through the existing inventory service in one transaction, reads its canonical price at `now()`, then creates a pre-reservation and signature-timed draft RS. Before the fix the price assertion failed (`0` instead of `2500000`) on both PGlite and native PostgreSQL.

Only an initial price now starts at `transaction_timestamp()`, matching the creation transaction and existing domain snapshots. Later price updates retain `clock_timestamp()`; approval, history, idempotency and audit paths are unchanged. No migration or historical data update is needed or performed.

## Verification

- Native PostgreSQL and PGlite price/document suite: 48 passed, zero skipped.
- Includes same-transaction positive-price contract snapshot, initial zero/nonzero price, creation retry and subsequent history.
- Broad backend suite: 494 passed, 10 environment-dependent skips, zero failures. The separately pending cross-unit appendix rejection test was explicitly excluded, not declared fixed.
- Backend build, frontend typecheck, lint and production frontend build passed. Existing bundle-size and Babel notices remain.
- Production rollout and completion of the live external-upload test are separate verification gates; passing local tests does not establish live upload success.

The independent cross-unit appendix guard remains pending approval and is not part of this change.

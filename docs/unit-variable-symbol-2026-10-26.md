# RS/SBK variable symbol — 2026-10-26

## Confirmed decision and defect

Adam confirmed that approved RS/SBK payment profiles must use the exact numeric
unit code. The live TECH74 original-profile RS exposed `74` (digits extracted
from contract reference `TECH74-RS-SYNTHETIC`) instead of unit `7401`.

## Correction

- Additive migration 0072 replaces only the canonical preparation calculation:
  tenant + project + unit UUID resolve `units.code`, preserving leading zeroes.
- Nonnumeric unit codes fail closed with a safe Czech validation message. No
  digit stripping, guessed reference fallback or request-supplied symbol.
- Explicit new business versions do not inherit an obsolete symbol. They
  require the existing payment preparation command before generation.
- Existing snapshots, documents, signatures, obligations and transactions are
  not backfilled or rewritten. No real historical deal is changed.
- Existing authorization, locks, audit/outbox, signature anchors and installment
  calculations remain unchanged.

## Verification

Targeted PostgreSQL and PGlite integration tests cover exact unit symbol,
leading zeroes, reference without digits, idempotent preparation, invalid unit
code rollback, retained old document/snapshot, explicit corrected version,
and matching RS/SBK symbols. Full regression/deployment evidence follows after
execution; this document alone does not assert pilot verification.

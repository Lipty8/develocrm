# Client-change current-buyer safety

## Reproduction and scope

On technical unit 7406, the canonical commercial context correctly showed buyer
B, but the new client-change dialog selected historical buyer A. Its candidates
combined current buyers with all historical unit relations, then selected the
first global client row. No record was submitted with A during reproduction.

The SQL create operation checked only active project membership for the party.
Its optional case lookup did not exclude departed participants and could insert
a null sales-case binding for a historical party despite another active sale.

## Correction

- The existing central commercial context now determines client-change choices
  whenever an active sales case exists. Only current buyer/co-buyer participants
  are eligible; canonical buyer ordering is retained. A missing readable buyer
  does not fall back to history.
- Additive migration 0077 adds a binding guard to client changes. Under the
  existing unit-first workflow lock and then active-case lock, it checks the
  selected party against current buyer/co-buyer participation. A valid party is
  bound to the exact current case; another case or departed/non-buyer party is
  rejected atomically. This applies to both existing create entry points and
  direct binding inserts/updates, without duplicating create/audit logic.
- Binding changes are guarded, not ordinary status/note/assignment updates.
  Existing records are not backfilled. Existing no-active-case/after-sale
  behavior is deliberately unchanged; this package does not introduce a new
  ownership or post-sale eligibility policy.
- Conflicts use a safe Czech message and correlation ID through the existing
  error mapper. No SQL/trigger detail is exposed.

## Verification before rollout

- 578 backend tests passed, zero skipped, with native PostgreSQL enabled.
- Current buyer and co-buyer; departed participant; representative; other-unit
  project-linked party; forged tenant/project; exact case binding; one audit and
  outbox; safe error mapping covered in PGlite and PostgreSQL.
- Two actual concurrent PostgreSQL sessions are proven to wait on the unit lock
  in both buyer-replacement/create orderings. A committed buyer replacement
  rejects the stale create; a create ordered before replacement preserves its
  historical party/case without duplicate events. No deadlock occurred.
- 194 frontend interaction tests and 145 static regressions passed, including
  the real new-change modal with historical A before current B in client order.
- Frontend typecheck, backend TypeScript build, lint and production build passed.

Rollout and authenticated browser proof will be appended after deployment.

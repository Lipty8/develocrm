# Dejvice: current operating readiness, 28 October

Read-only execution `job-develocrm-hold-expiry-r6dfp4c` Succeeded on matching
healthy backend `closed-change-29a9a5c`, image digest
`sha256:408e69eb5f78d9b38e231c0f40435aca7c44961b186e0c1533403010de710ece`.
Every repository transaction was forced read-only, under the existing
non-superuser/non-bypass application role, active membership and checked project
permissions. No Graph write, activation, data reconciliation or diagnostic-run
write was performed. Logs contain missing-field descriptions, not personal or
bank-account values.

## Current facts that supersede the 26 October report

- Project seller settings exist; all 12 required identity/contact/account/
  signature/delivery fields are present. The old missing-seller-settings gap is
  resolved, not an outstanding request for another approval.
- One active approved RS original profile (32 fields) and one active approved
  SBK original delivery-v2 profile (38 fields), effective 25 October. Central
  payment selection returns signature-based timing for both. They are not
  pending technical-template activation.
- All 50 active accessory records still have null canonical legal_form.
  Authoritative outdoor/garage mapping and actual shares remain deferred; do
  not infer them from labels or prices. P30's verbal outdoor confirmation does
  not justify guessing classifications for the remaining inventory.

## The existing real working RS is still not ready

DEJ-312-RS is sent, in an active sales case. Actual readiness returns false
with 20 issues, no seller-settings issue:

- Six exact appendix versions have not been selected.
- The approved complete wording requires a garden and specific cellar/garage/
  outdoor-parking configuration that this unit does not currently establish.
- Planned signing dates, payment reference and consistent payment terms need
  preparation/review.
- Buyer salutation, DOB, residence address, email and phone are missing.
- The historical contract has no valid price snapshot/reservation-fee input.
  This is not evidence that the unit's current market price is zero or missing.

These are genuine operating data/content constraints, not a transport outage.
Do not silently resnapshot this old sent contract, fill personal facts, waive
appendices or remove legal paragraphs to obtain a green readiness badge. Use
the existing authorized new-version/preparation workflow for any requested
correction. The previously deferred files and variant decisions remain deferred.
There was no open nonterminal SBK in this project in the audited query; this is
not a new successful SBK generation test. The separately verified TECH74 chain
is evidence of pipeline operation, not of this real case's completeness.

## Timing observation

The authorized admin directory query completed in 1,521ms inside the backend
job. It returned 29 accessible clients / 38 unit contexts across the admin's
workspace; these are not Dejvice project totals. This single DB-side sample
does not prove whole-browser or HTTP latency, nor invalidate older slow-request
evidence. Do not optimize permissions or query scope based only on this sample.

## Next practical work

Keep the approved originals/immutable evidence intact. Complete the authorized
first real buyer's CRM fields and intended working contract version, then select
the correct exact appendices and reviewed wording variant. Deferred legal facts
remain blockers rather than invented values. Separately verify catalogue-to-unit
binding before declaring all attachment choices safe; the existing picker is
project-scoped and unit-specific applicability still needs a targeted regression.

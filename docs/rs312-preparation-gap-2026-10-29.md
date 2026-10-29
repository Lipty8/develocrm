# First real case: RS312, 29 October 2026

Adam selected the existing DEJ-312-RS as the first real preparation case.
This is not approval of an inferred price, fee, legal variant or signature.
No real business mutation was made during the initial inspection. The
explicitly authorized preparation below supersedes its missing-amount findings.

## Authenticated browser evidence

Sites 185, backend appendix-unit-8d34cbd, migration 0080:

- Unit 312 current price: CZK 13,770,000.
- Current assigned P18: CZK 1,290,000; S2: CZK 290,000.
- Current sales price: CZK 15,350,000. This is a current price projection,
  not proof of the historically agreed price.
- DEJ-312-RS is sent, with one imported version. Its preparation shows no
  unit/total price snapshot, empty accessory snapshot and missing fee.
- The approved complete legal variant requires a garden plus cellar,
  garage share and outdoor parking. Current unit facts do not establish
  that combination. Do not remove paragraphs or invent accessory rights.
- Buyer identity/contact fields, planned dates, payment terms and six exact
  appendix selections remain incomplete. Deferred legal files stay deferred.

## Confirmed technical gap, not a missing unit price

`RsGenerationRepository.load` reads contract price/accessory snapshots.
It does not substitute current inventory into the prepared contract. This
separation is necessary to preserve historically agreed terms.

`app.create_contract` (0056) captures current canonical unit/accessory prices
when creating a new contract. The existing imported RS predates that capture.
`app.create_contract_version` (0073) preserves history and reopens preparation,
but does not populate these contract snapshots or a reservation fee. Neither
the commercial service nor the generation repository exposes an explicit
authorized repair/preparation operation for this legacy gap. Merely creating
another version is therefore not a solution; the 28 October report's generic
reference to an existing preparation workflow must not imply otherwise.

## Small presentation correction

The preparation summary previously rendered the empty accessory snapshot as
"Bez příslušenství" even when the whole contractual price basis was absent.
It now says the accessories are not yet confirmed in the contract and labels
the row as contractual accessories. No current inventory is silently copied;
generation readiness, legal validation and all database data remain unchanged.

## Required explicit preparation path

The next technical package should reuse contracts/contract_versions, not create
a replacement contract or parallel pricing model:

1. Preview canonical current prices and assignments alongside existing terms.
2. Require explicit agreed-price and fee confirmation; never infer from list
   price or a default fee. Adam has been asked for these two inputs.
3. Under existing unit-first locks, active-case/project permission checks,
   require an unsigned, unfrozen version, no partial signatures, no pending
   generation/upload, and no existing financial terms that would be silently
   overwritten. Reject ambiguous legacy cases for review.
4. Create an explicit new working version with before/after audit and outbox;
   retain previous generation/document evidence and imported history. Use
   optimistic expected-version and expected-price/assignment tokens plus
   idempotency. A stale preview must require re-confirmation.
5. Prepare signature-anchored payment terms using the existing operation, not
   a new payment calculation. Recheck template, appendix and exact-document
   gates before generation and signature.

This is a proposed next implementation, not a claim it already exists. It
cannot resolve the missing reviewed legal variant or personal facts. No SQL
UPDATE, duplicate contract, legal-text edit or production generation was used
to bypass these blockers.

## Verification of the presentation correction

- Targeted RS service and preparation interaction tests: 56 passed, no skips.
- Full frontend interaction suite: 203 passed, no skips.
- Frontend typecheck, lint and production build passed.
- Four new interaction regressions distinguish missing vs explicitly empty
  contractual accessory data for both RS and SBK, including a genuine zero
  price. A missing price basis still has no generation CTA.
- This correction is prepared locally for the next matching frontend package;
  it is not yet evidence of a new pilot deployment or completed RS312.

## Authorized preparation follow-up (29 October)

The explicit legacy preparation operation was implemented and verified first
on new TECH82 data; see `legacy-rs-preparation-deployment-2026-10-29.md`.
Sites 187 is live with the compact confirmation follow-up. Adam then confirmed
the total CZK 15,350,000 including P18 and S2 and specified a reservation fee
of **10%**, i.e. CZK 1,535,000. No default fee was inferred.

Through the authenticated UI the operation created working contract version 2
and reopened preparation, preserving imported version 1. Unit price is
CZK 13,770,000; accessories CZK 1,580,000; total CZK 15,350,000. These values
and fee CZK 1,535,000 survived an explicit browser reload. This was not a
generation, signature, payment or modification of catalog prices.

The existing signature-anchored payment-plan operation was then used: fee
CZK 1,535,000, variable symbol **312**, three Czech working days after the last
required actual signature. The preparation does not materialize an obligation
or invent an actual signing/due date.

The approved catalogue of this exact unit was selected as appendix 1:
document `2f4be9f1-9d83-4cb6-bcf3-4c21a0b310cb`, version
`46ad20bc-0433-43e7-9104-db218b28eff3`. The approved combined cellar/parking
plan was selected for position 2 and standards for position 5, both v1.
Position 3 rejected the same combined plan because of a duplicate-document
guard; it was not silently saved. This is tracked in
`shared-appendix-positions-2026-10-29.md`.

Adam explicitly requested continuing **without** filling buyer personal facts.
No personal fields were invented or copied from unrelated records. Actual
generation remains blocked on those mandatory fields, planned signing dates,
the applicable reviewed legal variant, accessory legal rights, and deferred
coordination-plan/power-of-attorney sources. Content approval is not revoked;
it does not prove that the complete garden/garage/outdoor variant fits unit 312.

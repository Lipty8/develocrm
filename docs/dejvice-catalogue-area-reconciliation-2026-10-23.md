# Dejvice: current catalogue area reconciliation

Adam confirmed the supplied catalogue sheets as the authoritative current area
source. The original 23 October report below was read-only. Application was
separately approved and performed on 25 October as recorded in the follow-up.

## 25 October approval

Adam explicitly approved updating only the current floor and usable areas for
the 19 units below. Prices, accessories, signed contracts and historical
snapshots must remain unchanged. The operator helper
`backend/scripts/reconcile-dejvice-areas.mjs` uses the existing domain function,
locks the exact UUID unit set in deterministic order, rejects values other than
the audited old pair or approved target pair, and treats already applied pairs
as a no-op. It verifies unchanged non-area fields and fingerprints fourteen
business/history tables in the same transaction, checks per-unit audit/outbox
counts and adds source PDF hashes to the reconciliation audit. No data outcome
is claimed until the execution and independent verification are recorded.

Source: supplied KL archive, 19 main unit PDFs. The separate 519 sauna variant
is not substituted for the main 519 sheet. Unit identity was checked inside
each PDF, not merely inferred from filenames. Read-only pilot comparison
`job-develocrm-hold-expiry-zuah6vf` compared all 19 units, with none missing.

| Unit | CRM floor m² | Catalogue floor m² | CRM usable m² | Catalogue usable m² |
| --- | ---: | ---: | ---: | ---: |
| 101 | 101.82 | 102.67 | 93.60 | 93.88 |
| 102 | 73.53 | 74.56 | 67.51 | 67.51 |
| 103 | 128.27 | 130.83 | 117.80 | 116.66 |
| 104 | 126.82 | 128.00 | 119.65 | 118.70 |
| 205 | 106.32 | 106.93 | 99.05 | 98.77 |
| 206 | 60.64 | 61.13 | 57.06 | 57.14 |
| 207 | 104.63 | 105.53 | 94.93 | 95.23 |
| 208 | 116.65 | 118.76 | 108.84 | 109.34 |
| 209 | 72.10 | 73.55 | 67.08 | 67.58 |
| 210 | 119.46 | 120.24 | 109.47 | 109.76 |
| 311 | 130.89 | 131.75 | 119.87 | 119.87 |
| 312 | 47.30 | 47.84 | 44.52 | 44.24 |
| 313 | 101.11 | 102.99 | 92.64 | 92.36 |
| 314 | 54.37 | 54.73 | 51.13 | 51.33 |
| 315 | 110.54 | 111.60 | 102.99 | 103.02 |
| 316 | 88.12 | 88.44 | 83.65 | 83.94 |
| 417 | 123.44 | 125.26 | 114.30 | 114.39 |
| 418 | 64.35 | 64.75 | 60.76 | 60.76 |
| 519 | 172.58 | 172.95 | 161.72 | 159.71 |

All floor areas differ; sixteen usable areas differ. Current CRM values match
the old importer. This is not a rounding or display issue. The current contract
mapper correctly distinguishes floor area from usable area.

## Application safeguards

After explicit approval, re-read the current rows and abort on concurrent area
changes rather than overwrite them. Resolve authorized project and unit UUIDs;
do not use unit code as an ID. Reuse `app.update_unit_details_v2` with the active
actor and project permission. Preserve every other existing field: this function
accepts the complete details record, so omitted optional values must not become
NULL accidentally. Record the source and before/after areas in the authorized
audit trail. Do not reimport the project.

Update only current `area_m2` and `usable_area_m2`. No price recalculation, price
history insertion, accessory reassignment, contract amendment, generation
snapshot overwrite or signed-document change is authorized by this report.
Before any future generation, normal readiness/difference checks must still
show the current authorized data; old signed documents remain historical facts.
Verify the exact changed unit set, untouched non-area fields and immutable
evidence after commit, then confirm the UI after reload.

## 25 October execution

- Operator implementation commit `7682108` is pushed to private GitHub. Seven
  operator guard/idempotence tests, three existing domain-edit database tests,
  changed-file lint and diff checks passed.
- Existing job preflight `job-develocrm-hold-expiry-iu737rq` Succeeded: exact
  19-unit set, all 19 still matched the audited old pairs, none already updated.
- Approved apply execution `job-develocrm-hold-expiry-0fzyg95` returned: 19 changed,
  exactly the 19 listed unit codes, 19 domain audit entries and 19 outbox events.
  Fourteen protected business/history tables had identical before/after
  fingerprints inside the transaction. Every non-area unit field other than
  the expected update timestamp was unchanged. The source PDF hashes and
  approval reference are recorded in the project reconciliation audit.
- This used the existing matching API image, application RLS role, actor and
  Key Vault database secret reference through a one-execution job override.
  No new backend/frontend deployment or migration was required. The scheduled
  job configuration was not changed.
- Apply execution status was Succeeded (ended 18:13:24 UTC). Independent read-only
  verification `job-develocrm-hold-expiry-9yyu173` also Succeeded; its result is
  total 19, pending 0, alreadyApplied 19. This is a new transaction after the
  apply commit, not a check of uncommitted values.
- Authenticated browser navigation to unit 417 displayed floor 125.26 m² and
  usable 114.39 m², with the existing 32,000,000 CZK price and historical business
  review warning unchanged. The unit's activity showed the new audited detail
  edit. An explicit subsequent page reload retained both new areas. No attempt
  was made to settle its old sales case.

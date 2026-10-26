# Rezidence Dejvice — current production data readiness

## Scope and evidence

This is a fresh read-only follow-up after the approved-original TECH74 RS/SBK
chain passed, not a claim that synthetic data prove real-project readiness.
Execution `job-develocrm-hold-expiry-i49hru1` Succeeded on existing immutable
backend `ca-develocrm-api-pilot--unit-vs-f0a6934` (migration 0073). It used the
existing non-superuser/non-bypass application role, active Adam membership,
tenant context and explicit project permissions. Every audit query was run in
a read-only transaction. Existing repositories, actual readiness service and
physical consistency checker were reused. No Graph permission, runtime image,
scheduler configuration, project or real deal was modified.

Project scope: `648b5e62-9784-4de9-929d-c89b7ffc3c50`, Rezidence Dejvice only.
Do not extrapolate its counts or clean checks to other projects or tenants.

## Proven current state

- All 19 current floor/usable area pairs match the approved catalogue targets.
  The persisted reconciliation audit records 19 changes and explicit approval
  `adam-2026-10-25-current-catalogue-areas` on 25 October. No second apply was run.
  Authenticated unit 417 again displayed 125.26 / 114.39 square metres and the
  existing 32,000,000 CZK price. Its historical business-review warning remains.
- The actual project has one active approved original RS profile (32 fields)
  and one active approved original SBK delivery-v2 profile (38 fields). The
  existing central selection returns signature-based payment timing for both,
  not an ambiguous or obsolete technical/default choice.
- Nineteen ready catalogue documents are stored in SharePoint and each has a
  unit link. Ready common documents also exist for equipment standards,
  the supplied parking/cellar situations and the corrected purchase-contract
  wording appendix. Earlier notes calling these files unregistered are dated
  history, not the current availability state. No new copy was uploaded.
- Physical consistency run `683530a4-ff96-4b9e-ae0a-002df21aaa43` completed all
  20 configured checks for this project, with physical evidence verified:
  0 critical findings, 5 warnings and 7 reviewed legacy evidence exceptions.
  This does not mean every future contract is ready to generate.
- The five warnings concern three old technical-template upload/hash
  discrepancies and two historical generation checksums that cannot be
  independently reconstructed. They do not concern the active original RS/SBK
  profiles. The seven legacy exceptions are old signed contract versions
  without exact signed-document evidence; no record was silently repaired or
  reclassified. Previously signed files/snapshots remain historical facts.

## Actual remaining operating blockers

### Project seller data

`project_contract_settings` has no row for Dejvice. All twelve seller identity,
contact, account, signature-name and delivery fields are therefore unavailable
to the authorized mapper. The templates' approval does not populate this table.
Generation correctly reports missing seller settings rather than inventing
values or copying them from an unrelated developer.

Adam was asked whether the identity, representative, contacts and accounts in
the approved originals remain current for explicit transfer into project
configuration. Do not create an invented account, representative, address or
reservation-period rule. Existing signed documents/payment prescriptions must
not change when prospective settings are filled.

### Accessory legal facts and variant coverage

All 50 active accessory records have null canonical `legal_form`; no record
currently documents a 1/25 garage share. The actual UI inventory contains 19
cellars and 30 parking places P1–P30; the remaining accessory is not classified
as a parking place. A name, price, floor label or ordering does not establish
whether a place is an outdoor use right or a garage coownership share.

The approved SBK source describes 25 garage places and four outdoor places.
P30 exists, is free, and its detail shows no assignment history and no legal
classification. Those facts do not prove it is a disposable technical item.
No parking place was deleted/archived or classified from its name or price.
Adam was asked for the authoritative outdoor/garage mapping, actual shares and
P30 clarification. This is a data/legal-basis question, not missing RBAC.

The approved complete variant contains a garden and the specified full set of
accessories. Readiness must continue rejecting different actual combinations;
approval of this version is not approval to remove arbitrary legal paragraphs.
Additional buyer/accessory variants require explicit reviewed content. Do not
loosen validation merely to make the first actual draft green.

### Existing draft and appendices

The existing sent `DEJ-312-RS` is not ready. The actual readiness service reports
missing seller settings, six unselected exact appendix versions, unsupported
complete-variant facts, missing planned dates/payment terms/variable symbol,
missing buyer salutation/DOB/address/contacts and old absent price/fee snapshots.
These are not permission failures or a failure of SharePoint transport. Its
historical values were not silently replaced, and no attempt was made to
generate or sign it. Existing document availability is distinct from a selected
and frozen exact appendix version for a particular contract version.

The three specifically deferred real files (power of attorney, coordination
plan and client-change rules) remain outside current work. They were not
searched for again, substituted with other documents or waived from validation.

## Next steps in priority order

1. Confirm and fill the actual seller configuration through existing authorized
   project settings, using current approved values rather than synthetic data.
2. Establish accessory rights/shares from authoritative project records; resolve
   P30 before any proposed bulk assignment. Use existing edit/audit operations.
3. Identify which actual buyer/accessory combinations the first real sale needs,
   and obtain reviewed variants where the approved full wording does not fit.
4. Select the available exact approved appendices only during preparation of an
   authorized new/current contract version; deferred missing files stay blocked.
5. Re-run readiness on the intended first real case. Historical 417 settlement,
   legacy signed evidence and old technical artefacts remain separate explicit
   tasks, not automatic cleanup of business records.

No application change, migration, dependency change or deployment is needed for
this read-only result. Sites 169 and the existing healthy backend are retained.

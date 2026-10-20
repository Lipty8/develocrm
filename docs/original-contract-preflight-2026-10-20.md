# RS/SBK strict preflight

## Verified defect and change

The original-profile readiness checks tested presence of several scalar values,
while `buildOriginalContractSnapshot` enforces stricter date, area and text
rules. For example a nonempty invalid birth date, whitespace-only buyer address,
unsupported braces in a name or excess area precision could pass the field
checks but fail the mapper. The independent review-only gate still prevented
live generation; this was reproduced with isolated fixtures, not by corrupting
pilot records or claiming a production incident.

Preparation now preflights that same mapper once the other business facts are
present. Approval and payment-plan preparation gates do not suppress this data
check. A typed failure produces `invalid_contract_value`, a Czech field label,
and the existing link to the appropriate entity. Raw values are not included
in the issue. It does not perform rendering, upload, DB writes, or approval.

Invalid planned dates previously escaped as a different validation error from
`signingPlanDay`. The mapper now translates that specific error into its normal
typed snapshot error. The RS/SBK comparison therefore returns unavailable
rather than throwing for such a context. Unexpected errors still propagate;
there is no generic catch pretending that a comparison succeeded.

## Validation

- Whole backend: 397 passed, 0 failed, 4 optional native PostgreSQL suites skipped.
- Targeted snapshot / generation: 39 passed, 0 failed, 0 skipped before the final
  additional comparison fixture; that fixture is included in the whole run.
- Existing preparation-panel interactions: 11 passed, 0 failed.
- Frontend typecheck, backend production TypeScript build and changed-file lint passed.
- Frontend production build passed, retaining the existing large-chunk and static
  route-classification warnings.
- No SQL, migration, locking, RBAC, financial or template-schema change.

## Remaining activation requirements

These are not removed by a successful preflight or the previously deployed
comparison panel:

1. RS III.2 still conflicts with SBK IV.4 on the crediting of the reservation fee.
   Adam chose the SBK rule and legal harmonization of RS. No replacement legal
   sentence has been supplied or invented here.
2. The original SBK paragraph 217 retains a fixed seller delivery address.
   `project_contract_settings.delivery_address` already exists, but the current
   37-field original schema does not include it. Adding it must use an explicit
   new profile/version, not silently change the meaning of the uploaded 37-field
   version. The pinned source's e-mail hyperlink target is another documented
   remaining technical slot; neither is claimed to be runtime-parameterized.
3. The source contains fixed project legal facts, lender information and a
   specific garage share. It cannot serve as a universal tenant-independent legal
   document. Future developers need their own explicitly supported profiles.
4. Approved appendix files/versions have not been supplied as complete packages.
5. These review variants cover one individual with the full accessory combination.
   Firms, multiple buyers or missing accessory clauses require reviewed variants.
6. `generationSupported:false` and `original_profile_review` remain in force.
   Completion still needs safe runtime enablement after the outstanding technical
   slots, explicit content approval, and a live original-profile generation /
   SharePoint / exact-document-signature E2E. Green unit tests alone do not prove it.

The existing templates, legal text, source hashes, Word outputs and actual pilot
business records were not changed by this package.

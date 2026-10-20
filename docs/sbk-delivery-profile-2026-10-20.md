# SBK seller delivery address

## Scope and architecture

The pinned SBK originally retained the seller delivery address in paragraph 217
even when project settings contained another address. The existing authorized
RS/SBK source already exposes `project_contract_settings.delivery_address`.
No new database field or duplicate document model is needed.

A distinct `dejvice-original-dob-delivery-v2` profile adds the required
`seller.deliveryAddress` scalar to SBK (38 fields). Existing 37-field SBK and
32-field RS profiles, manifests and uploaded versions remain unchanged. The new
profile is SBK-only, cannot be uploaded as RS or as the older 37-field profile,
and uses a distinct default template code in the existing upload form.

The server mapper reads only the authorized project's setting. Empty, invalid
or missing delivery data block preparation; registered office and old source
text are not fallback values. Existing case, unit, buyer, document/version and
SharePoint isolation remain in force. Previous RS snapshots remain unchanged.

The existing signature payment plan remains policy v1. A template data-slot
addition is not a new financial policy; no installment, deadline, obligation,
allocation, refund, signature rule or migration changes.

## Template and fidelity

- Original SBK SHA-256:
  `bc79743f8c9561a51f015a02a8a083416a3b12d32918875f2a974bce2a22c160`.
- New inactive source template:
  `backend/templates/review/sbk-dejvice-original-delivery-review.docx`, SHA-256
  `2d320d0331e0c17f9d3e37c601420b54077da53f2e99eb0b2b0be0d51774af50`.
- Reversible slot manifest: `sbk-delivery-review-manifest.json`, 60 exact slots,
  38 required fields, draft/activationAllowed false. The previous 59 slots are
  unchanged; the only additional slot is paragraph 217's address.
- Fully filled technical review Word:
  `outputs/contract-review/2026-10-20/sbk-dorucovani-v2-ke-kontrole-2026-10-20.docx`,
  SHA-256 `f05c87ceddaf7befc711ebe13bea3b0ad8ace40988d55d94ff8c2199ec28e634`.
- All 261 paragraphs match the original with only the explicit manifest slots
  filled. All other package parts and the XML structure outside text are
  unchanged, zero unresolved placeholders. The final 11 pages were rendered
  and each page visually inspected, including the new address on page 10.
- Existing Word field instructions were preserved, not silently refreshed by
  rewriting the package. Desktop Word field refresh remains unverified.

## Verification before release

- Backend 401 passed, 0 failed; 4 optional native PostgreSQL suites skipped.
- Targeted source/mapping/lifecycle/selection tests 73 passed, 0 skipped.
- Frontend interactions 111 passed, static regressions 143 passed.
- Frontend typecheck, backend production build, changed-file lint and frontend
  production build passed. Existing large JS chunk/Babel and route-analysis
  warnings remain; they were not hidden or weakened.
- No DB write/lock/migration change; native concurrency tests were not rerun in
  this package. Previous native PostgreSQL evidence is recorded separately.

## Still deliberately blocked

The new profile remains `generationSupported:false`; upload and preview do not
approve or activate it. Actual original-profile legal generation/signature E2E
is not claimed by these tests. The source-specific lender, project legal facts,
garage share, full accessory combination, appendix package and remaining seller
e-mail field/link target still require their existing checks. The RS fee-credit
wording still awaits legal harmonization. This address addition does not resolve
those independent gates and does not alter any actual pilot business record.

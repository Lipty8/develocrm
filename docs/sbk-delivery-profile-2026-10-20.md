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

## Matching deployment and live draft E2E on 21 October

- Source `97fe9784af8a626982fae9332d04557b36e0683f` is on GitHub main. The push
  reported a disconnected response, but `ls-remote` independently confirmed the
  exact target SHA. No blind duplicate push was needed.
- ACR `cg4f` Succeeded. Image `develocrm-api:sbk-delivery-97fe978`, deployed by
  digest `sha256:da2dc1ed03f79b9d3eabd8c48c6ae06ef672554f18922b71697d1fe2d1756e9b`.
- Backend `ca-develocrm-api-pilot--sbk-delivery-97fe978`: Healthy, Running,
  latest-ready, 100% latest traffic. Liveness/readiness retained, both endpoints
  HTTP 200. No migration or permission/secret change.
- Official Sites source helper built/typechecked the matching checkout, then
  renewed expired short-lived credentials for the same Site. No access policy
  was weakened. Final source `0b3abd2b036975ca5086198a1b90726bded11fcd` and GitHub
  have the exact tree `475c61f1ff8ce4280a76d96869b0203866204653`; 524 files,
  zero byte differences, zero extra tracked files, clean helper checkout.
- Archive SHA-256 `caf0af804c16317482bb081fd739283a9c5f33f25e52d054ecff1faea07aba84`.
  Existing conflicting lockfiles were preserved; already successful exact
  TypeScript/Vinext commands were used rather than modifying dependency inputs.
- Private Sites **157**, deployment `appgdep_6ad812d7f6b48191a81c4cf98108fc43`
  Succeeded. Version
  `appgprj_6a5f2c904d308191a901be8e347ea76f~appgver_d00912f9af8c8191afd04b8b1f036e26`.
  URL `https://develocrm-v1-preview.lipty8.chatgpt.site`; owner-only custom audience,
  zero external visitors unchanged.

Authenticated browser test used Adam's normal existing Microsoft account.
Only project **TECH SMOKE 0062 – contract end** was selected. The existing upload
modal created **TECH67 DELIVERY SBK – NEAKTIVOVAT**, version `tech67-97fe978`,
under the new profile. Actual `POST /v1/document-templates/upload` returned 201,
correlation `req-bc`, about 6 seconds. The modal closed without losing its project;
the draft showed 38 fields, the correct profile and SharePoint link, no approval
button. Previous 37/32-field templates remained listed separately.

Backend-generated preview was downloaded through the UI from the exact pinned
SharePoint source version. All 261 paragraphs match the expected local strict
render with catalog samples, including the new seller delivery address; zero
unresolved placeholders. Runtime preview SHA-256:
`52de32cb8c053523b70c777e9d23be5a165cb3e79ee5d56a23cd063df0316758`.
The saved source hash is `sha256:7f66ea65d2903df78559898f1614afac35b9b227a16ea812336b9f83aa0060ef`;
it is the readback hash pinned by the existing upload service, not an assumption
that SharePoint leaves Office package transport bytes unchanged.

A full reload completed and the same draft was reopened: same version/hash,
38 fields, same project, still Concept/review-only. The first immediate selector
attempt ran while workspace bootstrap was still loading and found no match; it
did not issue another upload. After loading, the persisted record was verified.
Browser warning/error capture was empty. Final 15-minute monitoring query:
157 completed requests, exactly one successful template upload, one successful
preview and zero HTTP 5xx. Earlier post-deploy DB/RLS string checks found none.

The test created only a clearly marked technical draft/source document. No actual
contract, case, unit, payment, signature or existing template was changed. Nothing
was activated, archived or deleted. This verifies the new profile's actual upload,
metadata, Graph readback, preview and reload, **not** a live legal SBK generation
or its signature/payment lifecycle; those remain explicitly gated above.

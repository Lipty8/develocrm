# RS SBK generation binding deployment

Status: technical package deployed and scoped smoke verified. Original-profile RS/SBK production readiness is still incomplete; no legal template was activated.

## Source and deployment

- GitHub main release commit: `3bb358f9478beb29baa4f92eefbd561a0bfc150e` (includes scalar mapper `0f8b5ca`).
- Git source tree `e7a8ee9b29567c1199bf6350d522173b261ae2c4`; 489 files compared byte-for-byte with the official Sites checkout, no differences.
- Official Sites helper commit `0060ddf3fccf97e11964ad54d110d4dfe0806d5b`; identical tree, clean checkout. The helper owns commit/push/package; no metadata omission or manual Sites Git workaround.
- ACR run `cg43`: Succeeded. API tag `develocrm-api:contract-bind-3bb358f`; digest `sha256:72351b39b65b8dd8bb49fcd5f6ed61bb91a2f405c2f16f3bc940aa5e00fccac9`.
- Sanitized build context approximately 395 KiB: committed package inputs, backend source/scripts/migrations and Dockerfiles. No credentials, legal DOCX files or runtime business data.
- Backend revision `ca-develocrm-api-pilot--contract-bind-3bb358f`: Healthy/Running/latest ready. Liveness/readiness probes retained; `/health` and `/ready` HTTP 200.
- Frontend Sites 150; deployment `appgdep_6ad5c872c1088191b539dde1d6506a73` succeeded. Version `appgprj_6a5f2c904d308191a901be8e347ea76f~appgver_1b89d915e678819183a1dc6515f1be0a`.
- Audience unchanged: private/custom, same owner and one allowed user.
- No new migration and no migration execution. Read-only job `caj-develocrm-migrations-pilot-prj6o52` confirmed latest 0064 checksum `3deb88eef6980034bc1a6b067f9456a75c39d3f4e742610efd75183758fb3cfc`.
- Rollback baseline: backend `signing-plan-20a759a`, image digest `sha256:cfe5cb4aadec2730ad409fc4c257fa3faffb058826f734dfa95d0ab4d5e4929c`, Sites 149. Rollback was not needed.

## Changes and verification

- One generic contract generation endpoint/BFF/repository/panel for RS/SBK; old RS alias rejects SBK. Existing renderer/upload services reused.
- Bind checks exact completed operation, contract/type/project/unit/case, template/document versions and snapshot. Existing-operation replay rechecks project permission.
- New generated business versions retain planned signing dates; a render/bind plan race is rejected. Evidence validation occurs after binding in the same rollback-safe transaction because the shared validator deliberately rejects an unbound generation.
- Full backend: 370 passed, 4 optional native suites skipped in the general run. Frontend: 143 passed. Interaction: 79 passed. Final focused native PostgreSQL/PGlite/readiness run: 38 passed, 0 skipped. Both typechecks, targeted lint, diff check and both production builds passed; Sites build passed again in the official helper.
- The SBK persistence test models a synthetic completed generation only in an isolated local database. It explicitly proves the public approval/generation services still refuse the review-only original profile. This is not a claim that approved-original SBK production generation is enabled.

## Authenticated pilot E2E

Only newly created technical data in the preexisting technical project was used. No existing signed contract, real buyer, unit 417 or other real commercial data was modified.

- Technical project: `6c1ccb03-122d-4e32-8d6d-6f6faa12b019`, existing `technical-rs-0057` template already approved. Its status was not changed.
- Browser created unit `TECH-GEN-3BB` (`cff2fafb-49bd-4717-ac51-33b59acc32a6`) at 5,000,000.03 CZK, then a 48-hour pre-reservation with the existing technical buyer `TECH SMOKE GEN0057`.
- Browser prepared RS `cdff534a-7bdf-42cf-b000-94644c424326` in that case, with one technical 100,000 CZK unpaid obligation. No signature or payment was recorded.
- Browser generic generation succeeded: document ready, version 1, exact-file download succeeded and the SharePoint link opened the actual file in Word Online.
- Downloaded Word contained the correct unit and `5 000 000,03 Kč`, no unresolved placeholders. Exact downloaded SHA-256 `d0e6ae1e3aebcd26f0bb73edf88702fc01b0e7dfb76d917a6990e617be92a435`. All four pages rendered with bundled LibreOffice and were visually inspected. This is the older technical template, not approval of the newly parameterized legal originals.
- Explicit UI regeneration created contract version 2, retaining version 1 as superseded. No second contract/document or payment obligation was created.
- Full browser reload retained `Dokument připraven · verze 2`, the current exact-file download action and SharePoint link.
- Read-only job `caj-develocrm-migrations-pilot-9awe83r` confirmed one initial price-history row at `5000000.03`, two completed generation operations, two exact document versions under the same document ID, stored hashes/native version identifiers/drive/item/web URL, and exactly one payment obligation.
- Cross-replica Log Analytics observation (four-hour deployment window): 1,633 completed requests, two generic generate calls, zero 5xx, zero 403. This is an observed window, not a claim of permanent error-free operation.

## Remaining issues

- Existing whole-workspace mutation invalidation still causes unnecessary loading and slow client refresh.
- UI money summaries round nonzero cents even though database and generated Word preserve them. Fix centrally without changing business arithmetic.
- Generated filename timestamp currently uses a PostgreSQL Date string (`Mon Oct ...`) rather than a normalized ISO-derived stamp. Fix metadata formatting without renaming historical files.
- Original legal profiles remain blocked on legal accessory facts, signature-anchored payment policy, supported complete-variant data and separate content approval. No production-original RS/SBK signoff is claimed.

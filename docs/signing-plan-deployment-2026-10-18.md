# RS/SBK buyer-address and signing-plan deployment checkpoint

Status: deployed; core authenticated persistence smoke passed. This package alone is not RS/SBK production readiness.

## Exact source

- Frozen deployment source: `20a759ad363735c6b86048372ede4ec9e7155258` (includes buyer-address commit `ba07f88`; later development is excluded).
- Source tree: `a4dc7d39589360b1391b8dffb7b02ee555fe02b1`.
- All 484 tracked files in the prepared Sites checkout were compared byte-for-byte with this commit; no differences.
- Existing unrelated untracked files were not included.

## ACR, verified successful

- API run `cg41`: Succeeded; tag `develocrm-api:signing-plan-20a759a`.
- API digest: `sha256:cfe5cb4aadec2730ad409fc4c257fa3faffb058826f734dfa95d0ab4d5e4929c`.
- Migration run `cg42`: Succeeded; tag `develocrm-migrations:signing-plan-20a759a`.
- Migration digest: `sha256:face066c2656289b68fee6c0ea9b98604d496f5c71188429ecd0d96775f53775`.
- Registry: existing private `acrdevelocrmpilot9a4c6e`.
- Build context contains only committed package inputs, backend source/scripts/migrations and Dockerfiles. No secrets, legal DOCX files, tests, or runtime business data. Context archive approximately 392 KiB.

## Database baseline, read-only

- Existing migration job execution `caj-develocrm-migrations-pilot-b0f4ewh`: Succeeded.
- Ran `BEGIN READ ONLY`, selected the two latest migration filenames/checksums, then `ROLLBACK`.
- Verified latest is `0063_original_contract_seller_fields.sql`, checksum `4b122caed5082bb027660172fd60419e4dc553e111461b7a65587a25c05bc935`.
- Previous is `0062_unsigned_draft_release.sql`, checksum `9b5375f20770f4ee4fd36157850a5b689fa898c821b40e50692c723bc5b78754`.
- Used the existing `DATABASE_URL=secretref:database-admin-url`; secret value was not read or printed. No migration executed.
- Azure execution override requires explicit image and env. The first request lacking image was rejected before execution; no failed DB mutation.

## Pending migration

- `0064_contract_version_signing_plan.sql`, SHA-256 `3deb88eef6980034bc1a6b067f9456a75c39d3f4e742610efd75183758fb3cfc`.
- Additive nullable dates on existing contract versions, guards and one authorized operation. No historical backfill, no financial changes.
- Native local PostgreSQL and PGlite tests passed as documented in the sprint journal. Pilot schema is still 0063.

## Publication gate

The official Sites helper initially returned opening metadata for remote commit `d3286129e02a2519cdee78092bda1de7572c74e5`. The safety reviewer rejected packaging because required opening metadata named that old commit. The human subsequently explicitly approved matching deployment of `20a759a`. The same official helper completed successfully with the complete original opening metadata; no manual Sites Git workaround was used.

## Verified deployment

- Sites helper commit `02a3c70873b86a532550dd3afa46da8a40332f6f`; Git tree exactly `a4dc7d39589360b1391b8dffb7b02ee555fe02b1`, clean checkout. All 484 files revalidated against the frozen source before building.
- Migration execution `caj-develocrm-migrations-pilot-46ryzub`: Succeeded; log only `Applied 0064_contract_version_signing_plan.sql`.
- Read-only verification execution `caj-develocrm-migrations-pilot-ltgt4li`: Succeeded; exact 0064 checksum, both nullable date columns and one `app.set_contract_version_signing_plan` function confirmed. No newer migration.
- Backend `ca-develocrm-api-pilot--signing-plan-20a759a`: Healthy, Running, latest ready revision; API digest as listed above. Liveness/readiness probes retained. `/health` and `/ready` both HTTP 200.
- Private Sites 149; deployment `appgdep_6ad53fb5a5d88191b29cd554739eb0ba`: succeeded. Saved version `appgprj_6a5f2c904d308191a901be8e347ea76f~appgver_33930b374ca481919b7490e5339e7e05`.
- Access unchanged: owner, custom allowlist with one user. No sharing expansion.
- Initial authenticated GETs for readiness/commercial/payments/clients/tasks returned 200. Existing clients request remains slow (~10–12 seconds); no performance claim is made.
- Technical SBK `TECH60-BLOCKED-SBK`: dates 2026-10-20 / 2026-10-21 saved via UI, reloaded by readiness and preserved after full page reload. Identical repeat succeeded; read-only DB execution `caj-develocrm-migrations-pilot-hytlc55` confirmed version 1 retains both dates and exactly one `contract.signing_plan_updated` audit event.
- Technical client `Technical TECH60-BLOCKED`: explicit copy-address action worked; correspondence was then changed independently. Both address POSTs returned 201 (`req-50`, `req-5e`). Separate synthetic Prague residence and Brno correspondence remained correct in detail and edit modal after full reload. No real customer data changed.
- No legal template was activated, no signature recorded, no document generated, no payment changed. Only synthetic technical buyer addresses and planned dates were modified.
- Sampled new-revision logs contained no 5xx or RLS errors; browser captured no warning/error entries. Health/readiness both 200. This is a scoped smoke, not proof of an error-free whole pilot.
- Remaining UX issue observed: successful mutations still trigger global data invalidation and slow client loading, briefly replacing the detail with a loading state. Persistence succeeds, but targeted refresh is a separate follow-up; no unrelated frontend refactor was mixed into this exact approved release.
- Document-bound/closed-case immutability, native concurrency and version-history guards remain covered by the predeployment automated suites (63 focused PostgreSQL/PGlite/readiness/date tests, 78 interactions, 143 frontend tests; full backend 356 passed and 3 optional native suites skipped in that general run). Both typechecks, lint and production builds passed before packaging; Sites production build passed again during this deployment. No claim of a new signed-document browser test is made here.
- Browser automation's synthetic `fill` on native date inputs did not update React state; a real arrow-key change did. Earlier empty saves were no-op requests, not evidence of successful populated persistence. Do not count those as passing date tests.

## Subsequent work

Continue the separate original RS/SBK scalar mapping and generation-binding work from newer source. Do not describe those newer changes as deployed by this exact 20a759a release. Targeted refresh, legal accessory facts, signature-based payment timing and separate content approval of the final parameterized documents remain open.

The full RS/SBK production workflow remains incomplete; this package does not enable the original-profile renderer, payment policy, or legal approval.

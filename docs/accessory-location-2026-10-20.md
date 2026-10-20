# Accessory location completion for RS/SBK

## Root cause and narrow change

Canonical `accessories.floor_label` already served import, catalog and original
RS/SBK render/readiness projections. Manual accessory editing omitted it in the
form, DTO and domain command, so a user could not resolve a missing-floor issue
without an import or database intervention.

The existing edit modal now prefills **Podlaží / umístění** and submits optional
`floorLabel`. Text is trimmed, limited to 120 characters and rejects control
characters. Explicit empty/null clears it; omission preserves existing data.
No value is inferred from a code, name, category or assignment.

Additive migration 0067 adds a nine-argument overload of the existing
`app.update_project_accessory` command. It checks current tenant, active actor
identity and existing project `accessory.manage`, locks the same accessory, then
calls the existing eight-argument command. Location, code, price and optional
legal facts remain in the same repository transaction. Failure rolls everything
back. Existing imports/eight-argument callers preserve location. Location changes
emit before/after audit and outbox once; unchanged retry does not duplicate
location events or prices. The preexisting generic accessory-edit audit still
records each accepted edit; global edit deduplication is not claimed.

No new inventory model, document model or permission. No changes to signed
document snapshots, assignment, legal content or template approval/activation.

## Verification

- New normalization tests and three whole-modal interactions cover prefill,
  trim, explicit clear, invalid input and server failure retaining input.
- All frontend interactions: **108/108**; static regressions: **143/143**.
- Full backend suite: **389 passed, 4 optional native suites skipped**. The
  separate focused PGlite/real PostgreSQL suite verifies the field,
  omitted preservation, clear, category/legal rollback, scope and actor forgery,
  direct SQL validation and eight parallel edits without duplicate location
  events or price rows. Focused suite: **38/38**, no skips.
- Frontend/backend TypeScript, changed-file lint and production builds passed.
  Existing bundle-size/static-route warnings remain.
- The old disposable PostgreSQL cluster on 55467 had a missing pg_filenode.map;
  its failure was infrastructure, not counted as a passing test. An independent
  PostgreSQL 17 cluster on loopback port 55468 ran the native tests successfully.

## Deployment and authenticated browser evidence

- Source `c3b27c706ce22a8b44ec77a78c13890cb166cebf` pushed to private GitHub.
  Official Sites helper commit `3f5eba165d6acb0f8342c1bcd26a71d855b48136`
  has identical tree `e2aa283d835a2be186ba1890f1b91edab41c9ca0`, clean checkout,
  repeat typecheck/build passed. Its installer rejected preexisting mixed
  lockfiles, which were preserved; the identical already-tested dependency
  installation was reused. No authentication or publication guard was bypassed.
- ACR API `cg4a` and migrations `cg4b` both Succeeded. API digest
  `sha256:6de3eb7c1b996bf6a1fb94cccd13c9e48c5ef77374c594245d541e3b3b9eeaca`;
  migration digest
  `sha256:924c461a841549578f60042513d0c3eb51b273ccf49331a58208d42ee7ba3b91`.
  Build context contains only selected committed code/config, no local logs,
  secrets, attachments or untracked files.
- Baseline read-only job `caj-develocrm-migrations-pilot-nts9da8` confirmed 0066.
  Migration `caj-develocrm-migrations-pilot-1vsv3ks` Succeeded, applied only 0067.
  Read-only postcheck `caj-develocrm-migrations-pilot-9litdhm` Succeeded: checksum
  `66373df67d421abf403311e8b1effc09350c50a11fa54cb81363df225fd81a76` and new
  command present; 0066 unchanged. Existing admin Key Vault reference retained.
- Backend `ca-develocrm-api-pilot--accessory-location-c3b27c7` Healthy/Running,
  latest ready, 100% latest traffic; `/health` and `/ready` returned 200. Existing
  probes, managed identity, secrets and authorization are unchanged.
- Private Sites **155**, deployment `appgdep_6ad71cc484a08191b1cd388c20463bad`
  Succeeded, saved version
  `appgprj_6a5f2c904d308191a901be8e347ea76f~appgver_bf680937b75881919d56499254097384`.
  URL `https://develocrm-v1-preview.lipty8.chatgpt.site`, owner-private audience
  unchanged. Published only after healthy matching backend.
- Authenticated administrator browser used only existing unassigned technical
  `TECH65-LEGAL-S` and `TECH65-LEGAL-P` in project
  `6c1ccb03-122d-4e32-8d6d-6f6faa12b019`. Saved synthetic locations
  `1. PP – TECH67` and `2. PP – TECH67`. Both PATCH requests returned 200,
  correlations `req-1e` and `req-2q`. Full reload and reopened edit showed saved
  values, same price and unchanged legal facts. Actual modal screenshots were
  inspected/emitted inline; local browser screenshot-file export remains
  unavailable, so no nonexistent image artifact is referenced.
- Read-only final job `caj-develocrm-migrations-pilot-7u2qn7z` Succeeded. Both
  rows have one location audit and outbox event, one original 1,000 CZK price
  row and zero assignments. Parking retains garage coownership 1/25; cellar
  retains separate-unit form and no share. No real inventory, historical case,
  signed document or actual ownership information was changed.
- Inspected final API window: 96 completed requests, zero 5xx. No browser
  warnings/errors captured. Existing pg SSL-mode deprecation warning remains.

This completes manual location entry, not original-template legal acceptance.
No original legal template was approved or activated; complete-variant source
data and filled Word content review still gate real use.

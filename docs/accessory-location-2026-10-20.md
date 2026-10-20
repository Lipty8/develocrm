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

Deployment and authenticated browser persistence verification are pending.
No real inventory or historical business data has been changed.

# Exact historical contract document downloads

## Gap and bounded correction

The contract Versions tab displayed logical version metadata only. The existing
backend already supports an authorized, exact-version, hash-verified document
download; only the current-version overview exposed it in the UI. Historical
audit therefore required a separate technical request.

Each documented available version now has its own download action. Current and
historical actions share the same component and existing BFF/backend route,
using contract UUID plus exact contract-version UUID. No current-file or direct
SharePoint-item fallback is added. Missing and unavailable files remain explicit
states; reviewed legacy missing evidence is not presented as a valid document.

Downloads are read-only. The backend continues to enforce tenant/project RBAC,
the contract/document-version binding, configured connection/native file version
and exact content hash. No signature, upload, approval, snapshot or business
operation is changed. No migration or backend deployment is required.

The shared action disables duplicate requests, aborts when its identity changes
or it unmounts, ignores late aborted responses and cleans up object URLs/timers.
Failure is a safe Czech message, not raw backend/storage text. The existing
version-row layout is retained with responsive button wrapping.

## Verification

- Frontend 143 passed; interaction 126 passed (five new scenarios).
- New tests cover exact older-versus-latest request/filename selection, the
  actual Versions tab when its latest version has no file, unavailable/legacy
  states, a safe error with no fallback, and cancellation on context change.
- Frontend typecheck, backend TypeScript build, changed-file ESLint and
  frontend production build passed.

## Published read-only browser verification

- Implementation commit: `8cc2ccc316002351dc4288f7f34ab38fb595e0e3`.
- Private Sites version 163, deployment
  `appgdep_6adbdc60cdd88191b2d1fa68e9eb4b02`: Succeeded.
- Sites commit `f9f77977510a51e9f5ee51ca20d3faebc34058ad` and GitHub
  implementation share source tree `3ceb169c1cf16cd970c90ec0ca9cb3b6a589266a`
  (560 tracked files). Site access remains private.
- Compatible backend remains `ca-develocrm-api-pilot--sbk-jsonb-4dc5624`;
  health and readiness returned HTTP 200 after publication. No migration or
  backend change was required for this UI package.
- Authenticated published UI: opened existing technical contract
  `RS TECH-GEN-3BB`, Versions tab, downloaded both v1 and v2 using their
  individual actions. Each returned 39,711 bytes without an error. Hashes:
  - v1: `d0e6ae1e3aebcd26f0bb73edf88702fc01b0e7dfb76d917a6990e617be92a435`
  - v2: `7c91d9d336c9e739abd7468035c2325df1691a493b48df734334c93591976444`
- Distinct contents demonstrate that the old-version action did not silently
  return the latest file. The existing exact-file endpoint validates native
  version binding and content hash before responding. No business record,
  signature, financial allocation or original SharePoint file was changed.

## Additional read-only generated Word QA

The authenticated CRM download of the TECH72 SBK returned 43,736 bytes with
SHA-256 `708581c025ef2ee7b98f3fddad4aaf26e8d950de54174b988226f42c6b71da54`.
All 38 fields had values and no unresolved `{{...}}` tokens remained. Its two
pages opened in the bundled LibreOffice renderer and were visually inspected.
Mapped test buyer/seller, delivery addresses, areas, accessory labels and money
values matched the displayed authorized technical data. Long diagnostic field
names wrap inside the test table; this is not a legal-contract layout review.

The file explicitly contains no legal contract text. This QA does not prove
Microsoft Word desktop behavior, legal-content approval, comparison to the
approved originals, or completion of the pending SBK signature/payment E2E.
The original document/SharePoint item was not edited or replaced.

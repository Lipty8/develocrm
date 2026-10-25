# Physical document upload UI — 2026-10-25

## Scope

The existing generic document-create and new-version actions previously saved metadata without selecting a physical file. They now share one file-upload form and call the existing authenticated SharePoint upload service. The project Documents tab exposes the same action. Contract, addendum and handover documents remain in their existing business workflows.

No backend schema, Graph permissions, storage configuration, document model or migration is changed. No automatic alteration of contracts, payments or historical snapshots is included.

## Safety

- Project options use effective tenant/project document permissions and UUIDs; changing project clears unit/client selections.
- The repository sends an explicit allowlist, never caller identity, site, drive or Graph URLs.
- The BFF streams to a fixed backend endpoint with the existing authentication, tenant and correlation handling.
- Existing backend validation, RLS, idempotent reservation/finalization, native-version integrity checks, audit and outbox remain authoritative.
- Repeating an unchanged failed submission preserves its idempotency key. Controls are disabled during submission, including modal dismissal.
- PDF supports the existing 25 MiB limit; DOCX/JPEG/PNG/WebP retain the existing 4 MiB limit. MIME/extension, filename, empty file and size validation run before transmission and remain enforced server-side.
- A successful upload refreshes the affected document/project list without triggering the global workspace bootstrap.
- Generic new-version actions are not exposed for signed or business-managed contract/handover documents. The backend remains the final immutability guard.

## Verification before publication

- 143 frontend regression tests passed.
- 136 interaction tests passed, including 10 new upload/form/repository/BFF tests.
- Frontend TypeScript check passed.
- Full lint passed.
- Production frontend build passed.

Live publication and authenticated SharePoint persistence evidence will be recorded after deployment. Automated tests alone are not proof of physical pilot persistence.

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
- 137 interaction tests passed, including 11 new upload/form/repository/BFF/open-action tests.
- 25 focused backend document, SharePoint upload and PDF transport tests passed.
- Frontend TypeScript check passed.
- Full lint passed.
- Production frontend build passed.

## Publication

- GitHub implementation commits: `ccccb3bad72bb854d0bc42f2534f2ed07891d530`, `a64b857`.
- Sites **166**, deployment `appgdep_6ade875fdc408191b445eda216372f4c`, succeeded.
- Sites source `d09dacd7b0bbaf2eb1aadd7d612af73ae5f7416a`; source tree `84d9a3d172711d267c39c394f177979188de8a7b` exactly matches the implementation GitHub tree.
- Backend unchanged: `ca-develocrm-api-pilot--rs-original-1f3d65b`, Healthy / Running / Provisioned.
- API digest remains `sha256:4fec3d87a7d815d30ddfed471232c93139facb59a0b048495f708296ee41ffa0`.
- `/health` and `/ready`: HTTP 200. No migration.

## Authenticated pilot evidence (25–26 October, Europe/Prague)

Adam's authenticated browser uploaded **21 approved PDFs**, all returning HTTP **201**, through the new UI and the existing `/v1/documents/sharepoint-upload` service:

- Standardní vybavení – Rezidence Dejvice: document `14bea132-f4c8-4b18-90f0-e32c1470dfad`, 10,183,053 bytes, SHA-256 `a79e5e7830b7fdd6f00a77b9c937c03194bd39c572d58833d1541b152844b4c0`.
- Situace projektu, parkingu a sklepů – Rezidence Dejvice: document `b56f5483-fff3-4bdd-80ca-8591b1d67558`, 734,142 bytes, SHA-256 `b060a65c3f820b479376b2e1db67e90dcac9a154c680c503bf388843f00766f9`.
- The 19 main catalogues for units 101–104, 205–210, 311–316, 417–418 and 519, each bound to its actual unit UUID. The alternative 519 sauna catalogue was not substituted for the main catalogue.

The content approval and explicit confirmation that the standards PDF is not malicious/quarantined were honored without bypassing any security control. Source originals and prior copied files were retained.

Independent read-only execution `job-develocrm-hold-expiry-baj3gbh` **Succeeded** and verified every one of the 21 files using the existing runtime RLS role and managed identity. Each document has exactly one completed upload operation, one ready business version, correct project/drive metadata, native SharePoint version, ETag and web URL. Downloading that exact native version produced identical source size and SHA-256. Unit catalogues have exactly one matching unit link. Each upload has exactly one audit and outbox event. The verifier performed no writes and did not alter the scheduled job configuration.

Standards and situation document details survived reload. The catalogue 519 reload was also exercised. The new safe `Otevřít v SharePointu` action is visible in the deployed document detail. Direct PDF rendering in the automated in-app browser remained blank, so visual rendering of that remote viewer is **not** claimed; physical file persistence is proved independently by exact native-version downloads and hashes.

## Remaining scope

This completes physical ingestion of these 21 PDFs, not every legal appendix selection on every contract. Coordination plan, power of attorney, client-change rules and the correct purchase-contract wording still require verified source-to-appendix mapping. No placeholder file was substituted and no historical contract appendix was changed. Seller configuration and the full approved-original RS/SBK business-generation E2E remain separate readiness gates.

An existing contract-appendix panel link still uses the legacy `?tab=documents` project URL, which initially displays the project overview; the actual `/documents` tab route works. This navigation follow-up is recorded rather than included silently in this completed upload package.

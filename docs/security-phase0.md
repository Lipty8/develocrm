# DeveloCRM Security Phase 0

Status: **CLOSED**. Implemented, deployed and verified in the pilot environment. Migration `0037_security_phase0_media.sql`, the matching backend and the matching Sites frontend were verified on 13 September 2026. Azure probes, diagnostics, metric alerts and outbound e-mail notification are active.

## Media authorization

R2 object keys are locators only. They no longer grant access.

1. The browser obtains a delegated Entra token through the existing MSAL flow.
2. The BFF forwards that token and the configured workspace header to the API.
3. The API resolves the Entra identity to an active user and membership.
4. `MediaRepository` resolves the media owner from PostgreSQL metadata and evaluates `media.read` or `media.manage` for the owning project.
5. Only after the API authorizes the request does the BFF read or write the R2 object.

`media_assets` stores tenant, project, optional unit, entity type and UUID, media kind, storage key, file name, MIME type, uploader and upload time. Composite foreign keys prevent cross-tenant and cross-project ownership. RLS and FORCE RLS are enabled. A partial unique index permits only one active cover or floorplan per entity while preserving replaced versions.

For uploads, the client supplies only the target entity UUID and media kind. The backend derives tenant, project, unit and uploader from the authenticated context. If metadata persistence fails after an R2 write, the BFF deletes that new object. Replaced metadata remains historical and inactive.

Production media routes contain no `develocrm-demo`, `iva@develo.example` or demo-user authorization path. Browser-only preview requires an authenticated ChatGPT user and an explicit `DEVELOCRM_PREVIEW_TENANT_ID`.

## Safe API errors and logs

All backend error responses use one public envelope:

```json
{
  "code": "FORBIDDEN",
  "message": "Nemáte oprávnění provést tuto operaci.",
  "error": "Nemáte oprávnění provést tuto operaci.",
  "correlationId": "request-id"
}
```

The mapper suppresses SQL, constraint, driver, connection and stack details. Authentication failures do not expose verifier messages. The correlation ID is returned in the response header and body.

Backend request logs contain method, route template, status, latency, correlation ID and error type. Authorization, cookies, error messages and stacks are redacted. The request serializer removes query strings, so media keys and filter values are not written to the ordinary request log. Request and response bodies are not logged.

## Dependencies and SBOM

Production audit before hardening: 2 critical, 25 high and 11 moderate advisories.

Changes were deliberately limited to compatible versions and targeted transitive overrides:

- `fastify` 5.10.0 → 5.12.1
- `next` 16.2.6 → 16.3.3
- patched overrides for `baseline-browser-mapping`, both supported `brace-expansion` lines, `browserslist`, both supported `fast-uri` lines, `find-my-way` and `nanoid`

Production audit after hardening: 0 critical, 0 high and 1 moderate advisory. The remaining advisory is `uuid@8.3.2` through `exceljs`; the published fix requires a major dependency jump to UUID 11 and is intentionally deferred rather than forced into Phase 0.

The CycloneDX production SBOM is stored in `security/sbom.cdx.json` and can be regenerated with:

```sh
pnpm sbom --sbom-format cyclonedx --prod --out security/sbom.cdx.json
```

The machine-readable before/after result is stored in `security/dependency-audit-summary.json`.

## Azure probes and monitoring

Container App `ca-develocrm-api-pilot` has:

- liveness: `GET /health`, port 3001, 30-second interval;
- readiness: `GET /ready`, port 3001, 10-second interval, including a database ping.

Revision `ca-develocrm-api-pilot--security-p0-5392da9` was verified `Healthy` and `Running`. Both public endpoints returned HTTP 200.

The following enabled severity-2 Azure Monitor metric alerts exist in `rg-develocrm-pilot`:

- `develocrm-api-5xx`
- `develocrm-api-readiness`
- `develocrm-api-no-replicas`
- `develocrm-api-restarts`
- `develocrm-api-latency`
- `develocrm-auth-401-spike`
- `develocrm-auth-403-spike`
- `develocrm-pg-cpu`
- `develocrm-pg-memory`
- `develocrm-pg-storage`
- `develocrm-pg-connections-failed`

All listed alerts use the enabled Action Group `ag-develocrm-pilot-alerts` (`dcrm-pilot`). Its `AdamLiptak` e-mail receiver is enabled for `adam.liptak@immobuilding.cz` and uses Azure Common Alert Schema. The Action Group is tagged for DeveloCRM, the pilot environment and Security Phase 0.

Notification routing was verified on 13 September 2026 with a temporary severity-4 metric alert against the Container App replica metric. The alert entered the `Fired` state and invoked the configured Action Group without changing application or database state. The temporary alert rule was deleted after the test. Azure confirms dispatch through the alert pipeline; final mailbox receipt remains verifiable only by the recipient.

PostgreSQL diagnostic setting `develocrm-phase0` sends `PostgreSQLLogs`, sessions, database transactions, table statistics and all metrics to `log-develocrm-pilot`. `log_statement=none` and `log_min_duration_statement=-1`; SQL text logging and Query Store SQL-text categories were not enabled.

The reproducible Container Apps probe definition is `infra/azure/containerapp-api-phase0.yaml`.

## Restore validation

A point-in-time restore for `2026-09-11T17:43:27Z` into the isolated temporary server `pg-develocrm-p0-restore-0911` completed in approximately seven minutes. The pilot server and its backup settings were not changed.

The source and restore were compared with transactions forced to read-only. Both contained 36 applied migrations through `0036_handover_status_and_history.sql`. Counts matched exactly for all checked data sets: 1 tenant, 2 project records, 19 units, 49 accessories, 52 accessory assignments, 15 parties, 13 sales cases, 11 contracts, 11 contract versions, 7 payment obligations, 6 payment transactions, 4 handovers, 1 task, 202 audit records and 200 outbox events; both also contained zero documents and zero project-structure records.

After validation, the temporary firewall rule was removed from the pilot server and Azure confirmed that `pg-develocrm-p0-restore-0911` no longer exists. The temporary restore server and all firewall rules owned by the validation were therefore cleaned up.

## Verification

- Backend TypeScript build: pass.
- Backend tests: 158/158 pass, including clean migration chain, RLS/FORCE RLS, cross-tenant/project scenarios, all business blocks and Phase 0 media authorization.
- Frontend production build and UX tests: 120/120 pass.
- ESLint: 0 errors, 12 existing warnings.
- Published-preview authenticated reload and navigation: pass; no browser console warnings or errors observed.
- Current production endpoints `/health` and `/ready`: HTTP 200.

The authorization evidence is indexed in `security/authorization-matrix.md`.

## Closure checklist

1. Action Group e-mail receiver supplied and attached: complete.
2. Backend image containing migration `0037_security_phase0_media.sql` and protected media endpoints deployed: complete.
3. Migration executed through the dedicated migration image/job before backend traffic shift: complete.
4. Matching Sites build published with production API, tenant and Entra settings and without browser/demo fallback: complete.
5. Authenticated and unauthorized media scenarios verified: complete.
6. API, readiness, replica, restart, latency, authentication and PostgreSQL alerts connected to the Action Group: complete.
7. Source regression verification and published-preview smoke tests: complete.
8. Security Phase 1 was not started.

# Exact document evidence coverage

## Verified gap

The operator-only consistency checker physically verified fully signed main
contract versions and approved templates, but omitted contract appendices,
frozen generation appendix bundles and partial-signature evidence. Inner joins
also silently omitted references whose document version could not be resolved.
This did not remove the existing signing-time guards, but made the readiness
report incomplete as evidence of long-term document integrity.

## Change

- Reuse the existing read-only checker and existing document/version model.
- Verify exact final contract documents, numbered appendices of frozen/signed
  versions, immutable generation appendix snapshots and approved templates.
- Include evidence after the first party signature; a fully signed contract
  must still have a fully signed logical version.
- Compare live appendix associations to the exact generation snapshot and
  report mismatches as critical, without changing either one.
- Left joins keep unresolvable references visible. Project/document context,
  configured managed identity and sensitive-document permission are checked
  before Graph reads. No arbitrary site or drive can be supplied by the caller.
- Download the pinned native version, compare SHA-256 and reuse a downloaded
  hash within one run when several associations reference the same exact file.
- Failed reads and hash mismatches both make physical evidence incomplete.
  Reports contain safe entity references, not storage keys, tokens or raw errors.
- Also fixed a missing explicit type in the previous PDF HTTP transport test.
  No business workflows, authorization mapping, legal templates or data change.

## Verification

- Full backend suite: 494 passed, zero failed/skipped, including native
  PostgreSQL and concurrency fixtures.
- Real SQL tests cover frozen appendices, exact native version selection,
  cross-tenant/project exclusion and corrupted snapshot detection. Corruption
  is simulated only in disposable test databases and rolled back.
- Unit tests cover missing/inaccessible files, deduplication, safe reporting and
  failure of the release gate when evidence is incomplete.
- Backend production build, frontend TypeScript, changed-file lint and diff
  checks passed. No frontend sources or database migrations changed.
- Deployment and live read-only verification are recorded below only after
  they have actually completed. Pending legal content/appendix approvals are
  not bypassed by this technical change.

## Deployment

- Implementation commit: `c5b9ba0`, pushed to private GitHub.
- ACR build `cg4w` succeeded. API digest:
  `sha256:58ab285837bfea8b7d3b32e6c0ab805b336911aaa68992058fe8eb84dd1b0bef`.
- Active revision `ca-develocrm-api-pilot--exact-evidence-c5b9ba0`:
  Healthy, Running, 100% traffic; latest and ready revisions match.
- `/health` and `/ready`: 200. Sampled new-revision logs: no 5xx/RLS findings.
- Authenticated browser reload of the existing technical `TECH62-PREPARE-RS`
  succeeded. Readiness warnings/legal activation gates remained visible;
  no signature, appendix association or business mutation was submitted.
- No migration; schema stays at 0071. No frontend source changes or republish;
  compatible private Sites 160 retained. Previous healthy API revision retained
  for rollback. Local test PostgreSQL stopped after verification.

## Additional read-only business-data gap

The supplied catalogue archive has 19 main unit sheets plus a separate 519 sauna
variant. Positional PDF text extraction confirmed each main sheet's unit number;
the complete 417 sheet was also rendered and visually inspected. Do not resolve
the sauna variant by filename/order or automatically assign either variant.

Runtime execution `job-develocrm-hold-expiry-zuah6vf` succeeded and compared the
19 main sheets' floor and usable areas to the current authorized Dejvice units.
All 19 floor areas differ; three usable areas agree and sixteen differ. No unit
is missing and no database value was changed. This is a source-data discrepancy,
not evidence that either source should automatically overwrite the other.

Example 417: current CRM floor area 123.44 m² and usable area 114.30 m²;
the supplied catalogue states 125.26 m² and 114.39 m². The importer contains the
same values as current CRM; the contract mapper correctly reads `unit.area_m2`
for its floor-area field. This is therefore not a frontend rounding/fallback
defect. The authoritative current areas must be confirmed before legal use.
Adam was asked to confirm whether the new catalogue sheets are authoritative;
no historical/signed snapshot or current unit data has been updated.

## Live expanded audit

Execution `job-develocrm-hold-expiry-fbkwaff` ran the new checker using the
runtime database role and existing managed identity, without writes. Coverage
is complete, but the release decision is **not ready**: seven critical findings,
six warnings and eight unchanged reviewed legacy evidence exceptions. The seven
critical findings are four approved-template/source-version hash metadata
disagreements, the existing `TECH60-BLOCKED` reservation inconsistency, and two
unverified final documents of old technical contracts (`RS-TECH-2026-001` and
`RS TECH-GEN-3BB`). Physical evidence is therefore incomplete, not verified.

The template metadata check is stricter than the previous physical-only
template comparison. A disagreement does not by itself prove that physical
bytes were tampered with; its exact metadata cause requires further read-only
inspection. No findings were suppressed or reclassified to obtain a passing
gate. Health/readiness HTTP 200 is service availability, not legal/business
readiness. The operator audit exits unsuccessfully when it finds blockers;
this is not an API deployment or startup failure.

No data repair, document ingestion, legal-template approval, signature or
financial mutation was performed in this package. Pending source-file security
and classification confirmations from the previous package remain in force.

### Follow-up root causes (read-only)

Execution `job-develocrm-hold-expiry-8xjzqbw` succeeded. All four hash-mismatch
templates were created before 0057, have completed uploads and non-empty but
different checksums in the template and document-version records. Exact physical
bytes match the template hash, not the old document-version checksum. Prefix
normalization does not resolve the difference. No legacy record was corrected
or silently marked compliant.

Both unverified contract versions are unsigned and superseded, with valid
project/document pairs, native IDs and completed uploads. Controlled execution
`job-develocrm-hold-expiry-bvk3z56` proved the native IDs are actually listed.
For each exact version, JSON Accept returns 406 `notAcceptable`, while binary
Accept returns 200 with the expected document hash (beta and v1.0 both tested).
The two physical-read findings therefore reveal an adapter transport defect,
not missing files. See the separate exact-version transport fix report.

`TECH60-BLOCKED` has an active reservation hold with `is_expirable=false`, an
active sales case at reservation stage, cancelled RS and draft SBK. This confirms
the old technical state rather than a current signed legal obligation. No
historical reconciliation or automatic archive was performed.

### Verified follow-up (23 October)

The matching binary-content fix is deployed as `801a27d`. Read-only execution
`job-develocrm-hold-expiry-x9zzfwq` confirms both previously inaccessible native
versions now match their document-version hashes. Full physical evidence
coverage is verified. The consistency gate remains failed on five existing
critical findings (four pre-0057 metadata discrepancies and TECH60-BLOCKED),
six warnings and eight reviewed legacy findings. Nothing was silently repaired.
See `sharepoint-exact-version-read-2026-10-21.md` for deployment and read evidence.

Adam has now confirmed the supplied catalogues as authoritative current area
data. Applying these values to the 19 real units is a separate, explicitly
requested approval; no update has yet been executed. Signed documents and
generation snapshots remain immutable regardless of current-area corrections.

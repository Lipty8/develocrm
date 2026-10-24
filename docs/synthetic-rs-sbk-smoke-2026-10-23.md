# Isolated RS to SBK technical smoke

This operator harness exercises existing domain services and the configured
SharePoint upload pipeline. It does not activate any supplied legal original,
alter an existing deal, send money, or prove legal-content readiness.

## Scope and safeguards

- New fixture project only: TECH72, exact project UUID required on resume.
- Project name alone is insufficient: the same actor's ownership audit marker
  is required. Recovery of a missing marker additionally requires a recent
  domain creation audit and an empty project with the exact technical note.
- Runtime database role must be non-superuser, subject to RLS, and authorized
  for system management. Project operations retain their own permission checks.
- Generated fixture DOCX files contain no legal prose. Both explicitly state
  that they are invalid technical files and create no obligation. Their hashes
  and exact authoritative placeholder schemas are checked before any mutation.
- Existing template upload, validation and approval services are used only for
  these newly created synthetic templates in this isolated project. Real
  parameterized RS/SBK versions remain subject to separate content approval.
- Exact persisted source XML is checked before synthetic approval. Generation,
  SharePoint upload, immutable document evidence and ledger services are reused.
- Signatures are deliberately not performed by the operator harness: the
  browser must exercise the existing evidence/signature action.
- Repeated upload/generation requests use stable idempotency keys; appendix
  selection uses the current expected-version token. Active accessory links
  must point to the same test unit before they can be reused.
- Cleanup retires only the synthetic templates and archives the new technical
  project; SharePoint files and audit/history are not deleted.
- No automatic schedule or API deployment is introduced. The launcher uses a
  one-execution override of the existing job with the current immutable API
  image. It does not change that job's scheduled definition.

## Verification so far

- Six harness guard tests passed, including context/confirmation, no adoption
  by name, archived-project restrictions, exact RS/SBK schemas/hashes, invalid
  files and safe error output.
- Sixteen existing generation/payment-plan tests passed, including the actual
  mapper, renderer, upload-service recovery and PostgreSQL numeric comparison.
- Backend TypeScript no-emit check and changed-script ESLint passed.
- Both technical Word fixtures rendered successfully; all four pages were
  inspected. This is fixture QA, not comparison of legal originals.
- Current backend revision was verified as
  `ca-develocrm-api-pilot--sbk-v2-9b7bd71`, Running, with the expected immutable
  image digest. No backend or frontend deployment was needed for this harness.

## Live execution evidence

1. `job-develocrm-hold-expiry-b1rfw93`: Failed. A PostgreSQL parameter-type
   ambiguity (`42P08`) in the new harness's ownership-audit INSERT occurred
   after creation of the empty technical project, before units/contracts or
   SharePoint upload. This is not a production workflow defect. Automatic job
   retries refused to adopt that project without an explicit UUID.
2. Fixed explicit UUID casts and made future domain creation plus ownership
   audit atomic in a single transaction.
3. `job-develocrm-hold-expiry-40choot`: Succeeded. Recovered only the empty
   fixture's marker after exact UUID, same-actor recent domain creation and
   zero-child checks. No name-based adoption of another project.
4. `job-develocrm-hold-expiry-ki3yai6`: Succeeded. Created the technical unit,
   accessories, buyer and pre-reservation through existing operations; uploaded
   and validated the synthetic template; generated RS and retried the same
   request without duplication. Exact persisted Word file evidence verified,
   44,231 bytes. Contract `36e1a199-aa94-4d8a-8191-1246de446ea9`, current version
   `a2f944d2-347e-45fd-bd60-234398b3a137`, unit
   `3ed7e245-12ad-4956-9898-d18a01788692`. Signing remains a browser step.

Technical project UUID: `b25ea9f3-0dcd-4c67-a6d4-e7e521f0c6e8`.
Authenticated browser as Adam displayed the exact technical RS as Approved,
document ready, version 1, price 5,000,000 + accessories 500,000 = 5,500,000 CZK,
and fee 250,000 CZK. The signature modal opened with that exact document.
Automatic confirmation was rejected because its checkbox asserts an actual
signature rather than a simulation. No backend workaround was attempted. The
dialog was handed to Adam for the explicitly technical scenario. Adam confirmed
completion; a new authenticated detail navigation then displayed Signed,
signed document version 1 and signature evidence. The existing generation
capability and evidence controls were not bypassed.

SBK preparation executions `job-develocrm-hold-expiry-v81mg05` and
`job-develocrm-hold-expiry-lnlth4j` failed. The latter identified
`contract_appendices_required` at `sbk.generate`, after successful readiness.
The persisted jsonb appendix descriptor key order caused a false schema
rejection before generated-output reservation/upload. See the separate JSONB
correction report. These are failures, not a passed SBK smoke.

After deployment of `4dc5624`, matching execution
`job-develocrm-hold-expiry-g0jxyjm` Succeeded. The same SBK request generated,
uploaded, bound and retried without duplication. Exact physical Word (43,736
bytes) and appendix evidence were verified. Contract
`5216b67d-c508-405e-bf2c-be839658032d`, version
`07e52631-8a65-4582-a335-a4f462dfd334`. No real legal template was activated.

### Final verifier hardening (2026-10-24)

The read-only verify mode now rejects inconsistent unit/case/contract context,
an unlocked or unbound signed version, incomplete required signatures, a
signature timestamp other than the last required signature, duplicate/missing
signature audit/status/outbox events, and duplicate generation/version rows in
this deliberately single-version fixture. It checks the existing central sales
projection for completed RS/SBK, current KS and the next KS action, alongside
the persisted active case and contracted unit. It does not calculate another
workflow projection.

Payment due dates are compared with `originalPaymentPlan` using the actual
signed timestamp, not just a non-null due date. The fixture has no final notice,
so a prematurely materialized final installment is rejected. The SQL queries
inside verify run in read-only transactions. New negative tests include wrong
case/version, an available unit, stale RS CTA, incomplete signatures, duplicate
generation/audit and an incorrect deadline across the 28 October holiday.
All 10 harness tests passed. This is local verifier coverage, not proof of the
still-pending live SBK signature or its resulting persisted financial state.

### Live signed-chain verification (24 October)

Adam completed the SBK signature manually. A fresh authenticated detail reload
displayed Signed, document version 1 and signature evidence recorded at
24 October 10:33 Europe/Prague. The exact document remained downloadable.

Execution `job-develocrm-hold-expiry-1g39y19` Failed after both signed-document
reads: the verifier incorrectly asked the preparation repository for payment
terms. That repository deliberately excludes signed contracts. This was a smoke
harness defect, not a failed signature or production payment mutation. The
verifier now reads the exact locked signed version's persisted payment snapshot
with tenant/project/contract/version and permission checks. Eleven harness tests
and changed-script lint passed, including the new signed-snapshot regression.

Corrected execution `job-develocrm-hold-expiry-9ojmcyp` Succeeded using the
existing immutable ready API image `ca-develocrm-api-pilot--sbk-jsonb-4dc5624`.
The `smoke.sbk_chain_verified` result confirmed:

- Exact native document versions and content hashes for both RS and SBK,
  without unresolved placeholders.
- One signed, locked logical version and one completed generation per contract;
  all required parties signed that version. The contract/version timestamp
  equals the last required signature.
- Exactly one signature audit record, status event and outbox event per contract.
- Same active sales case `7e750c52-2cd1-4696-b88a-ee86caf3d1a2` and unit7201;
  persisted unit status contracted/SBK, completed RS/SBK and central next action KS.
- Exactly one SBK obligation: 1,100,000 CZK, exact SBK version, correct case/unit,
  due 2 November 2026 (five Czech working days after the actual signature,
  excluding the 28 October public holiday). No premature final installment.

Authenticated browser navigation from the signed SBK to unit7201 displayed SBK,
RS/SBK Hotovo and KS Následující krok. Unit Payments showed the existing
250,000 CZK technical fee plus the new 1,100,000 CZK installment, consistent with
the contract detail. The final 4,150,000 CZK remained awaiting evidenced delivery
of the notice, with no invented due date. No KS or notice was created.

The verification did not write business data, resend a signature or change job
configuration. No runtime deployment or migration is needed for the harness
correction. Cleanup remains deferred; TECH72 files/history remain intact. This
passed synthetic chain is **not** an approved-original RS/SBK production E2E or
permission to activate legal templates.

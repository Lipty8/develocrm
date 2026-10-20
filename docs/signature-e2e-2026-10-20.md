# Signature evidence and RS/SBK payment E2E

Status: signature/payment technical E2E passed on 20 October 2026. Legal original
profiles remain review-only; this is not approval of their content or activation.

## Confirmed pilot evidence

- User confirmed the outstanding native confirmation for RS TECH66-A.
- Read-only execution `caj-develocrm-migrations-pilot-bkht274` shows RS
  `bfcacf61-2b48-4068-a2e9-68a1e36cf810` signed, exact contract version
  `71d74ae4-bf3e-4202-acca-de9d792a1429`, document version
  `13f50650-8e03-4cf1-89b3-c8baa73d2f3d`, unit reserved.
- The actual persisted signature is **19 October 2026**, not the intended
  backdated 16 October mentioned in the test note. The browser automation/date
  input did not prove that backdated case. Signed evidence is not rewritten.
- Exactly one RS prescription exists: 200,000 CZK, schedule `rs_fee`, due on
  **22 October 2026** (Prague), correctly three working days after the stored
  signature. UI agrees after reload and shows RS done / SBK next on the unit.
- Only a clearly labeled technical ledger simulation recorded the 200,000 CZK
  fee. No money was sent and no real client's payment history was changed.
- Unit contract chooser disables a duplicate RS, offers SBK in the same case,
  carries buyer/unit automatically and asks for neither arbitrary SBK amount nor
  creation-relative due date. Further SBK signature/notice verification pending.

## Signature confirmation UI follow-up

The existing signature modal opened a second native browser confirmation. This
blocked the browser control and required an unnecessary user handoff. It now uses
the existing modal's visible checkbox, like contract termination, before its
single explicit save action. Confirmation is tied to contract ID, business
version, exact document version and date; changing any invalidates it. The UI
clarifies that it records an already performed signature, not an electronic
signing operation. All server evidence, authorization and immutability checks
remain unchanged; no backend/migration change.

Six targeted interaction regressions cover confirmation, no native dialog,
backdated input, changed date/contract/document, missing version, future date and
server failure. Full interaction suite 105/105, static regression 143/143,
TypeScript, changed-file lint and production build passed. Test typing issues
(Testing Library role options and nested fixture excess properties) were fixed,
not suppressed. Existing large-bundle/static-analysis warnings remain.

## Deployment and authenticated browser verification

- Frontend source `68b160594e5f2e558310d387967ea408f44fc048`, private Sites **154**,
  deployment `appgdep_6ad715b3a2b48191b86af17a678ad5b1` Succeeded. Matching Sites
  commit `d307efe12a0315efd062131d9ef69dc1a02b90d4` has the identical Git tree
  `2120f904643be239e9f8c90d32291323475c448b`. Access remains private.
- Backend unchanged: `ca-develocrm-api-pilot--signature-payments-44a77fd`, API
  digest `sha256:57a0d6168ec528e69cf4dee3355fd3347df8ee91c5f366f9fa76141303109a33`.
  Latest migration remains 0066; no migration or backend build for this UI fix.
- New confirmation tested in the authenticated browser: submitting unchecked
  keeps the modal open with a Czech validation message and no signature.
  Checking the explicit confirmation then records only the technical SBK.
  No second native dialog is opened.
- SBK `d493cafc-07fa-4f49-a4db-e3d981fb34bb`, business version
  `45287126-e840-420a-ae7e-300fda150f98`, exact document version
  `53447933-5cc3-47d4-a55b-7e41989a6cec`, signed 20 October 2026.
- Both contracts belong to the same case
  `43a44220-5b89-4f7e-bc77-5af876efa54a`. Read-only pre-sign execution
  `caj-develocrm-migrations-pilot-h49bs07` Succeeded and confirmed the draft SBK
  had zero prescriptions, a frozen 2,000,000 CZK first installment and
  7,800,000 CZK final installment, including the 200,000 CZK RS credit.
- Signature creates exactly one first SBK prescription: **2,000,000 CZK**, due
  **27 October 2026** (five Czech working days after 20 October). Until delivery
  evidence, the final installment remains unmaterialized and has no due date.
- Recorded only a clearly non-binding technical delivery proof, delivered
  **20 October 2026**, through the existing SharePoint pipeline. Exactly one
  final prescription then appears: **7,800,000 CZK**, due **19 November 2026**
  (30 calendar days). No further record-delivery CTA remains.
- Reload preserves the signed document, delivery date, due dates and all three
  prescriptions. The unit payment view agrees: total 10,000,000 CZK, technical
  paid fee 200,000 CZK, exactly three prescriptions. Unit timeline shows RS/SBK
  done and KS next; stored commercial status is `contracted`, case stage `sbk`.
- Downloaded the exact signed SBK version through the authenticated CRM proxy.
  Original and downloaded PDF hashes both equal
  `7bd0dbcb9f8068f1ea5de3894068d77c7740d98d1ef9d535a9b13eb14063769b`.
  Both contract document versions have SharePoint native version `1.0`, ready
  status, hashes and complete drive/item/web metadata. No storage keys or tokens
  are included in this report.
- Final read-only execution `caj-develocrm-migrations-pilot-4j99awf` confirms
  two signed contracts, one active case, three obligations, one notice event,
  three obligation audit/outbox events and one notice audit/outbox event.
  An initial diagnostic execution lacked the explicit DATABASE_URL secret
  reference and failed with ECONNREFUSED; it performed no writes. Rerun used
  the existing `database-admin-url` Key Vault reference, without exposing secrets.
- `/health` and `/ready` both returned 200. No browser warnings/errors were
  captured; the inspected API log window from 07:15 UTC contained no matching
  5xx/RLS/unhandled/fatal errors. Existing pg SSL-mode deprecation warning remains.

Limits: live HTTP duplicate replay and reverse party-signature recording were
not performed in this browser run; their idempotency/concurrency coverage is in
the previously passed real PostgreSQL suite. No backdated-signature browser
claim, original-template generation acceptance, legal approval, electronic
signature or real payment is implied. No real historical case was changed.
Original-profile data completeness and filled Word content review remain gates
before activation for ordinary users.

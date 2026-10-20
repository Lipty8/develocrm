# Signature evidence and RS/SBK payment E2E

Status: in progress, technical data only. Legal original profiles remain review-only.

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

Pending: deploy the frontend follow-up, verify the checkbox in a real browser,
complete SBK signature/delivery, compare DB/UI/SharePoint after reload. No claim
of original-template production acceptance or legal-content approval.

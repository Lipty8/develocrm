# Client preparation and duplicate review in the sales flow

## Authenticated runtime findings

Owned synthetic project TECH74 only. From unit 7403, created RS draft
`154c8e1a-437e-4ba3-85d1-402f01c9f38a` using the ordinary UI. Context showed the
correct buyer, unit UUID, 5,100,000 CZK, 102,000 CZK fee and unit symbol 7403.
No premature financial obligation appeared. Readiness correctly blocked an
incompatible complete accessory variant and absent exact appendices.

The buyer link preserved a return link to this exact contract. Filled synthetic
salutation, DOB, phone and residence/delivery addresses through the standard
client edit form. Returning to the same RS removed all four buyer readiness
errors. The remaining variant/appendix/date requirements were not bypassed.

On free technical unit 7402, entered the same synthetic email using create-new
inside negotiation. The backend rejected the duplicate, but the modal displayed
only an instruction to use the existing client or confirm a new one. Neither
candidate selection nor override was actually available in this flow.

## Fix

- Reuse one extracted `ClientDuplicateReview` in both standalone client creation
  and sales interest/hold creation; no new duplicate algorithm or endpoint.
- Sales creation performs the existing authorized server duplicate preflight.
  Failures remain blocking. Backend creation still performs the decisive check.
- Candidate cards show available contacts, project/unit context, strength and
  reasons; open, select existing UUID, or explicitly override.
- Selecting a match outside the loaded directory page adds only a local picker
  choice, not a new canonical party. Submission uses the exact existing ID.
- An explicit duplicate override is forwarded to the existing audited backend
  operation; changing entered identity/contact values clears that consent.
- A new negotiation no longer silently preselects the first directory client.
  A buyer/interest already belonging to this unit remains a valid preselection.
- No migration, backend deployment, permission or normalization changes.

## Tests

- Typecheck, lint, production build: passed.
- Interaction suite: 162 passed, no failures/skips; six additional cases cover
  interest/hold reuse, out-of-page UUID, blocking technical failure and retry,
  override/reset, shared open action and no implicit first-client selection.
- Static regression suite: 143 passed; source assertions now check the shared
  component and both consumers, rather than assuming all text lives in CRMApp.
- Existing backend party/pre-reservation and integrity suites: 6 passed, no
  failures/skips (atomic creation, create permission, duplicate normalization,
  lifecycle and relationship checks). No native concurrency claim for this UI-only fix.

Published verification will be appended after deployment.

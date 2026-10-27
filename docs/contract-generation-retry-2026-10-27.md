# Contract generation outcome recovery

## Reproduced problem

The existing RS/SBK panel preserved its operation key after an uncertain error,
as required for safe replay. However, after readiness discovered the document
that had already been created, the button changed to `Vytvořit novou verzi`.
It still sent the old key, so the backend correctly returned the old result,
not a new version. This was a misleading workflow action, not evidence of a
duplicate physical upload. A real-component regression failed on this exact
button before the fix.

## Small frontend correction

- An unresolved attempt has an explicit `Ověřit předchozí generování` action
  using the same operation key. The panel does not offer a new business version
  until the previous result has been recovered successfully.
- Recovery is still available if the following readiness read fails. The server
  remains responsible for authorization, current domain invariants, validation
  and safe replay; the browser does not fabricate success or render data.
- On success, the key is cleared. A subsequent explicit new-version action
  gets a new key and can create a new business version normally.
- Only HTTP 422 with the route's structured preflight issues is classified as
  a definite pre-render rejection. It clears the attempt so the user can fix
  CRM data and submit again. Generic 409/503 or transport failures do not prove
  that upload never happened and keep their original key.
- Mutable appendix, signature-plan and payment-plan controls in this panel stay
  disabled while its previous generation outcome is unresolved.
- No backend/migration/upload implementation, legal text, permission or financial
  rule is changed. Existing version and immutable-evidence guards remain decisive.

## Scope and remaining audit

This addresses retry within the open panel, not durable recovery of a forgotten
key after browser closure. Read-only code review confirms that the generation
repository prevents a new key while an old operation is reserved or unbound.
That prevents blindly starting another operation, but a user-facing authorized
recovery path after reload needs a separate audit using the persisted generation
operation. Do not claim it is implemented here or remove that existing guard.

## Verification

Targeted interaction/transport tests cover RS and SBK lost-response recovery,
one replay followed by a genuine new version with a new key, definite validation
rejection, failed readiness recovery, existing permission gating and transport
409/422/503 classification. Frontend typecheck, lint, production build,
181 interaction tests and 143 static regression tests passed. Live preview
evidence will be added only when completed. No live network outage or pilot business mutation is used
to simulate a lost response.

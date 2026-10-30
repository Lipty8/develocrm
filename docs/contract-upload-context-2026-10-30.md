# Contract external-upload context safety

## Reproduced defect

`ContractDocumentEvidence` kept its selected file, idempotency key, busy state
and error across a React rerender for another contract or contract version.
Its parent does not key the detail by contract. Two controlled interaction
tests proved that the upload button stayed enabled with the old file after
switching either identity; a third showed that the old upload had no abort
signal. The existing exact-download component already protected its own scope,
but that did not protect the separate external-upload form.

## Correction

- The form is scoped to contract ID, contract-version ID, exact document-version
  ID, version state and upload eligibility. A different context remounts the
  form and clears the native file picker as well as React state.
- Cleanup aborts file reading and the fetch. A late FileReader completion is
  checked before any request; a late response cannot show errors, clear a new
  selection or call the old detail refresh callback.
- A synchronous request ref also prevents overlapping submission attempts.
- Failed requests in the same context retain the selected file and original
  idempotency key, preserving the existing retry behavior.
- Successful upload uses the existing `onChanged` commercial refresh, not a
  workspace-wide bootstrap. Late responses no longer trigger global mutation
  invalidation. No new upload implementation or domain operation was added.

Browser cancellation is not a server-side rollback: an already accepted request
may still finish for its original contract. Existing backend authorization,
signature immutability, transaction checks, audit and idempotency remain the
authority. This change does not claim to cancel a committed upload or add an
optimistic-lock precondition to the upload API.

## Verification

- Before correction: 12 existing focused tests passed, 3 new regressions failed.
- After correction: all 17 focused document-evidence interactions passed.
- Full frontend interactions: 227 passed, zero failed/skipped.
- Frontend static tests: 145 passed, zero failed/skipped.
- TypeScript typecheck, lint and production build passed.
- No backend, migration, dependency, legal content or business-data change.
- Deferred RS312 facts were not requested, inferred or replaced with test data.

Pilot publication and read-only browser verification are recorded after the
matching deployment; the automated context-switch tests are not presented as
a live upload to a real contract.

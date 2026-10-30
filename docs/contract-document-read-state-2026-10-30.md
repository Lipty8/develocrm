# Contract document-tab read-state isolation

## Reproduced issue

The contract detail kept document rows in independent React state and fetched
them with an effect using `then(...).finally(...)` without a rejection handler.
Changing the selected contract while staying on Documents left the prior rows
visible. An old request could also finish after cancellation and replace the
current rows, because only an AbortSignal was passed to the repository, with
no response identity check in the component.

A controlled regression loaded `CONTRACT-A-DOC`, rerendered the actual
ContractDetail for another contract and observed the previous document still
present. This is a UI-context defect, not evidence of an RLS data leak: both
responses still came from their separately authorized original requests.

## Correction

The detail now uses the existing `useAsyncRead` and `AsyncNotice` shared with
other document panels. The read key includes the contract identity, selected
tab and current update/version markers. Rows from another key disappear in
the first render, cancelled responses/rejections are ignored, and loading,
failure, permission denial and a successful empty result are distinct.

The repository still receives the same contract ID and AbortSignal. Fetching
is deferred until Documents is selected; leaving the tab aborts the request.
Retry uses the existing hook, not a new cache or workflow mechanism.

Navigation audit also confirmed that the common client resolver rejects
ambiguous duplicate names instead of selecting the first person, and the
contract-party links use party IDs. No unrelated navigation rewrite was made.

## Boundaries and follow-up

- No API mutation, backend, database migration, pricing, legal wording,
  permissions, document storage or actual buyer data was changed.
- This is separate from external-file selection correction `d617a02`.
  Its pending publication approval is not authorization to substitute a later
  source tree. The Sites checkout has not been resynchronized with this change.
- The backend document GET routes still have a catch-all 403 classification.
  The frontend now handles the received status safely, but an unexpected DB
  error can still be mislabeled by that API. This is an identified, separate
  follow-up; the activity-route correction does not automatically cover it.
- Deferred RS312 data remains untouched. No empty or invented contractual
  values were used to bypass generation readiness.

## Verification

Six new interactions cover immediate hiding of previous rows, aborted late
response, 403 and 500 with retry, real empty results versus safe technical
errors, and leaving the tab before a late rejection. The original stale-row
regression failed before correction and passed after correction.

The first red assertion attempted to print a React DOM element and exhausted
the test process's memory. It was changed to a boolean presence assertion,
which then produced the expected concise `true !== false` reproduction.
Typecheck caught Testing Library's unsupported `exact` option; anchored role
name regexes were used instead, without weakening compiler settings.

Final full frontend verification: **233 interactions and 145 static tests
passed, zero failed/skipped**; typecheck, lint and production build passed.
This follow-up is committed to GitHub but is **not published**: the earlier
Sites approval gate is still pending. No backend deployment or migration was
needed. No pilot write smoke is needed or claimed for this read-only
presentation correction; live verification of this source remains pending
matching publication.

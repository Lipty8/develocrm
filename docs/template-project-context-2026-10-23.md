# Preserve the contract's project when navigating to templates

## Reproduced problem

Authenticated browser navigation from TECH62-PREPARE-RS to
`/contracts?view=templates&project=<project UUID>&returnTo=<contract route>`
showed All projects and unrelated templates. `TemplateAdminPage` initialized a
local empty project state and never read the URL parameter. This was not a
backend authorization bypass: the backend still returned only authorized data,
but the intended business context was lost.

The old post-mutation refresh also had no cancellation/context guard. It could
finish after a project switch and replace the current list with old rows.

## Focused change

- URL `project` and `templateType` are the single source of filter state.
  Existing routing helpers preserve `returnTo`, `view` and unrelated parameters.
  Reload/back navigation restores the same filters.
- The existing shared `useAsyncRead` handles cancellation, scope identity,
  retries and immediate hiding of old data. No second request-state subsystem.
- A scope-keyed list resets selection and an unsaved upload modal on context
  changes. Upload is disabled during loading/errors and for unavailable
  projects, rather than silently targeting the first project.
- A project not in the authorized options remains explicit; it never becomes
  an unfiltered query. The server remains the authorization authority.
- Existing `ReadError`/`AsyncNotice` distinguish permission denial, loading,
  request failure and an actually empty list. No raw backend error is rendered
  by this list.
- No domain/RBAC/RLS, legal-content/approval, Graph, schema or business-data
  changes. Backend and migration 0071 remain unchanged.

## Regression evidence

Six actual-component interaction tests cover initial contract link, type
filtering, return URL preservation, reload, explicit all-project selection,
out-of-order responses with aborted old requests, permission denial/retry,
unavailable project, lifecycle completion after a switch, and unmounting an
unsaved upload. Frontend TypeScript and changed-file lint passed. Full test
and production build/deployment results are recorded only after completion.

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

## Deployment and authenticated read-only E2E

- GitHub implementation `5a72e1086b1629a819619e16cb23a2ff4303167a`, pushed.
- Frontend 143/143 and interaction 121/121 passed; frontend TypeScript,
  changed-file lint, diff check and official production build passed. Existing
  large-chunk and Babel-size notices remain informational, not new failures.
- Sites source `3ce010be41b18f7c05c38907b4e0eaa8896505cd` has the exact matching
  Git tree `dbdb933220b586d4e276c3181aaaaef39cf4f5a5` with GitHub. Sites **162**,
  deployment `appgdep_6adb3990694c8191995f395cb7d3d8ea` succeeded. Owner-private
  custom access preserved, zero external viewers.
- Authenticated browser as Adam: the original project-scoped link now selects
  TECH SMOKE 0062 and displays only its three templates, not unrelated projects.
  Selecting SBK preserves the project/return URL and displays only its two SBK
  variants. A full reload preserves both filters and the exact return link.
- Selecting TECH67 DELIVERY SBK and opening the upload modal prefilled the same
  project, SBK type and v2 variant. The modal was cancelled without choosing a
  file, validation, approval or upload. The template remains Concept.
- Backend unchanged at `ca-develocrm-api-pilot--sbk-v2-9b7bd71`, no ACR build,
  backend rollout or migration for this frontend-only fix. Health/ready 200;
  sampled runtime logs during the smoke had no HTTP 5xx or RLS findings.
- No real or technical business data, source file, document version, template
  approval, financial record or SharePoint file was changed in this package.

This closes the observed project-navigation defect, not the complete RS/SBK
production-readiness objective or the separate outstanding legal approvals.

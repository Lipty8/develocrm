# Unit and client document context safety

## Reproduced issue

UnitDocuments caught every document-list error and replaced it with an empty
list plus `previewConnection`. A rejected 403 therefore displayed zero documents
and a false disconnected-SharePoint banner rather than a permission state.
ClientDocuments had no read-error handler at all. Both bespoke effects retained
the previous entity's rows while another request was pending and accepted late
responses after their AbortController had been aborted.

Two real-component interaction tests were run before the fix and failed because
there was no alert or retry after the permission/network failures. The rendered
old UI showed the empty/disconnected fallback. The repaired components reuse the
existing `useAsyncRead` and `AsyncNotice` already used for project documents;
no new fetch framework, document model or storage route was introduced.

## Scope

- Scope includes the unit UUID / client ID, plus the unit category filter.
- A new scope immediately hides old rows and connection state while loading.
- Stale and aborted responses cannot update the current scope.
- Failures use the existing safe error/permission presentation with retry.
- Only a successful empty result is described as an empty document list.
- Client links still open the exact CRM document detail. Document transport,
  SharePoint version/download logic, RBAC/RLS, template approval and signed
  evidence are unchanged. No backend change or migration is needed.

## Verification

Seven targeted tests cover permission failure, retry, safe error wording,
unit/client changes, late response, filter context and exact document navigation.
Full frontend interaction tests, 143 static regressions, typecheck, clean lint
and production build passed. The existing large frontend chunk warning is
unchanged. Authenticated read-only browser verification will be recorded after
publication. No legal template or pilot business data is modified.

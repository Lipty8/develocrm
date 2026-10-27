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
All 174 frontend interaction tests, 143 static regressions, typecheck, clean lint
and production build passed. The existing large frontend chunk warning is
unchanged. Authenticated read-only browser verification will be recorded after
publication. No legal template or pilot business data is modified.

## Published verification

- Runtime source: `5761702aa3014084d92d63b56110879647f766a8` (GitHub).
- Sites source: `51e47d53c42c7d87c964d14775e42f2d99330ab4`.
  Both Git trees: `371a53a6320f99dfb462f29d437cc33206e27007`.
- Sites 175 / deployment `appgdep_6ae0a2d112048191b5658fd52ffe854d`:
  Succeeded, existing owner-only private access unchanged.
- No database migration or backend deployment. Existing backend revision
  `ca-develocrm-api-pilot--pre-close-9843ba9` retained; health/ready HTTP 200.
- Authenticated read-only browser smoke: unit 7406 shows a successful empty
  document list and the actual connected SharePoint status. Unit 7401 shows
  13 existing technical documents. Selecting Smlouva hides old rows during
  loading, then shows only the two expected TECH74 RS/SBK documents.
- From the same unit the current buyer link opens party
  `2ab26f3d-833d-45e7-9564-50909943a35c`. Its document tab shows that client's
  RS/SBK documents; opening the SBK detail resolves exactly to document
  `a961674a-fafe-49f9-8703-fea940b34ac6`, with the correct unit, buyer and
  contract links and existing SharePoint link.
- The failed/forbidden/late-response cases are controlled interaction tests,
  not forced pilot outages or changes to anyone's access. No customer record,
  file, signature, financial record or document metadata was modified.
- Bounded backend log review during the browser check found no 5xx/RLS errors.

This is a scoped correction for unit/client lists, not a claim that every
document-related workspace is fully audited. The separate attachment selectors
and workflow-document attachment screens retain their own existing behavior
and require separate checks before any broader claim.

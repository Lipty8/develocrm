# RS/SBK preparation: preserve the working screen

## Confirmed cause

Saving a signing plan, preparing payment terms and choosing an exact appendix
all used apiFetch's default global invalidation. The CRM listener increments
dataMutationVersion; the main content is keyed by that value, so the complete
working subtree remounts, discarding unsaved sibling form state. Each of these
three preparation operations already has a scoped owner that reloads readiness;
payment/appendix preparation also refreshes the commercial list explicitly.

Before-fix real repository transport test: 3 global invalidations, expected 0.
Before-fix component regression using the actual appendix transport and the
CRM's keyed-main boundary: unsaved planned date 2026-11-05 reverted to stored
2026-11-01 after saving the appendix.

## Correction and scope

Only these three preparation requests opt into the existing
dataInvalidation:none option. Existing requests, payloads, exact version IDs,
optimistic appendix token, RBAC and backend operations are unchanged. Their
existing readiness reload is retained. Generation/signature/lifecycle writes
retain their broader invalidation; a new regression verifies actual generation
still emits it. No backend change, migration, legal template change, new
calculation or dependency is needed.

## Local verification

- Targeted preparation/transport regressions passed after failing before fix.
- 197 frontend interactions, 145 static regressions, frontend typecheck, lint
  and production build passed. Existing large-bundle warning remains unchanged.
- The actual appendix request now preserves unsaved signing dates, refreshes
  the selected exact document and invokes its existing owner callback once.
- Scope/call-site audit found all three writes owned by the existing preparation
  panel/appendix panel; no unrefreshed alternate frontend caller was found.

Pilot publication and browser evidence will be appended after deployment.

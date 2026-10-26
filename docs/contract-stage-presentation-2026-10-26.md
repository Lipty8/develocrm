# Contract stage presentation follows recorded visits

## Reproduction and cause

The live TECH74 SBK was sent, then directly approved and signed. Its original
detail still marked Negotiation completed, although no event entered that
optional stage. Both list and detail used `index < currentIndex`, so order in
the lifecycle was being presented as evidence of actual completed work.
The list also treated a cancelled/terminated contract as current Draft because
the existing index helper falls back to zero for closed statuses. The detail
already explicitly handled closed contracts, creating another inconsistency.

## Narrow presentation correction

`contractWorkflowPresentation` reuses the existing central lifecycle order and
status normalization plus the latest-visit history selector. It is a read-only
presentation function, not a new workflow engine or transition policy.

- The authoritative current stage remains current even with incomplete history.
- A prior stage is completed only with a recorded entry and subsequent exit
  within the same visit. Missing evidence says `Bez záznamu`; it is not asserted
  to be skipped, since legacy histories can also be incomplete.
- Stages after the current one remain pending following a reopened draft.
- Closed contracts have no active stage. Expanded list summaries show their
  actual closed status, not the index-zero fallback.
- Legacy `signing` maps to the existing visible Approved stage. Its transition
  is not a second invented stage or an early completion of that visible visit.
- List and detail render the same shared `ContractWorkflowSteps` component.
  Existing spacing/colors are retained; only documented completions get check
  icons. Detail selection works with accessible names, pressed/current states.

No database, backend transition, signature, payment, permission, document,
template, legal text or real/historical deal was modified.

## Verification

43 focused interaction tests passed. The added tests cover direct approval
without negotiation, missing/invalid history, reopened stages, closed contracts,
legacy signing aliases, equal list/detail states and clickable stage selection.
Full frontend interaction/regression suites, typecheck, lint and production
build are run before publication. Actual pilot verification is recorded only
after the deployed shared view is loaded in the authenticated browser.

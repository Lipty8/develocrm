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

## Deployment and authenticated verification

- Implementation `f33ab71` pushed to private GitHub. Full suites passed:
  143 interaction tests and 143 static frontend regression tests, zero failures
  or skips; typecheck, lint and production build also passed.
- Official Sites helper built and pushed matching source
  `73cf604cde024eb07addbc1be193c4d6b8d35b44`. All 584 tracked files matched;
  both trees were `37e0612b19d453e0ec880ba6c3059494762b9b92`.
- Private Sites **170**, deployment `appgdep_6adfbce6d7b08191ad15fc16f9b0211c`,
  Succeeded. Existing backend and migration 0073 retained. Health/ready: 200.
- Authenticated full reload of TECH74 SBK showed states
  Complete / Complete / Unrecorded / Complete / Current. Negotiation displayed
  `Bez záznamu`; clicking it showed no invented start/end/actor. The same exact
  five states were read from its row in the global signed-contract list.
  The signed exact Word and 1,100,000 CZK obligation due 3 November remained.
- The global all-contracts list contained ten cancelled/terminated records;
  none had a current stage. Expanding the owned TECH60-RELEASE-RS row showed
  `Zrušená`, not Draft. No status-changing action was invoked on any row.
- No browser error-level entries were present in the inspected twenty-entry
  error-log view. These were read-only E2E checks; no fixture or real business
  data were changed in this package.

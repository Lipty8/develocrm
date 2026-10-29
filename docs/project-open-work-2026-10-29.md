# Project overview: actionable work and real deadlines

## Observed cause

After TECH83 was closed successfully, the project still offered six contracts
to finish. `ProjectOverview` counted every status other than signed. It therefore
included the cancelled RS and the Approved SBK retained in the closed case.
The same overview had a hardcoded “23. 7. / Kontrola smluvních dat” deadline.
Neither was evidence of an incorrect database transition.

## Bounded presentation correction

- Shared dashboard attention helper uses the existing normalized contract
  status and sales-case status. Working documents in closed cases and final
  signed/cancelled/terminated contracts are not offered as unfinished work.
- Completed tasks do not appear as open work. The section count is derived
  from the actual open tasks and working contracts shown by that section, not
  the separate project.attention value.
- No “finish contracts” CTA when there are none; a clear empty state is shown.
- Removed the fabricated date and task. Payment deadlines come from actual
  remaining unpaid, non-cancelled obligations, ordered by due date. Handover
  reminders/list use only planned records, ordered by scheduled timestamp.
  The existing configured project milestone remains a fallback, not a new date.
- Project UUID is checked for payment/handover rows as well as contracts/tasks;
  identical display names do not join different projects. This complements,
  and does not replace, backend permission/RLS checks.

History stays accessible in the existing contract/payment/handover lists. This
does not change contractual effectiveness, unit status, payment amounts,
accessories, legal templates or any business data. No migration/backend change.
The project work CTA continues to open its existing Contracts tab, including
its normal filters and full history; no parallel list/workflow was created.

## Tests

- 217 frontend interaction tests passed, zero failures/skips.
- Six business-context/attention unit tests passed, zero failures/skips.
- 145 static frontend tests passed, zero failures/skips.
- Frontend TypeScript, lint and production build passed.
- Regressions cover closed Approved successor, cancelled/signed documents,
  active draft, completed tasks, foreign UUID with identical project name,
  cancelled obligations, completed handovers, real dates/times,
  empty work/deadline states and navigation to the existing contract tab.

Existing build-size and route-classification notices remain. No new dependency.
This package does not resolve missing actual facts/variants/appendices for RS312
or claim whole-workspace readiness.

## Deployment and authenticated read-only smoke

- GitHub `ba8e212a2e3759fd41cc5ca010e543b58015f2a8` pushed to main.
- Matching Sites source `1dbca423ebf6182a79411d01ef33c8ebfb48572d`;
  all 642 files matched, no extra files. Both source Git trees:
  `d656fe32f9dacef3961aeecf5847c65255a8a7a6`.
- Official helper production build/package succeeded. Private Sites **189**,
  deployment `appgdep_6ae3c3f9990481918652b9a2daa9ec40`, Succeeded.
  Existing owner-only audience and environment revision 3 were preserved.
- Backend unchanged: `ca-develocrm-api-pilot--readiness-7dedd5b`, migration
  0083. `/health` and `/ready` each HTTP 200; no new image or migration.
- Authenticated browser reloaded TECH74 project overview: **3** working
  contracts, rather than the old **6**. The existing full Contracts tab still
  contains **8** records. Clicking the work CTA opened that same full history.
- The three excluded unfinished-looking historical records are the cancelled
  RS7483, Approved SBK7483 in its closed case, and draft RS7403 in its closed
  case. Read-only browser inspection of RS7403 confirmed the explicit closed
  case message and no ordinary advancement/signature CTA. No state was changed.
- No fabricated “23. 7.” deadline remained. The actual 3 November payment
  deadline and configured December 2027 milestone were retained.

No write form was submitted and no test fixture, real buyer, payment, contract,
unit, document or audit record was changed in this package's browser smoke.

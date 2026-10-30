# Activity API error classification

## Reproduced defect

Project and unit timeline routes returned HTTP 403 for every caught exception.
A controlled Fastify reproduction raised an unexpected repository/SQL failure
and received 403 rather than 500. This made a technical failure look like an
authorization problem even after the frontend's read-state correction.
Workspace activity already returned 500 for unexpected failures, but had a
separate implementation. The three existing activity reads now share one small
error response/logger helper, using the existing central API error mapper.

## Scope

- Missing/invalid token remains 401; missing CRM workspace remains 403.
- Known CRM/project/unit permission-denial messages remain 403.
- Unexpected failures, including a database-role permission error, are 500,
  not a claimed denial of the user's CRM permission.
- Responses retain correlation ID and safe Czech wording. Raw SQL, relation
  names, connection error details and internal exception text are not returned.
- Logs include correlation, route, status, errorName and a validated five-
  character database code when available, never raw statement/parameters.
- Repository queries, tenant/project/RLS filtering, IAM resolution, permission
  mappings and all writes/financial/contract operations are unchanged. A query
  that intentionally returns an authorized filtered empty list still does so.
- No dependency, migration, legal wording, business data or frontend change.

## Verification

- New HTTP tests cover workspace/project/unit activity, normal empty success,
  session-derived context, 401 before repository access, expected 403,
  unexpected 500, safe serialization and correlation. A missing workspace
  cannot reach the activity repository.
- Full final backend run: **647 passed, 0 failed, 0 skipped**, with native
  PostgreSQL enabled on the owned disposable local cluster (TCP disabled).
- Backend build, frontend typecheck and lint passed.
- Frontend/runtime configuration/package/migration source diffs are empty
  against the prior healthy API inputs, apart from the intentional API handler.
  Sites 191's 222 interaction/145 static tests and production build remain
  applicable to its unchanged frontend; no new frontend test result is claimed.

The first complete run used a wrong local socket and failed native connections
with ENOENT (517 pass / 19 fail); it was not a pilot or application failure.
The owned cluster was restarted with the explicit expected unix socket/port and
TCP disabled, then all native tests passed. Typecheck also caught an initially
unannotated mock callback; it was given the actual repository parameter type,
not any or a weakened compiler option, before the final complete green run.

No fault was injected into pilot PostgreSQL or anyone's access to test 403/500.

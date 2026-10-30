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

## Pilot deployment and read-only smoke

- Code commit: `901678f4042bc47903d4754273d7501d75522236`, pushed to private
  GitHub main. ACR run `cg5y` succeeded using a minimal 170-file tracked build
  context without local output, credentials, dependencies or user files.
- API image digest:
  `sha256:5a80584a380c3367fa222811fda427a2e4425d5f8b9c1282d3fe9814def897ac`.
- Active revision: `ca-develocrm-api-pilot--activity-errors-901678f`;
  Healthy, Running, Provisioned, latest-ready and 100% latest traffic.
- Previous healthy rollback revision: `ca-develocrm-api-pilot--readiness-7dedd5b`.
- After traffic switched, `/health` and `/ready` both returned 200.
- Authenticated browser: reloaded Rezidence Dejvice overview and verified its
  project activity; opened technical unit 7483 history and verified its existing
  events; navigated to Dashboard and verified workspace activity. No form was
  submitted and no business record was changed.
- Bounded new-revision Log Analytics sample: 56 completed requests, zero HTTP
  5xx; project timeline, unit timeline and workspace activity each had a 200.
  This is a bounded observation, not proof that no future failure can occur.
- No migration, frontend source change or Sites publication was needed.
  Existing private Sites 191 remains in use. Managed identity, secrets, probes,
  authorization and infrastructure configuration were not changed.

# Commercial snapshot deadlock correction

## Runtime evidence

The TECH83 browser upload completed, but the following GET `/v1/commercial`
failed with HTTP 500, correlation `req-j`, on revision `unsigned-291d10d`.
API request start was 17:12:19.117 UTC, error response 17:12:22.060 UTC.
PostgreSQLLogs at **17:12:20.678 UTC** records SQLSTATE **40P01** (deadlock),
with `contract_document_is_ready` in that commercial SELECT and context
`assert_contract_document -> app.contract_document_is_ready`.
The read-only Azure query returned only timestamp, code and function names;
no query parameters, personal data, document contents or storage keys were exposed.

The previous report correctly left the cause unconfirmed until this separate
database evidence was obtained. A successful retry was not treated as a fix.

## Cause and smallest correction

The readiness badge in the commercial snapshot called the same locking assertion
used by signature/binding commands. This took document row locks across the
whole read and could participate in a deadlock. A strict READ ONLY reproduction
also failed with 25006; a held-document-lock reproduction timed out with 57014.
These are local regression reproductions of the unwanted read lock, not claims
that the original HTTP request had either of those different error codes.

Migration 0083 extracts the exact existing validation body to a private
`app.check_contract_document` function, with its one document FOR UPDATE removed.
`assert_contract_document` still acquires that document lock and then invokes
the same validation body. `contract_document_is_ready` invokes it without locks.
Both established public wrappers retain the same checks. The private core has
no public EXECUTE grant. No new permissions, document storage, business rules,
legal wording or historical data are introduced.

Readiness is advisory display evidence only. It never authorizes a signature;
binding/signature commands retain their locks and revalidate current evidence.

## Tests

The two new native PostgreSQL regressions first failed against the old wrapper:
25006 in a READ ONLY commercial snapshot and 57014 while waiting on a held
document row. After the split:

- a real `CommercialRepository.getSnapshot` works under READ ONLY and the
  non-bypass application role, with the valid exact document marked ready;
- readiness returns while another transaction owns the document row lock;
- the write assertion still actually waits on the same row, verified through
  `pg_stat_activity`, and resumes only when the owner releases it;
- wrong contract, tenant and exact version are not ready;
- the non-bypass application role cannot execute the private core directly.

Targeted document-integrity/workflow suite: **135 passed, 0 failed, 0 skipped**,
including real signature, immutability, release and concurrency tests.
Legacy-import fixtures defer 0057 until after imported rows; their dependent
0083 split is consequently applied after 0057, not silently overwritten by it.

Full backend regression: **644 passed, 0 failed, 0 skipped**, including native
PostgreSQL tests. Backend build, frontend typecheck and lint passed. Frontend
source is unchanged from the already verified Sites 187 / 214 interaction /
145 static-test / production-build checkpoint. Deployment remains to be recorded.
The separate TECH83 browser termination scenario still awaits human confirmation
of the clearly nonlegal synthetic RS; no signature is bypassed by this fix.

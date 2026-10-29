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

## Deployment and live verification

- Source `7dedd5b7c9aafcff4a56c5d7e63d1b9fa553352b`, pushed to private GitHub.
- API ACR run `cg5w` Succeeded, immutable digest
  `sha256:c007d279017765d669b2e165fe2684ac2164b1f01b271f191331cc904000e230`.
- Migration ACR run `cg5x` Succeeded, immutable digest
  `sha256:1e2fb3d9c318aced5b2faf622f1c0c8ee03d264a9d8c8156c71a9c45703216e0`.
- Preflight `caj-develocrm-migrations-pilot-i5qj6gu` Succeeded: 82 existing
  migrations and every checksum matched the previous healthy image.
- Migration execution `caj-develocrm-migrations-pilot-jdy7z6o` Succeeded,
  applied only `0083_nonlocking_contract_document_readiness.sql`.
- Migration SHA-256
  `5f31327ab21f5090188c943f2da0849b0151b3a70d722e10bd3a05b0af1e1d60`.
- Postflight `caj-develocrm-migrations-pilot-luikgf8` Succeeded: exactly 83
  migrations, every checksum matched the new image.
- New revision `ca-develocrm-api-pilot--readiness-7dedd5b`: Healthy, Running,
  Provisioned, one replica, latestReady, 100% traffic; health and ready both 200.
- Existing Key Vault secret references, managed identity and probes unchanged.
  Sites 187 unchanged; app/package/config source diff is empty for this package.

Runtime execution `job-develocrm-hold-expiry-pfibttv` **Succeeded** with two
parallel strict READ ONLY commercial repository calls: 32 contracts, 80
UUID/code price-breakdown entries, exact TECH83 document ready, status approved.
There were no writes, signatures or financial operations. The same strict
read diagnostic had failed before 0083; no fallback to a write transaction
was needed after this fix.

Authenticated browser read-only smoke through ordinary Entra login:
unit 7483 -> reload -> Smlouvy -> RS 7483. Correct project/buyer/contract context,
Approved state and exact TECH83 PDF v1 / Document ready persisted. No global
connection-error screen occurred in this pass. The first click attempted during
reload loading was retried only after observing the completed page; no mutation
was retried. Temporary read-only browser tab was closed, leaving the separate
human signature dialog untouched.

Bounded post-deployment API logs on this exact new revision: 67 completed
requests, **9/9 commercial GETs HTTP 200**, **0 HTTP 5xx**. This finite smoke
window plus the targeted native lock regression verifies this correction;
it is not a guarantee that no unrelated deadlock is possible anywhere.

No existing historical sales, real buyer facts, legal documents, payment
transactions or ownership data were changed. TECH83 release-after-signature
browser gate remains pending; the full RS production-readiness goal is open.

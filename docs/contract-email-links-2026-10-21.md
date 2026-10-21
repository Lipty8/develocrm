# Contract email link integrity

## Reproduced defect

The original scalar RS has `{{seller.email}}` inside `w:hyperlink`, while
`word/_rels/document.xml.rels` rId11 still points to the original mailbox. Both
SBK review profiles use a complex Word HYPERLINK field: its displayed value is
parameterized, but its instruction retains the original mailbox. The strict
renderer previously changed only `w:t` nodes. A different authorized seller
mailbox therefore displayed correctly while clicking the link targeted the old
recipient. This is verified against the actual pinned files, not inferred from
a toast or a generic sample. No production-generated legal contract is claimed.

## Correction

The existing renderer accepts a server-owned `mailToTokens` allowlist. Only the
original RS/SBK catalogs opt in with `seller.email`; upload requests and schema
metadata cannot supply this policy. Default/technical rendering remains unchanged.
The existing preview and generation services pass the same catalog policy.

Only a complete allowed token inside an existing mailto hyperlink/field can bind.
Relationship IDs/types/modes are validated, shared relationships with unrelated
uses are refused, and conflicting/missing targets are refused. Simple and complex
Word fields, including split instruction/text runs, are supported. Other URI
schemes, field commands/switches, nested/ambiguous fields and recipient lists fail
closed. A conservative shared mailbox validator disallows headers, percent
escapes, CRLF and URI injection. Unsupported address syntax is reported rather
than rewritten. The canonical original-contract mapper uses this same validator
so readiness returns the existing structured `project.seller.email` issue.
Errors expose only a catalog field key, not the mailbox or Word instruction.

Only rendered output changes. Source templates, hashes, schemas, manifests and
previous document versions remain unchanged. No migration, authorization, Graph,
financial or legal-text changes. All original profiles remain review-only with
generation/approval blocked. The RS fee-credit inconsistency, appendix package,
source-specific legal facts and content approval remain independent open gates.
There is no pending supported original-profile generation to replay with a
different renderer; completed operations still return their existing version.

## Verification

- Full backend suite: 407 passed, 0 failed, 4 optional native PostgreSQL suites
  skipped (411 total). No database locking change; no native concurrency claim.
- Backend production compilation, frontend TypeScript and changed-file lint passed.
- Frontend interactions: 111 passed, 0 failed. Frontend production build passed;
  existing chunk-size/route-classification warnings remain unchanged.
- Final targeted renderer/source/preview/readiness suite: 65 passed, 0 skipped.
- New tests cover relationship-based links, simple/complex Word fields, split
  runs/instructions, unchanged PAGE field, deterministic output, unmodified source,
  default opt-out, injection, shared/missing relationship, invalid target and
  nested/executable fields. Actual 32/37/38-field templates and preview service
  verify visible values and hidden targets agree, while activation stays blocked.
- Offline canonical scalar mapping rendered 148 RS and 261 SBK paragraphs, zero
  unresolved tokens. Every paragraph equals the original plus exact manifest
  replacements. The sole structural exceptions are the declared mailto target
  in RS rId11 / SBK HYPERLINK instruction; other package parts remain unchanged.
- Technical outputs in `/tmp/develocrm-mailto-review.ur117j` were rendered with the
  packaged renderer. All 4 RS and 11 SBK pages visually inspected: no clipping,
  overlap or page-count change. Source Word files and earlier delivered drafts
  untouched. Desktop Microsoft Word field refresh is not claimed.

This package is not legal approval and does not establish live legal contract
generation/signature E2E. No real pilot business data has been changed.

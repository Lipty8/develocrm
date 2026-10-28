# Client-change current-buyer safety

## Reproduction and scope

On technical unit 7406, the canonical commercial context correctly showed buyer
B, but the new client-change dialog selected historical buyer A. Its candidates
combined current buyers with all historical unit relations, then selected the
first global client row. No record was submitted with A during reproduction.

The SQL create operation checked only active project membership for the party.
Its optional case lookup did not exclude departed participants and could insert
a null sales-case binding for a historical party despite another active sale.

## Correction

- The existing central commercial context now determines client-change choices
  whenever an active sales case exists. Only current buyer/co-buyer participants
  are eligible; canonical buyer ordering is retained. A missing readable buyer
  does not fall back to history.
- Additive migration 0077 adds a binding guard to client changes. Under the
  existing unit-first workflow lock and then active-case lock, it checks the
  selected party against current buyer/co-buyer participation. A valid party is
  bound to the exact current case; another case or departed/non-buyer party is
  rejected atomically. This applies to both existing create entry points and
  direct binding inserts/updates, without duplicating create/audit logic.
- Binding changes are guarded, not ordinary status/note/assignment updates.
  Existing records are not backfilled. Existing no-active-case/after-sale
  behavior is deliberately unchanged; this package does not introduce a new
  ownership or post-sale eligibility policy.
- Conflicts use a safe Czech message and correlation ID through the existing
  error mapper. No SQL/trigger detail is exposed.

## Verification before rollout

- 578 backend tests passed, zero skipped, with native PostgreSQL enabled.
- Current buyer and co-buyer; departed participant; representative; other-unit
  project-linked party; forged tenant/project; exact case binding; one audit and
  outbox; safe error mapping covered in PGlite and PostgreSQL.
- Two actual concurrent PostgreSQL sessions are proven to wait on the unit lock
  in both buyer-replacement/create orderings. A committed buyer replacement
  rejects the stale create; a create ordered before replacement preserves its
  historical party/case without duplicate events. No deadlock occurred.
- 194 frontend interaction tests and 145 static regressions passed, including
  the real new-change modal with historical A before current B in client order.
- Frontend typecheck, backend TypeScript build, lint and production build passed.

## Rollout and live proof

- GitHub code `bf98e05d4aefa88139e0e50e9840faa490b00e0b`, pushed. Matching
  Sites source `2e507dc4d7b5ad74977baa37528a40c6e6352145`; both trees equal
  `35fa267a325caa1b4b288188550fb5f3d2d75379`.
- Sanitized build context contained only package/build inputs, backend source,
  migrations and the migration runner. No Git history, secrets, legal Word
  originals, seeds, uploads or pilot business data. ACR `cg5d` API and `cg5e`
  migrations both Succeeded.
- API digest `sha256:65a071f882c9fe77c6623732e8a24182bc001dcb699b97873c039088015ea697`.
  Migration digest `sha256:f0d72c36508d95d95f0253c4c0d22285e0d638403e3bd545bfa628cb21ef4617`.
- Dedicated migration job executions: preflight `caj-develocrm-migrations-pilot-4ztccg2`
  Succeeded, 76 matching checksums and only 0077 pending; migration
  `caj-develocrm-migrations-pilot-if048c2` Succeeded, applied only 0077; postflight
  `caj-develocrm-migrations-pilot-vzx8zh4` Succeeded, 77 matching checksums,
  no pending migrations and enabled binding guard. Existing Key Vault admin
  secret reference was retained; no runtime-container migration was used.
- Backend revision `ca-develocrm-api-pilot--buyer-bf98e05` Healthy/Running,
  latestReady, 100% latest-revision traffic. Existing liveness/readiness probes
  retained. `/health` and `/ready` returned 200 before frontend publication.
- Owner-private Sites 182, deployment `appgdep_6ae19a8aa79c8191a507188e85d07b76`,
  Succeeded. Saved version is archive-backed and has the expected source SHA;
  sharing was not changed.
- Authenticated browser on technical unit 7406: new-change dialog selected
  `TECH75 KUPUJICI-B-7406`; historical A was not an option. Created only the
  clearly marked `TECH WF79 – aktuální kupující`, with no price, approval or
  financial instruction. Reload/reopen preserved B and requested status. The
  subsequent status dialog was cancelled without saving.
- Non-bypass runtime-role technical proof `job-develocrm-hold-expiry-vwb44a0`
  Succeeded: exact current-buyer/active-case binding, null surcharge, one create
  audit and one outbox. A negative create using historical A was rejected by
  `CLIENT_CHANGE_CURRENT_BUYER_REQUIRED`; no rejected record persisted. That
  verification transaction was rolled back. Fixture/project/unit markers were
  checked before the attempted technical operation.
- Browser warning/error sample was empty. Initial bounded new-revision console
  sample: 82 records, zero matching 5xx/RLS/unhandled/startup-error signals.
  No claim is made about all historical logs.
- Existing real transactions, contracts, signatures, prices, project settings
  and SharePoint files were not changed. The unpriced technical WF79 evidence
  remains clearly marked; historical client changes were not repaired/backfilled.

This closes the reproduced active-sale buyer mismatch, not every possible
after-sale eligibility question. Existing no-active-case behavior remains an
explicit separate audit item rather than an unreviewed business-policy change.

## Follow-up: released unit after a failed sale

The next focused audit reproduced a concrete remaining bypass: cancel a
pre-reservation, let the existing domain operation close the case and release
the unit, then submit a client change for its old project-linked buyer. The
0077 guard allowed a null case. A regression first failed with `Missing expected
rejection`, proving this was executable behavior rather than a hypothetical.

0078 adds one server assessment, shared by the write guard and existing unit
commercial projection. It blocks new requests when the unit is available,
there is a lost/cancelled/expired case and no active replacement sale. It does
not redefine eligibility for sold/handed-over units or legacy units with no
sale history. Existing changes, financial obligations, documents and history
are untouched. A legitimate new sale re-enables creation for its current buyer.

The assessment is deliberately VOLATILE: a fresh snapshot is required after a
contended unit lock, otherwise a request waiting behind cancellation/expiry
could still read its pre-lock context. No second workflow engine or data model
is introduced. The frontend consumes the server flag rather than recreating
the condition from a localized status label. Its empty buyer field explains
that a new business case is required, with accessible label/help association.

Verification before rollout: full backend suite 586 passed, zero skipped, then
final strengthened PostgreSQL/PGlite workflow suite 71 passed, zero skipped.
The latter adds the actual RS → KS → handover path and a won-case fixture to
verify preservation of after-sale requests without bypassing unit-state guards.
Both orderings of create vs cancel and create vs expiry are tested with real
PostgreSQL lock waits; prior valid requests retain their original case and
later stale requests are rejected. A fresh replacement case accepts its buyer.
194 frontend interactions, 145 static regressions, typecheck, backend build,
lint and production build passed. One frontend test caught the help text
changing the accessible field name; the label/help association was corrected.
The directory's existing old-schema compatibility is retained through an
explicit capability check; pilot rollout still requires the 0078 schema check.

### 0078 rollout and authenticated verification

- GitHub code `29a9a5c3b286ceb337fad8ddba7103ec12697b6a`, pushed. Matching
  Sites source `6477c7a3a1c851645c82786eded9433594026db3`, equal tree
  `142bed48fecf8409e09edc8f61ba7d4d44f1e147`.
- ACR `cg5f` API and `cg5g` migrations Succeeded using the same sanitized input
  policy (no secrets, original Word files, uploads, seeds or business data).
  API digest `sha256:408e69eb5f78d9b38e231c0f40435aca7c44961b186e0c1533403010de710ece`;
  migration digest `sha256:fd6792915bada1890a64ce425bdc9aecb7224fa6658aa786106114cc40042c33`.
- Migration preflight `caj-develocrm-migrations-pilot-q63sqlj` Succeeded: 77
  matching checksums, only 0078 pending. Dedicated migration execution
  `caj-develocrm-migrations-pilot-yc8ool4` Succeeded, applied only 0078. Read-only
  postflight `caj-develocrm-migrations-pilot-fhquqt5` Succeeded: 78 matching
  checksums, no pending files, enabled binding guard and assessment present.
- Revision `ca-develocrm-api-pilot--closed-change-29a9a5c` Healthy/Running,
  latestReady and 100% latest traffic; health/ready 200. Existing identity,
  secret references, probes and access controls were retained.
- Owner-private Sites 183, deployment `appgdep_6ae1a164204c8191887a1daa6990e64a`,
  Succeeded; saved version is archive-backed with the matching source SHA.
- Actual browser reproduction on Sites 182: available TECH62-DRAFT still
  offered `Technical TECH62-DRAFT` despite its ended case. No request submitted.
  After Sites 183 reload, the same dialog has no historical buyer option and
  explains that a new business case must be created. Closed without saving.
- Runtime-role proof `job-develocrm-hold-expiry-fbbr96n` Succeeded. It checked
  exact project `39809e0b-59e3-40aa-aaad-713887975a30` / unit
  `f65bcae3-517d-469b-9b2a-6b7d345fae4e`, explicit TECH62 markers, available
  state, failed historical case and no active case. The actual existing
  SalesRepository returned `clientChangesRequireNewSale:true` in a read-only
  transaction. The stale create was rejected with `CLIENT_CHANGE_SALE_CLOSED`;
  record count stayed unchanged and the verification transaction rolled back.
- Independent approved-original TECH74 RS/SBK verification
  `job-develocrm-hold-expiry-jhpc3pj` Succeeded on the new matching image. Exact
  SharePoint hashes and signed document-version bindings remain verified for
  RS v2 / SBK v1. The first SBK payment remains 1,100,000 CZK due 3 November;
  next action remains KS and commercial status contracted. Signature audit
  verified. No new upload, signature, schedule update or financial mutation.
- Browser warning/error sample empty. Bounded new-revision console sample:
  102 records, zero matching 5xx/RLS/unhandled/startup-error signals.
- No pilot business record or existing technical fixture was changed by this
  follow-up. Only additive schema/application deployment occurred. Screenshot
  inspected inline; no file artifact is claimed under the previously recorded
  browser filesystem limitation.

Open business question: whether new client changes remain allowed after final
handover, or only existing changes and complaints should remain. Asked Adam
separately; this package deliberately preserves that behavior pending decision.

# RS production readiness – 16 October 2026

## Delivery boundary

Safe workflow and preparation UX changes are implemented. **Real RS production
activation is not approved by this technical report.** The user reports legal
review, but the exact reviewed DOCX/version and explicit project activation
authorization have not been identified. No substitute template is activated.

## Live read-only audit

Current starting release: e8ca805, backend end-e8ca805, Sites 140, migration 0061.
Project DEJ has no project_contract_settings and no active RS template. HRD also
has no seller settings. RS templates found belong to RSTEST (archived) and TECH57
(technical fixtures); they do not establish production legal approval for DEJ.

Repository parameterized file: backend/templates/rs/rezidence-dejvice-rs-v1.docx,
SHA-256 `7d330452a1e9d5b2e09a8d6aa6dcbafcd934fed8dc1506768b6a0a09d6b6f0dd`.
The historical normalized SharePoint technical source is
`sha256:052d8c8699f012521d21c2c4acebb7934625587428fc3137b1406d097774680e`.
Office/SharePoint can normalize package bytes: different raw hashes alone do not
prove different legal text. Neither hash currently identifies a newly authorized
production version. Source legal text and files have not been changed.

## Workflow safety

Migration 0062 adds one shared release predicate. Ended contracts and genuinely
unsigned drafts do not block release. A draft with historical version/participant
signature evidence still blocks. Sent/negotiating/approved contracts remain
conservative blockers: this package only authorizes ignoring unsigned **drafts**.
The assessment and final commercial-status command use the same predicate.
Existing audit-proven RS reservation, ownership, handover, other-case, independent
hold and financial-preservation checks remain intact. No historical backfill.

Unit-first serialization remains unchanged. Database triggers reject advancing
or signing contracts/versions/participants for closed or mismatched sales cases,
including partial-signature entry points. Unfinished documents and versions are
retained. Frontend hides progression/signature/upload actions for historical cases.

## RS preparation and data sources

- Existing contextual contract creation is labelled “Připravit rezervační smlouvu”.
  It still creates the same contract, initial version and payment obligation.
- Readiness returns project/unit/buyers, seller, frozen contract prices, accessories,
  fee, terms and exact selected template label. UI accepts no placeholder values.
- Missing fields link to existing client/unit/project/template screens with a
  validated return-to-contract link. Focus/visibility refresh reloads readiness.
- Generation retries keep one key until successful response. Previous document
  versions remain append-only; existing generation/upload pipelines are reused.
- Existing project editor now manages canonical project_contract_settings, using
  project-specific contract.manage in addition to normal project edit authority.
  Tenant/actor/project context cannot be overridden by request-body fields on this
  update endpoint. Settings mutation, audit and outbox share one transaction.
- Company identity is not hardcoded; blank configuration remains blank. No new
  table, seller registry or parallel document model is introduced.
- Template selection is tenant/project scoped, active, approved, effective and
  default-variant only. Another technical/source variant is not silently selected.
- Individual buyers now use a residence address, never a billing/correspondence
  address fallback. Company readiness remains blocked for the unsupported variant.
- Non-positive/missing floor area, unsupported terrace, wallbox, more than one
  buyer or unsupported buyer type fail closed rather than alter legal wording.

## Remaining production gates / business decisions

1. Identify the exact legally reviewed parameterized DOCX/version and explicitly
   authorize its activation for DEJ. Review static project-specific land/building
   clauses in that version; tenant scoping alone does not make such text universal.
2. Populate the seller's real details via the project editor; no automatic copy
   from a technical project or assumption about a legal company is permitted.
3. Resolve fee timing: current RS renderer describes working days from signature,
   while payment creation stores a concrete due date selected at contract creation.
   The renderer uses stored reservation_fee_due_days (default 3); this is not
   necessarily the same as the selected payment due date. This package does not
   silently rewrite legal text, financial obligations or timing rules.
4. The first mapping supports one individual buyer, no terrace/wallbox variant.
   Firms/co-buyers/unsupported accessories need reviewed compatible templates.
5. Verify required appendices/catalogue sheets for the approved real template;
   existing paragraph references are not proof that those attachments are present.
6. Run the full authorized legal-template E2E after gates 1–5. Until then, safe
   technical workflow tests must not be presented as real RS production approval.

Unit 417, existing historical cases and existing TECH56/57 data are unchanged.
Only new clearly labelled technical E2E fixtures may be mutated.

## Verification

Regression tests include unsigned-SBK release, historical draft/partial-signature
rejection, independent commitments, actual PostgreSQL locks in both race orders,
unchanged finances, summary/source selection, changed buyer data, safe return
links, stable generation retry keys, seller settings validation and permissions.
Strict typecheck, backend/frontend builds, lint and existing relevant suites are
release gates. Operational deployment/E2E evidence is recorded separately.

The optional SBK field-gap stage is not started until the preceding RS gates are
completed; no SBK generation, legal clauses or new contract workflow is added.

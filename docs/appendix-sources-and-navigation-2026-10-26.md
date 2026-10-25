# Appendix sources and project navigation — 26 October 2026

## Verified source gap

The supplied `immobuilding / Dejvice TEST` library root was loaded through Adam's ordinary authenticated SharePoint UI. It contains KL, Dispozice, Standardy and the three original Word contracts. Standardy contains the known single 20-page standards PDF. The prior explicitly inventoried Dispozice contents and registered 19 main catalogues remain the relevant source inventory; file names were not treated as proof of legal appendix meaning.

Native connector search for the missing appendix terms returned no candidates; direct folder listing returned 403 while the user's browser session loaded the library normally. No backend Graph grant or access control was changed. The scope of this finding is the supplied library and inspected sources, not every file in the organization.

A nonblocking request was sent for the exact power of attorney, coordination plan and client-change rules. Their absence from the current verified mapping must not be filled with an unrelated plan or the equipment standards. Content approval has already been received and is not being requested again.

## Purchase-contract wording as SBK appendix

The current supplied SharePoint file `Rezidence Dejvice KS vzor 25-11-03.docx` was downloaded normally, without editing the source. Its SHA-256 is `09394eca8c9ba8c7186271ce1fdf58ecf27b96196ce4b12ba829a23c2fc71131`.

It still named the former seller. Under Adam's earlier explicit authorization to align that identity with RS/SBK, a corrected copy was prepared with only these replacements:

- Seller name in introduction and signature: `Rezidence Dejvice s.r.o.` → `Rezidence Dejvice 2 s.r.o.`.
- Seller IČ: `056 06 675` → `241 06 119`.
- Seller register entry: `267218` → `439 174`.

The target values were checked against the supplied approved SBK original. No payment term, bank account, buyer identifier, legal clause, placeholder, accessory variant or attachment text was changed. The project-name definition remains `Rezidence Dejvice`. Exactly four paragraph texts changed. The only modified ZIP part is `word/document.xml`; the other 25 ZIP parts are byte-identical. The corrected transport DOCX hash is `3af04df8303b13ed6cb8772ac3741e307ae796db74d442c9e8a380364c8f1ae7`.

The bundled renderer produced seven pages, all visually inspected without clipping or layout defects. This remains a blank purchase-contract **wording appendix**, not KS generation or a contract for a particular buyer. RS/SBK legal prose was not edited.

The corrected copy was uploaded through the authenticated CRM document UI to the configured DeveloCRM site/library as `Znění kupní smlouvy – Rezidence Dejvice 2`, project `648b5e62-9784-4de9-929d-c89b7ffc3c50`, document `9f4e9a52-b61d-42e2-a6b0-dfd99ca8570d`. Source originals and previous unregistered source copies were retained; no SharePoint file was deleted or overwritten. No historical contract appendix was modified.

Read-only execution `job-develocrm-hold-expiry-rlbnyin` **Succeeded**. It verified the exact persisted SharePoint native-version hash against CRM metadata, all 12 `word/` package-part hashes against the inspected corrected copy, one ready business version, one completed upload, one audit and one outbox event. It used the existing runtime RLS role, configured site/drive and managed identity, with no writes or scheduled-job configuration change.

## Navigation correction

The existing `ContractAppendicesPanel` used `/projects/{id}?tab=documents`; the project route parser ignored that legacy query and opened the overview. The panel now calls shared `projectRoute(projectId, 'documents')`, yielding `/projects/{uuid}/documents`. No workflow, RBAC or data query was changed.

The added interaction test checks the rendered link and its parsed project/tab after a reload. All 143 frontend regression tests and 138 interaction tests passed, as did TypeScript, full lint and the production frontend build.

Implementation commit `db04ed18fb0274f6944fc8077016a971b89747bc` was pushed to GitHub. Sites **167**, source `ad8feb516242c30dc3848237e4273357ee5f6e4d`, deployment `appgdep_6ade8dca8bc8819199e46ceab536ae54`, succeeded. Both source trees are `9d17c97c1c4c06c45016c2b90e2282087cf88e38`.

Backend `ca-develocrm-api-pilot--rs-original-1f3d65b` remains unchanged. No migration; `/health` and `/ready` returned 200. The legal-original RS/SBK business-generation E2E and exact outstanding appendix mapping remain required before claiming full readiness.

Authenticated read-only browser verification opened existing technical contract `TECH62-PREPARE-RS` (`2cf4b568-4427-4543-90ab-3bc93321d10d`) and clicked the actual appendix-panel link. It reached `/projects/39809e0b-59e3-40aa-aaad-713887975a30/documents`, with the correct TECH62 project heading and Documents region visible, not the overview or a different project. A full reload retained that exact URL, project and visible Documents region. No test or real deal was edited by this navigation check.

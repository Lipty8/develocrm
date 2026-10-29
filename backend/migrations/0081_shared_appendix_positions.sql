BEGIN;

-- A supplied PDF can contain both cellar and parking plans. Each numbered
-- appendix still pins an exact immutable version; sharing that version must
-- not require a second physical file/document. Non-appendix links retain
-- their existing uniqueness. No historical row is changed.
DROP INDEX contract_documents_version_level_uq;
CREATE UNIQUE INDEX contract_documents_version_level_uq
  ON contract_documents(tenant_id,contract_version_id,document_id)
  WHERE contract_version_id IS NOT NULL AND appendix_number IS NULL;

DO $$
DECLARE definition text;
  old_guard text := $old$AND l.contract_version_id=v.id AND l.document_id=p_document AND l.id IS DISTINCT FROM previous.id) THEN$old$;
  new_guard text := $new$AND l.contract_version_id=v.id AND l.document_id=p_document AND l.id IS DISTINCT FROM previous.id
    AND (l.appendix_number IS NULL OR l.document_version_id IS DISTINCT FROM p_document_version)) THEN$new$;
BEGIN
  SELECT pg_get_functiondef('app.set_contract_appendix(uuid,uuid,uuid,integer,uuid,uuid,uuid,uuid)'::regprocedure) INTO definition;
  IF position(old_guard IN definition)=0 THEN RAISE EXCEPTION 'Unexpected appendix duplicate guard'; END IF;
  EXECUTE replace(definition,old_guard,new_guard);
END $$;

-- The existing (tenant, contract version, appendix number) unique index,
-- unit-first locking, permissions, unit applicability, snapshot freeze and
-- signed-document guards remain unchanged. Different versions of one file
-- cannot be mixed across the numbered positions of a single contract version.
COMMIT;

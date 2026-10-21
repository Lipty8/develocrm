BEGIN;

-- Protect the signed evidence association, not every unrelated draft reuse of
-- the same immutable file. Other link tables keep their existing protection.
CREATE OR REPLACE FUNCTION app.guard_signed_document_link() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='contract_documents' THEN
    IF OLD.appendix_number IS NOT NULL
      AND current_setting('app.contract_appendix_command',true)='on'
      AND EXISTS(SELECT 1 FROM contract_versions v
        WHERE v.tenant_id=OLD.tenant_id AND v.contract_id=OLD.contract_id AND v.id=OLD.contract_version_id
          AND v.version_status='working' AND v.document_version_id IS NULL AND v.locked_at IS NULL
          AND NOT EXISTS(SELECT 1 FROM contract_parties p WHERE p.tenant_id=v.tenant_id
            AND p.signed_version_id=v.id AND p.signature_status='signed')
          AND NOT EXISTS(SELECT 1 FROM document_generation_operations g WHERE g.tenant_id=v.tenant_id
            AND g.contract_id=v.contract_id AND g.contract_preparation_version_id=v.id)) THEN
      -- The command and the separate appendix guards enforce actor/project,
      -- current working-version, lock order, optimistic token and audit/outbox.
      -- No document/version bytes or original signed association are modified.
      RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
    END IF;
  END IF;
  IF app.document_has_signature_evidence(OLD.tenant_id,OLD.document_id) THEN
    RAISE EXCEPTION 'SIGNED_DOCUMENT_IMMUTABLE';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;

COMMIT;

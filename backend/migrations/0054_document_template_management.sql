BEGIN;

ALTER TABLE document_templates ADD COLUMN variant_key text NOT NULL DEFAULT 'default'
  CHECK(variant_key~'^[a-z0-9][a-z0-9_-]{0,79}$');
DROP INDEX document_templates_contract_type_uq;
CREATE UNIQUE INDEX document_templates_contract_variant_uq
  ON document_templates(tenant_id,project_id,contract_type,variant_key)
  WHERE contract_type IS NOT NULL AND status='active';

DROP TRIGGER document_template_versions_append_only ON document_template_versions;
ALTER TABLE document_template_versions DROP CONSTRAINT document_template_versions_approval_status_check;
ALTER TABLE document_template_versions DROP CONSTRAINT document_template_versions_approval_shape;
ALTER TABLE document_template_versions
  ADD COLUMN validation_result jsonb NOT NULL DEFAULT '{"valid":false,"errors":["not_validated"]}'::jsonb,
  ADD COLUMN validated_at timestamptz,
  ADD COLUMN validated_by_membership_id uuid,
  ADD COLUMN retired_at timestamptz,
  ADD COLUMN retired_by_membership_id uuid;
UPDATE document_template_versions SET
  validation_result=jsonb_build_object('valid',true,'tokens',ARRAY(SELECT jsonb_object_keys(placeholder_schema->'fields')),'errors','[]'::jsonb),
  validated_at=created_at,validated_by_membership_id=created_by_membership_id
WHERE approval_status='approved';
WITH ranked_approved AS (
  SELECT id,row_number() OVER(
    PARTITION BY tenant_id,template_id
    ORDER BY approved_at DESC NULLS LAST,created_at DESC,id DESC
  ) AS approval_rank
  FROM document_template_versions
  WHERE approval_status='approved'
)
UPDATE document_template_versions version SET
  approval_status='retired',
  retired_at=COALESCE(version.approved_at,version.created_at),
  retired_by_membership_id=COALESCE(version.approved_by_membership_id,version.created_by_membership_id)
FROM ranked_approved ranked
WHERE version.id=ranked.id AND ranked.approval_rank>1;
ALTER TABLE document_template_versions ADD CONSTRAINT document_template_versions_approval_status_check
  CHECK(approval_status IN('draft','validated','approved','retired'));
ALTER TABLE document_template_versions ADD CONSTRAINT document_template_versions_validation_shape CHECK(
  jsonb_typeof(validation_result)='object' AND validation_result ? 'valid'
  AND (approval_status='draft' OR (validation_result->>'valid')::boolean)
  AND ((approval_status IN('validated','approved') AND validated_at IS NOT NULL AND validated_by_membership_id IS NOT NULL)
    OR approval_status IN('draft','retired'))
);
ALTER TABLE document_template_versions ADD CONSTRAINT document_template_versions_approval_shape CHECK(
  (approval_status='approved' AND approved_at IS NOT NULL AND approved_by_membership_id IS NOT NULL AND retired_at IS NULL AND retired_by_membership_id IS NULL)
  OR (approval_status IN('draft','validated') AND approved_at IS NULL AND approved_by_membership_id IS NULL AND retired_at IS NULL AND retired_by_membership_id IS NULL)
  OR (approval_status='retired' AND retired_at IS NOT NULL AND retired_by_membership_id IS NOT NULL)
);
ALTER TABLE document_template_versions ADD CONSTRAINT document_template_versions_validator_fk
  FOREIGN KEY(tenant_id,validated_by_membership_id) REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT;
ALTER TABLE document_template_versions ADD CONSTRAINT document_template_versions_retirer_fk
  FOREIGN KEY(tenant_id,retired_by_membership_id) REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX document_template_versions_one_approved_uq
  ON document_template_versions(tenant_id,template_id) WHERE approval_status='approved';

CREATE OR REPLACE FUNCTION app.protect_document_template_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'document template versions are append-only';END IF;
  IF ROW(OLD.tenant_id,OLD.project_id,OLD.template_id,OLD.source_document_id,OLD.source_document_version_id,OLD.version_label,
      OLD.content_hash,OLD.placeholder_schema,OLD.created_by_membership_id,OLD.created_at)
    IS DISTINCT FROM ROW(NEW.tenant_id,NEW.project_id,NEW.template_id,NEW.source_document_id,NEW.source_document_version_id,NEW.version_label,
      NEW.content_hash,NEW.placeholder_schema,NEW.created_by_membership_id,NEW.created_at)
  THEN RAISE EXCEPTION 'document template version content is immutable';END IF;
  IF NOT(
    (OLD.approval_status='draft' AND NEW.approval_status IN('draft','validated','retired')) OR
    (OLD.approval_status='validated' AND NEW.approval_status IN('validated','approved','retired')) OR
    (OLD.approval_status='approved' AND NEW.approval_status IN('approved','retired')) OR
    (OLD.approval_status='retired' AND NEW.approval_status='retired')
  ) THEN RAISE EXCEPTION 'invalid document template lifecycle transition';END IF;
  IF OLD.approval_status IN('approved','retired') AND ROW(OLD.validation_result,OLD.validated_at,OLD.validated_by_membership_id,OLD.approved_at,OLD.approved_by_membership_id)
    IS DISTINCT FROM ROW(NEW.validation_result,NEW.validated_at,NEW.validated_by_membership_id,NEW.approved_at,NEW.approved_by_membership_id)
  THEN RAISE EXCEPTION 'approved document template version is immutable';END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER document_template_versions_lifecycle_guard BEFORE UPDATE OR DELETE ON document_template_versions
  FOR EACH ROW EXECUTE FUNCTION app.protect_document_template_version();

COMMIT;

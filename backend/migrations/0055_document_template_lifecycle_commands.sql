BEGIN;

CREATE OR REPLACE FUNCTION app.template_actor_allowed(p_tenant uuid,p_membership uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,app,pg_temp AS $$
  SELECT app.current_tenant_id()=p_tenant AND EXISTS(
    SELECT 1 FROM tenant_memberships
    WHERE tenant_id=p_tenant AND id=p_membership AND user_id=app.current_user_id() AND status='active'
  )
$$;

CREATE OR REPLACE FUNCTION app.record_document_template_validation(
  p_tenant uuid,p_membership uuid,p_template uuid,p_version uuid,p_validation jsonb
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,app,pg_temp AS $$
DECLARE target document_template_versions%ROWTYPE; valid boolean;
BEGIN
  IF NOT app.template_actor_allowed(p_tenant,p_membership) THEN RETURN false;END IF;
  SELECT * INTO target FROM document_template_versions
  WHERE tenant_id=p_tenant AND template_id=p_template AND id=p_version FOR UPDATE;
  IF target.id IS NULL OR NOT app.has_project_permission(p_tenant,p_membership,target.project_id,'documents.upload') THEN RETURN false;END IF;
  IF target.approval_status='validated' AND target.validation_result=p_validation THEN RETURN true;END IF;
  IF target.approval_status<>'draft' THEN RETURN false;END IF;
  valid:=COALESCE((p_validation->>'valid')::boolean,false);
  UPDATE document_template_versions SET validation_result=p_validation,
    approval_status=CASE WHEN valid THEN 'validated' ELSE 'draft' END,
    validated_at=CASE WHEN valid THEN now() ELSE NULL END,
    validated_by_membership_id=CASE WHEN valid THEN p_membership ELSE NULL END
  WHERE tenant_id=p_tenant AND template_id=p_template AND id=p_version AND approval_status='draft';
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION app.approve_document_template_version(
  p_tenant uuid,p_membership uuid,p_template uuid,p_version uuid
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,app,pg_temp AS $$
DECLARE target document_template_versions%ROWTYPE;
BEGIN
  IF NOT app.template_actor_allowed(p_tenant,p_membership) THEN RETURN false;END IF;
  SELECT * INTO target FROM document_template_versions
  WHERE tenant_id=p_tenant AND template_id=p_template AND id=p_version FOR UPDATE;
  IF target.id IS NULL OR NOT app.has_project_permission(p_tenant,p_membership,target.project_id,'documents.review') THEN RETURN false;END IF;
  IF target.approval_status='approved' THEN RETURN true;END IF;
  IF target.approval_status<>'validated' THEN RETURN false;END IF;
  UPDATE document_template_versions SET approval_status='retired',retired_at=now(),retired_by_membership_id=p_membership
  WHERE tenant_id=p_tenant AND template_id=p_template AND approval_status='approved' AND id<>p_version;
  UPDATE document_template_versions SET approval_status='approved',approved_at=now(),approved_by_membership_id=p_membership
  WHERE tenant_id=p_tenant AND template_id=p_template AND id=p_version AND approval_status='validated';
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION app.retire_document_template_version(
  p_tenant uuid,p_membership uuid,p_template uuid,p_version uuid
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,app,pg_temp AS $$
DECLARE target document_template_versions%ROWTYPE;
BEGIN
  IF NOT app.template_actor_allowed(p_tenant,p_membership) THEN RETURN false;END IF;
  SELECT * INTO target FROM document_template_versions
  WHERE tenant_id=p_tenant AND template_id=p_template AND id=p_version FOR UPDATE;
  IF target.id IS NULL OR NOT app.has_project_permission(p_tenant,p_membership,target.project_id,'documents.review') THEN RETURN false;END IF;
  IF target.approval_status='retired' THEN RETURN true;END IF;
  UPDATE document_template_versions SET approval_status='retired',retired_at=now(),retired_by_membership_id=p_membership
  WHERE tenant_id=p_tenant AND template_id=p_template AND id=p_version AND approval_status<>'retired';
  RETURN FOUND;
END $$;

REVOKE ALL ON FUNCTION app.template_actor_allowed(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.record_document_template_validation(uuid,uuid,uuid,uuid,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.approve_document_template_version(uuid,uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.retire_document_template_version(uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.record_document_template_validation(uuid,uuid,uuid,uuid,jsonb) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.approve_document_template_version(uuid,uuid,uuid,uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.retire_document_template_version(uuid,uuid,uuid,uuid) TO develocrm_app;

COMMIT;

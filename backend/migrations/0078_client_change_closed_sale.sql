BEGIN;

-- One server assessment for the write guard and the existing UI projection.
-- VOLATILE intentionally takes a fresh snapshot after a contended unit lock.
-- Successful sold/handed-over units and legacy no-sale records are unchanged.
CREATE FUNCTION app.client_changes_require_new_sale(p_tenant uuid,p_unit uuid)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY INVOKER AS $$
  SELECT EXISTS(SELECT 1 FROM units u WHERE u.tenant_id=p_tenant AND u.id=p_unit
    AND u.commercial_status='available'
    AND EXISTS(SELECT 1 FROM sales_cases s WHERE s.tenant_id=u.tenant_id AND s.unit_id=u.id
      AND s.status IN ('lost','cancelled','expired'))
    AND NOT EXISTS(SELECT 1 FROM sales_cases s WHERE s.tenant_id=u.tenant_id AND s.unit_id=u.id AND s.status='active'))
$$;
GRANT EXECUTE ON FUNCTION app.client_changes_require_new_sale(uuid,uuid) TO develocrm_app;

CREATE OR REPLACE FUNCTION app.guard_client_change_current_buyer()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE current_case uuid;
BEGIN
  PERFORM app.lock_workflow_unit(NEW.tenant_id,NEW.unit_id);
  IF NOT EXISTS(SELECT 1 FROM units WHERE tenant_id=NEW.tenant_id
    AND id=NEW.unit_id AND project_id=NEW.project_id AND archived_at IS NULL) THEN
    RAISE EXCEPTION 'CLIENT_CHANGE_CONTEXT_CHANGED';
  END IF;
  IF app.client_changes_require_new_sale(NEW.tenant_id,NEW.unit_id) THEN
    RAISE EXCEPTION 'CLIENT_CHANGE_SALE_CLOSED';
  END IF;
  SELECT id INTO current_case FROM sales_cases
    WHERE tenant_id=NEW.tenant_id AND project_id=NEW.project_id
      AND unit_id=NEW.unit_id AND status='active'
    ORDER BY opened_at DESC,id DESC LIMIT 1 FOR UPDATE;
  IF current_case IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM sales_case_parties
      WHERE tenant_id=NEW.tenant_id AND project_id=NEW.project_id
        AND sales_case_id=current_case AND party_id=NEW.party_id
        AND participant_role IN ('buyer','co_buyer') AND left_at IS NULL) THEN
      RAISE EXCEPTION 'CLIENT_CHANGE_CURRENT_BUYER_REQUIRED';
    END IF;
    IF NEW.sales_case_id IS NOT NULL AND NEW.sales_case_id<>current_case THEN
      RAISE EXCEPTION 'CLIENT_CHANGE_CONTEXT_CHANGED';
    END IF;
    NEW.sales_case_id:=current_case;
  ELSIF NEW.sales_case_id IS NOT NULL THEN
    RAISE EXCEPTION 'CLIENT_CHANGE_CONTEXT_CHANGED';
  END IF;
  RETURN NEW;
END $$;

COMMIT;

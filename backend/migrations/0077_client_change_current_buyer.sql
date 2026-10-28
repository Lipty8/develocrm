BEGIN;

-- No backfill: historical changes retain their original parties/cases.
-- Serialize with reservation, release and buyer assignment before accepting a
-- new business binding. A project link alone is not a buyer of an active sale.
CREATE FUNCTION app.guard_client_change_current_buyer()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE current_case uuid;
BEGIN
  PERFORM app.lock_workflow_unit(NEW.tenant_id,NEW.unit_id);
  IF NOT EXISTS(SELECT 1 FROM units WHERE tenant_id=NEW.tenant_id
    AND id=NEW.unit_id AND project_id=NEW.project_id AND archived_at IS NULL) THEN
    RAISE EXCEPTION 'CLIENT_CHANGE_CONTEXT_CHANGED';
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

CREATE TRIGGER client_changes_current_buyer
  BEFORE INSERT OR UPDATE OF tenant_id,project_id,unit_id,party_id,sales_case_id
  ON client_changes FOR EACH ROW EXECUTE FUNCTION app.guard_client_change_current_buyer();

COMMIT;

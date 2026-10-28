BEGIN;

-- Fresh snapshot after the shared unit lock, including concurrent handover completion.
CREATE FUNCTION app.client_changes_handover_completed(p_tenant uuid,p_unit uuid)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY INVOKER AS $$
  SELECT EXISTS(SELECT 1 FROM unit_handovers h
    WHERE h.tenant_id=p_tenant AND h.unit_id=p_unit AND h.status='handed_over')
$$;
GRANT EXECUTE ON FUNCTION app.client_changes_handover_completed(uuid,uuid) TO develocrm_app;

CREATE FUNCTION app.guard_new_client_change_before_handover()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  PERFORM app.lock_workflow_unit(NEW.tenant_id,NEW.unit_id);
  IF app.client_changes_handover_completed(NEW.tenant_id,NEW.unit_id) THEN
    RAISE EXCEPTION 'CLIENT_CHANGE_HANDOVER_COMPLETED';
  END IF;
  RETURN NEW;
END $$;
-- Existing changes, their settlement and history remain editable.
CREATE TRIGGER client_change_before_handover
BEFORE INSERT ON client_changes FOR EACH ROW
EXECUTE FUNCTION app.guard_new_client_change_before_handover();

COMMIT;

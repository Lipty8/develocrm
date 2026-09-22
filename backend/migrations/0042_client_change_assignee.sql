BEGIN;

ALTER TABLE client_changes ADD COLUMN assignee_membership_id uuid;
ALTER TABLE client_changes ADD CONSTRAINT client_changes_assignee_fk
  FOREIGN KEY(tenant_id,assignee_membership_id) REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT;
CREATE INDEX client_changes_assignee_idx ON client_changes(tenant_id,assignee_membership_id,due_at) WHERE archived_at IS NULL;
ALTER TABLE client_change_events ADD COLUMN event_type text NOT NULL DEFAULT 'status_changed'
  CHECK(event_type IN ('status_changed','assignee_changed','note_added'));
ALTER TABLE client_change_events ADD COLUMN idempotency_key text;
CREATE UNIQUE INDEX client_change_events_idempotency_uq ON client_change_events(tenant_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
ALTER TABLE client_change_events ADD COLUMN previous_assignee_membership_id uuid;
ALTER TABLE client_change_events ADD COLUMN assignee_membership_id uuid;
ALTER TABLE client_change_events ADD CONSTRAINT client_change_events_previous_assignee_fk
  FOREIGN KEY(tenant_id,previous_assignee_membership_id) REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT;
ALTER TABLE client_change_events ADD CONSTRAINT client_change_events_assignee_fk
  FOREIGN KEY(tenant_id,assignee_membership_id) REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT;
CREATE TRIGGER client_change_events_append_only BEFORE UPDATE OR DELETE ON client_change_events FOR EACH ROW EXECUTE FUNCTION app.reject_append_only();

CREATE OR REPLACE FUNCTION app.create_client_change_v2(
 p_tenant uuid,p_project uuid,p_unit uuid,p_party uuid,p_title text,p_description text,p_source_type text,p_catalog_item_code text,p_category text,
 p_surcharge_amount numeric,p_currency text,p_requested_at date,p_due_at date,p_assignee uuid,p_actor uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_id uuid;
BEGIN
 IF p_assignee IS NOT NULL AND NOT EXISTS(SELECT 1 FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_assignee AND status='active') THEN
   RAISE EXCEPTION 'assignee must be an active membership';END IF;
 v_id:=app.create_client_change(p_tenant,p_project,p_unit,p_party,p_title,p_description,p_source_type,p_catalog_item_code,p_category,p_surcharge_amount,p_currency,p_requested_at,p_due_at,p_actor);
 IF p_assignee IS NOT NULL THEN
   UPDATE client_changes SET assignee_membership_id=p_assignee WHERE tenant_id=p_tenant AND id=v_id;
   INSERT INTO client_change_events(tenant_id,project_id,change_id,from_status,to_status,note,actor_membership_id,event_type,assignee_membership_id)
   VALUES(p_tenant,p_project,v_id,'requested','requested',NULL,p_actor,'assignee_changed',p_assignee);
 END IF;
 RETURN v_id;
END $$;
GRANT EXECUTE ON FUNCTION app.create_client_change_v2(uuid,uuid,uuid,uuid,text,text,text,text,text,numeric,text,date,date,uuid,uuid) TO develocrm_app;

CREATE OR REPLACE FUNCTION app.transition_client_change_v2(
 p_tenant uuid,p_change uuid,p_status text,p_note text,p_assignee uuid,p_key text,p_actor uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_change client_changes%ROWTYPE;v_actor_user uuid;v_note text:=NULLIF(btrim(p_note),'');
BEGIN
 IF p_key IS NULL OR length(p_key)<8 OR length(p_key)>160 THEN RAISE EXCEPTION 'valid idempotency key required';END IF;
 SELECT * INTO v_change FROM client_changes WHERE tenant_id=p_tenant AND id=p_change FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'client change not found';END IF;
 IF NOT app.has_project_permission(p_tenant,p_actor,v_change.project_id,'client_changes.manage') THEN RAISE EXCEPTION 'client_changes.manage permission required';END IF;
 IF EXISTS(SELECT 1 FROM client_change_events WHERE tenant_id=p_tenant AND change_id=p_change AND idempotency_key=p_key) THEN RETURN p_change;END IF;
 SELECT user_id INTO v_actor_user FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor AND status='active';
 IF v_actor_user IS NULL THEN RAISE EXCEPTION 'active actor membership required';END IF;
 IF p_assignee IS NOT NULL AND NOT EXISTS(SELECT 1 FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_assignee AND status='active') THEN RAISE EXCEPTION 'assignee must be an active membership';END IF;
 IF v_change.status=p_status AND v_change.assignee_membership_id IS NOT DISTINCT FROM p_assignee AND v_note IS NULL THEN RETURN p_change;END IF;
 IF v_change.status<>p_status AND NOT (
   (v_change.status='requested' AND p_status IN ('pricing','pending_approval','cancelled')) OR
   (v_change.status='pricing' AND p_status IN ('pending_approval','cancelled')) OR
   (v_change.status='pending_approval' AND p_status IN ('approved','rejected','pricing')) OR
   (v_change.status='approved' AND p_status IN ('in_progress','completed','cancelled')) OR
   (v_change.status='in_progress' AND p_status IN ('completed','cancelled'))
 ) THEN RAISE EXCEPTION 'invalid client change transition';END IF;
 IF p_status IN ('rejected','cancelled') AND p_status<>v_change.status AND (v_note IS NULL OR length(v_note)<3) THEN RAISE EXCEPTION 'reason required for client change rejection or cancellation';END IF;
 UPDATE client_changes SET status=p_status,assignee_membership_id=p_assignee WHERE tenant_id=p_tenant AND id=p_change;
 INSERT INTO client_change_events(tenant_id,project_id,change_id,from_status,to_status,note,actor_membership_id,event_type,previous_assignee_membership_id,assignee_membership_id,idempotency_key)
 VALUES(p_tenant,v_change.project_id,p_change,v_change.status,p_status,v_note,p_actor,
   CASE WHEN v_change.status<>p_status THEN 'status_changed' WHEN v_change.assignee_membership_id IS DISTINCT FROM p_assignee THEN 'assignee_changed' ELSE 'note_added' END,
   v_change.assignee_membership_id,p_assignee,p_key);
 INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data,metadata)
 VALUES(p_tenant,v_actor_user,'client_change.updated','client_change',p_change,
   jsonb_build_object('status',v_change.status,'assigneeId',v_change.assignee_membership_id),
   jsonb_build_object('status',p_status,'assigneeId',p_assignee),jsonb_build_object('projectId',v_change.project_id,'note',v_note));
 INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
 VALUES(p_tenant,'client_change',p_change,'client_change.updated.v1',
   jsonb_build_object('clientChangeId',p_change,'projectId',v_change.project_id,'status',p_status,'assigneeId',p_assignee));
 RETURN p_change;
END $$;
GRANT EXECUTE ON FUNCTION app.transition_client_change_v2(uuid,uuid,text,text,uuid,text,uuid) TO develocrm_app;

COMMIT;

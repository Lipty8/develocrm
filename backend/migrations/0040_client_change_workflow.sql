BEGIN;

ALTER TABLE client_changes DROP CONSTRAINT client_changes_status_check;
ALTER TABLE client_changes ADD CONSTRAINT client_changes_status_check
  CHECK(status IN ('requested','pricing','pending_approval','approved','rejected','in_progress','completed','cancelled','archived'));

CREATE TABLE client_change_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 project_id uuid NOT NULL,
 change_id uuid NOT NULL,
 from_status text NOT NULL,
 to_status text NOT NULL,
 note text,
 actor_membership_id uuid NOT NULL,
 occurred_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT client_change_events_change_fk FOREIGN KEY(tenant_id,change_id) REFERENCES client_changes(tenant_id,id) ON DELETE RESTRICT,
 CONSTRAINT client_change_events_project_fk FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id) ON DELETE RESTRICT,
 CONSTRAINT client_change_events_actor_fk FOREIGN KEY(tenant_id,actor_membership_id) REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT
);
CREATE INDEX client_change_events_history_idx ON client_change_events(tenant_id,change_id,occurred_at DESC);
ALTER TABLE client_change_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_change_events FORCE ROW LEVEL SECURITY;
CREATE POLICY client_change_events_tenant_policy ON client_change_events
 USING(tenant_id=app.current_tenant_id()) WITH CHECK(tenant_id=app.current_tenant_id());
GRANT SELECT,INSERT ON client_change_events TO develocrm_app;

CREATE OR REPLACE FUNCTION app.transition_client_change(
 p_tenant uuid,p_change uuid,p_status text,p_note text,p_actor uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_change client_changes%ROWTYPE;v_actor_user uuid;v_note text:=NULLIF(btrim(p_note),'');
BEGIN
 SELECT * INTO v_change FROM client_changes WHERE tenant_id=p_tenant AND id=p_change FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'client change not found';END IF;
 IF NOT app.has_project_permission(p_tenant,p_actor,v_change.project_id,'client_changes.manage') THEN
   RAISE EXCEPTION 'client_changes.manage permission required';END IF;
 SELECT user_id INTO v_actor_user FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor AND status='active';
 IF v_actor_user IS NULL THEN RAISE EXCEPTION 'active actor membership required';END IF;
 IF v_change.status=p_status THEN RETURN p_change;END IF;
 IF NOT (
   (v_change.status='requested' AND p_status IN ('pricing','pending_approval','cancelled')) OR
   (v_change.status='pricing' AND p_status IN ('pending_approval','cancelled')) OR
   (v_change.status='pending_approval' AND p_status IN ('approved','rejected','pricing')) OR
   (v_change.status='approved' AND p_status IN ('in_progress','completed','cancelled')) OR
   (v_change.status='in_progress' AND p_status IN ('completed','cancelled'))
 ) THEN RAISE EXCEPTION 'invalid client change transition';END IF;
 IF p_status IN ('rejected','cancelled') AND (v_note IS NULL OR length(v_note)<3) THEN
   RAISE EXCEPTION 'reason required for client change rejection or cancellation';END IF;
 UPDATE client_changes SET status=p_status WHERE tenant_id=p_tenant AND id=p_change;
 INSERT INTO client_change_events(tenant_id,project_id,change_id,from_status,to_status,note,actor_membership_id)
 VALUES(p_tenant,v_change.project_id,p_change,v_change.status,p_status,v_note,p_actor);
 INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data,metadata)
 VALUES(p_tenant,v_actor_user,'client_change.status_changed','client_change',p_change,
   jsonb_build_object('status',v_change.status),jsonb_build_object('status',p_status),
   jsonb_build_object('projectId',v_change.project_id,'note',v_note));
 INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
 VALUES(p_tenant,'client_change',p_change,'client_change.status_changed.v1',
   jsonb_build_object('clientChangeId',p_change,'projectId',v_change.project_id,'from',v_change.status,'to',p_status));
 RETURN p_change;
END $$;
GRANT EXECUTE ON FUNCTION app.transition_client_change(uuid,uuid,text,text,uuid) TO develocrm_app;

COMMIT;

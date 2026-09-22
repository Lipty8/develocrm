BEGIN;

CREATE TABLE complaints (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL,
 unit_id uuid NOT NULL, party_id uuid NOT NULL, assignee_membership_id uuid,
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 2 AND 240),
 description text NOT NULL CHECK(length(btrim(description)) BETWEEN 3 AND 10000),
 status text NOT NULL DEFAULT 'new' CHECK(status IN ('new','in_progress','resolved')),
 due_at date, created_by_membership_id uuid NOT NULL,
 idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 8 AND 160),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT complaints_tenant_pair_uq UNIQUE(tenant_id,id),
 CONSTRAINT complaints_idempotency_uq UNIQUE(tenant_id,idempotency_key),
 CONSTRAINT complaints_project_fk FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id) ON DELETE RESTRICT,
 CONSTRAINT complaints_unit_fk FOREIGN KEY(tenant_id,project_id,unit_id) REFERENCES units(tenant_id,project_id,id) ON DELETE RESTRICT,
 CONSTRAINT complaints_party_fk FOREIGN KEY(tenant_id,party_id) REFERENCES parties(tenant_id,id) ON DELETE RESTRICT,
 CONSTRAINT complaints_assignee_fk FOREIGN KEY(tenant_id,assignee_membership_id) REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT,
 CONSTRAINT complaints_creator_fk FOREIGN KEY(tenant_id,created_by_membership_id) REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT
);
CREATE INDEX complaints_project_queue_idx ON complaints(tenant_id,project_id,status,due_at);
CREATE INDEX complaints_unit_idx ON complaints(tenant_id,unit_id,created_at DESC);
CREATE TRIGGER complaints_touch_updated_at BEFORE UPDATE ON complaints FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
ALTER TABLE complaints ENABLE ROW LEVEL SECURITY;
ALTER TABLE complaints FORCE ROW LEVEL SECURITY;
CREATE POLICY complaints_tenant_policy ON complaints USING(tenant_id=app.current_tenant_id()) WITH CHECK(tenant_id=app.current_tenant_id());
GRANT SELECT,INSERT,UPDATE ON complaints TO develocrm_app;

CREATE TABLE complaint_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL,
 complaint_id uuid NOT NULL, from_status text, to_status text NOT NULL,
 note text, idempotency_key text NOT NULL, actor_membership_id uuid NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT complaint_events_idempotency_uq UNIQUE(tenant_id,idempotency_key),
 CONSTRAINT complaint_events_complaint_fk FOREIGN KEY(tenant_id,complaint_id) REFERENCES complaints(tenant_id,id) ON DELETE RESTRICT,
 CONSTRAINT complaint_events_project_fk FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id) ON DELETE RESTRICT,
 CONSTRAINT complaint_events_actor_fk FOREIGN KEY(tenant_id,actor_membership_id) REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT
);
CREATE INDEX complaint_events_history_idx ON complaint_events(tenant_id,complaint_id,occurred_at DESC);
CREATE TRIGGER complaint_events_append_only BEFORE UPDATE OR DELETE ON complaint_events FOR EACH ROW EXECUTE FUNCTION app.reject_append_only();
ALTER TABLE complaint_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE complaint_events FORCE ROW LEVEL SECURITY;
CREATE POLICY complaint_events_tenant_policy ON complaint_events USING(tenant_id=app.current_tenant_id()) WITH CHECK(tenant_id=app.current_tenant_id());
GRANT SELECT,INSERT ON complaint_events TO develocrm_app;

CREATE OR REPLACE FUNCTION app.create_complaint(
 p_tenant uuid,p_project uuid,p_unit uuid,p_party uuid,p_title text,p_description text,
 p_assignee uuid,p_due_at date,p_key text,p_actor uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_id uuid;v_existing complaints%ROWTYPE;v_actor_user uuid;
BEGIN
 IF NOT app.has_project_permission(p_tenant,p_actor,p_project,'complaints.manage') THEN RAISE EXCEPTION 'complaints.manage permission required';END IF;
 SELECT user_id INTO v_actor_user FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor AND status='active';
 IF v_actor_user IS NULL THEN RAISE EXCEPTION 'active actor membership required';END IF;
 SELECT * INTO v_existing FROM complaints WHERE tenant_id=p_tenant AND idempotency_key=p_key;
 IF FOUND THEN
   IF v_existing.project_id<>p_project OR v_existing.unit_id<>p_unit OR v_existing.party_id<>p_party THEN RAISE EXCEPTION 'complaint idempotency key conflicts with another request';END IF;
   RETURN v_existing.id;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM units WHERE tenant_id=p_tenant AND project_id=p_project AND id=p_unit AND archived_at IS NULL) THEN RAISE EXCEPTION 'unit must belong to complaint project';END IF;
 IF NOT EXISTS(SELECT 1 FROM parties party JOIN party_project_links link ON link.tenant_id=party.tenant_id AND link.party_id=party.id AND link.project_id=p_project AND link.valid_to IS NULL WHERE party.tenant_id=p_tenant AND party.id=p_party) THEN RAISE EXCEPTION 'party must belong to complaint project';END IF;
 IF p_assignee IS NOT NULL AND NOT EXISTS(SELECT 1 FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_assignee AND status='active') THEN RAISE EXCEPTION 'assignee must be an active membership';END IF;
 INSERT INTO complaints(tenant_id,project_id,unit_id,party_id,title,description,assignee_membership_id,due_at,idempotency_key,created_by_membership_id)
 VALUES(p_tenant,p_project,p_unit,p_party,btrim(p_title),btrim(p_description),p_assignee,p_due_at,p_key,p_actor)
 ON CONFLICT(tenant_id,idempotency_key) DO NOTHING RETURNING id INTO v_id;
 IF v_id IS NULL THEN
   SELECT * INTO v_existing FROM complaints WHERE tenant_id=p_tenant AND idempotency_key=p_key;
   IF v_existing.project_id<>p_project OR v_existing.unit_id<>p_unit OR v_existing.party_id<>p_party THEN RAISE EXCEPTION 'complaint idempotency key conflicts with another request';END IF;
   RETURN v_existing.id;
 END IF;
 INSERT INTO complaint_events(tenant_id,project_id,complaint_id,to_status,note,idempotency_key,actor_membership_id) VALUES(p_tenant,p_project,v_id,'new',NULL,p_key,p_actor);
 INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data,metadata)
 VALUES(p_tenant,v_actor_user,'complaint.created','complaint',v_id,jsonb_build_object('status','new','title',btrim(p_title)),jsonb_build_object('projectId',p_project,'unitId',p_unit,'partyId',p_party));
 INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
 VALUES(p_tenant,'complaint',v_id,'complaint.created.v1',jsonb_build_object('complaintId',v_id,'projectId',p_project));
 RETURN v_id;
END $$;
GRANT EXECUTE ON FUNCTION app.create_complaint(uuid,uuid,uuid,uuid,text,text,uuid,date,text,uuid) TO develocrm_app;

CREATE OR REPLACE FUNCTION app.transition_complaint(
 p_tenant uuid,p_complaint uuid,p_status text,p_note text,p_assignee uuid,p_due_at date,p_key text,p_actor uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_complaint complaints%ROWTYPE;v_actor_user uuid;v_note text:=NULLIF(btrim(p_note),'');
BEGIN
 SELECT * INTO v_complaint FROM complaints WHERE tenant_id=p_tenant AND id=p_complaint FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'complaint not found';END IF;
 IF NOT app.has_project_permission(p_tenant,p_actor,v_complaint.project_id,'complaints.manage') THEN RAISE EXCEPTION 'complaints.manage permission required';END IF;
 IF EXISTS(SELECT 1 FROM complaint_events WHERE tenant_id=p_tenant AND complaint_id=p_complaint AND idempotency_key=p_key) THEN RETURN p_complaint;END IF;
 SELECT user_id INTO v_actor_user FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor AND status='active';
 IF v_actor_user IS NULL THEN RAISE EXCEPTION 'active actor membership required';END IF;
 IF p_assignee IS NOT NULL AND NOT EXISTS(SELECT 1 FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_assignee AND status='active') THEN RAISE EXCEPTION 'assignee must be an active membership';END IF;
 IF p_status=v_complaint.status AND p_assignee IS NOT DISTINCT FROM v_complaint.assignee_membership_id AND p_due_at IS NOT DISTINCT FROM v_complaint.due_at AND v_note IS NULL THEN RETURN p_complaint;END IF;
 IF p_status<>v_complaint.status AND NOT (
   (v_complaint.status='new' AND p_status IN ('in_progress','resolved')) OR
   (v_complaint.status='in_progress' AND p_status='resolved') OR
   (v_complaint.status='resolved' AND p_status='in_progress')
 ) THEN RAISE EXCEPTION 'invalid complaint transition';END IF;
 UPDATE complaints SET status=p_status,assignee_membership_id=p_assignee,due_at=p_due_at WHERE tenant_id=p_tenant AND id=p_complaint;
 INSERT INTO complaint_events(tenant_id,project_id,complaint_id,from_status,to_status,note,idempotency_key,actor_membership_id)
 VALUES(p_tenant,v_complaint.project_id,p_complaint,v_complaint.status,p_status,v_note,p_key,p_actor);
 INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data,metadata)
 VALUES(p_tenant,v_actor_user,'complaint.updated','complaint',p_complaint,
   jsonb_build_object('status',v_complaint.status,'assigneeId',v_complaint.assignee_membership_id,'dueAt',v_complaint.due_at),
   jsonb_build_object('status',p_status,'assigneeId',p_assignee,'dueAt',p_due_at),jsonb_build_object('projectId',v_complaint.project_id));
 INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
 VALUES(p_tenant,'complaint',p_complaint,'complaint.updated.v1',jsonb_build_object('complaintId',p_complaint,'projectId',v_complaint.project_id,'status',p_status));
 RETURN p_complaint;
END $$;
GRANT EXECUTE ON FUNCTION app.transition_complaint(uuid,uuid,text,text,uuid,date,text,uuid) TO develocrm_app;

COMMIT;

-- Visibility is independent of business lifecycle. Existing archived rows are
-- retained verbatim; their original lifecycle is unknown and must not be guessed.
ALTER TABLE projects DROP CONSTRAINT projects_archived_state;
ALTER TABLE projects ADD CONSTRAINT projects_archived_state
 CHECK (lifecycle_status <> 'archived' OR archived_at IS NOT NULL);

CREATE FUNCTION app.can_manage_project_archive(p_tenant uuid,p_actor uuid,p_project uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT p_tenant=app.current_tenant_id()
 AND app.current_user_has_permission('system.manage')
 AND EXISTS(SELECT 1 FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor
   AND user_id=app.current_user_id() AND status='active')
 AND app.has_project_permission(p_tenant,p_actor,p_project,'project.read')
$$;

CREATE FUNCTION app.set_project_archived(p_tenant uuid,p_project uuid,p_actor uuid,p_archived boolean,p_restore_lifecycle text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE old_row projects%ROWTYPE;new_row projects%ROWTYPE;actor uuid;
BEGIN
 IF p_archived IS NULL THEN RAISE EXCEPTION 'invalid archive state'; END IF;
 IF NOT app.can_manage_project_archive(p_tenant,p_actor,p_project) THEN
   RAISE EXCEPTION 'project archive permission required' USING ERRCODE='42501';
 END IF;
 SELECT * INTO old_row FROM projects WHERE tenant_id=p_tenant AND id=p_project FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'project not found'; END IF;
 IF (old_row.archived_at IS NOT NULL)=p_archived THEN RETURN false; END IF;
 IF NOT p_archived AND old_row.lifecycle_status='archived'
   AND (p_restore_lifecycle IS NULL OR p_restore_lifecycle NOT IN ('preparation','active','completed')) THEN
   RAISE EXCEPTION 'restore lifecycle required for legacy project';
 END IF;
 UPDATE projects SET archived_at=CASE WHEN p_archived THEN now() ELSE NULL END,
   lifecycle_status=CASE WHEN lifecycle_status='archived' AND NOT p_archived THEN p_restore_lifecycle ELSE lifecycle_status END
 WHERE tenant_id=p_tenant AND id=p_project RETURNING * INTO new_row;
 SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor;
 INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data)
 VALUES(p_tenant,actor,CASE WHEN p_archived THEN 'project.archived' ELSE 'project.restored' END,'project',p_project,to_jsonb(old_row),to_jsonb(new_row));
 INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
 VALUES(p_tenant,'project',p_project,CASE WHEN p_archived THEN 'project.archived.v1' ELSE 'project.restored.v1' END,
   jsonb_build_object('projectId',p_project,'archived',p_archived,'lifecycleStatus',new_row.lifecycle_status));
 RETURN true;
END $$;

-- The ordinary editor must not bypass archive authorization or implicitly restore.
CREATE OR REPLACE FUNCTION app.update_project_details(p_tenant uuid,p_project uuid,p_name text,p_location text,p_lifecycle text,p_manager uuid,p_handover_from date,p_handover_to date,p_actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE old_row jsonb;new_row jsonb;old_manager uuid;actor_user uuid;
BEGIN
 IF NOT app.has_project_permission(p_tenant,p_actor,p_project,'project.manage') THEN RAISE EXCEPTION 'project.manage permission required'; END IF;
 IF p_lifecycle NOT IN ('preparation','active','completed') THEN RAISE EXCEPTION 'invalid project lifecycle'; END IF;
 SELECT to_jsonb(project),manager_membership_id INTO old_row,old_manager FROM projects project WHERE tenant_id=p_tenant AND id=p_project FOR UPDATE;
 IF old_row IS NULL THEN RAISE EXCEPTION 'project not found'; END IF;
 IF old_row->>'archived_at' IS NOT NULL THEN RAISE EXCEPTION 'restore project before editing'; END IF;
 IF old_manager IS DISTINCT FROM p_manager AND NOT app.has_project_permission(p_tenant,p_actor,p_project,'projects.change_manager') THEN RAISE EXCEPTION 'projects.change_manager permission required'; END IF;
 IF p_manager IS NOT NULL AND NOT EXISTS(SELECT 1 FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_manager AND status='active') THEN RAISE EXCEPTION 'project manager must be an active tenant member'; END IF;
 SELECT user_id INTO actor_user FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor AND status='active' AND user_id=app.current_user_id();
 IF actor_user IS NULL THEN RAISE EXCEPTION 'active actor membership required'; END IF;
 UPDATE projects SET name=btrim(p_name),location=NULLIF(btrim(p_location),''),lifecycle_status=p_lifecycle,manager_membership_id=p_manager,planned_handover_from=p_handover_from,planned_handover_to=p_handover_to WHERE tenant_id=p_tenant AND id=p_project RETURNING to_jsonb(projects) INTO new_row;
 INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data,metadata)
 VALUES(p_tenant,actor_user,'project.updated','project',p_project,old_row,new_row,jsonb_build_object('projectAccessChanged',false));
 INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload) VALUES(p_tenant,'project',p_project,'project.updated.v2',new_row);
 RETURN p_project;
END $$;

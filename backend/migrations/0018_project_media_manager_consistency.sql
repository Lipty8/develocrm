BEGIN;

-- The v32 system-role rebuild intentionally replaced all grants, but omitted
-- project media and the two controlled project edit commands introduced in
-- earlier migrations. Restore them explicitly using the current scope model.
WITH grants(role_code,permission_code,scope) AS (VALUES
  ('admin','media.read','workspace'),('admin','media.manage','workspace'),
  ('admin','projects.change_manager','workspace'),('admin','projects.change_status','workspace'),
  ('project_manager','media.read','project'),('project_manager','media.manage','project'),
  ('project_manager','projects.change_manager','project'),('project_manager','projects.change_status','project'),
  ('back_office','media.read','project'),('back_office','media.manage','project'),
  ('sales','media.read','project')
)
INSERT INTO role_permissions(tenant_id,role_id,permission_id,scope)
SELECT role.tenant_id,role.id,permission.id,grants.scope
FROM grants
JOIN roles role ON role.code=grants.role_code
JOIN permissions permission ON permission.code=grants.permission_code
ON CONFLICT(tenant_id,role_id,permission_id) DO UPDATE SET scope=EXCLUDED.scope;

CREATE OR REPLACE FUNCTION app.update_project_details(p_tenant uuid,p_project uuid,p_name text,p_location text,p_lifecycle text,p_manager uuid,p_handover_from date,p_handover_to date,p_actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE old_row jsonb;new_row jsonb;old_manager uuid;actor_user uuid;manager_role uuid;
BEGIN
 IF NOT app.has_project_permission(p_tenant,p_actor,p_project,'project.manage') THEN RAISE EXCEPTION 'project.manage permission required'; END IF;
 SELECT to_jsonb(project),manager_membership_id INTO old_row,old_manager FROM projects project WHERE tenant_id=p_tenant AND id=p_project FOR UPDATE;
 IF old_row IS NULL THEN RAISE EXCEPTION 'project not found'; END IF;
 IF old_manager IS DISTINCT FROM p_manager AND NOT app.has_project_permission(p_tenant,p_actor,p_project,'projects.change_manager') THEN RAISE EXCEPTION 'projects.change_manager permission required'; END IF;
 IF p_manager IS NOT NULL AND NOT EXISTS(SELECT 1 FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_manager AND status='active') THEN RAISE EXCEPTION 'project manager must be an active tenant member'; END IF;
 SELECT user_id INTO actor_user FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor AND status='active';
 IF actor_user IS NULL THEN RAISE EXCEPTION 'active actor membership required'; END IF;
 SELECT id INTO manager_role FROM roles WHERE tenant_id=p_tenant AND code='project_manager';
 IF manager_role IS NULL THEN RAISE EXCEPTION 'project_manager role is missing'; END IF;

 UPDATE projects SET name=btrim(p_name),location=NULLIF(btrim(p_location),''),lifecycle_status=p_lifecycle,manager_membership_id=p_manager,planned_handover_from=p_handover_from,planned_handover_to=p_handover_to,archived_at=CASE WHEN p_lifecycle='archived' THEN COALESCE(archived_at,now()) ELSE NULL END WHERE tenant_id=p_tenant AND id=p_project RETURNING to_jsonb(projects) INTO new_row;

 IF old_manager IS DISTINCT FROM p_manager THEN
   IF old_manager IS NOT NULL THEN
     DELETE FROM project_role_assignments WHERE tenant_id=p_tenant AND project_id=p_project AND membership_id=old_manager AND role_id=manager_role;
   END IF;
 END IF;
 IF p_manager IS NOT NULL THEN
   INSERT INTO project_role_assignments(tenant_id,project_id,membership_id,role_id,assigned_by_user_id)
   VALUES(p_tenant,p_project,p_manager,manager_role,actor_user)
   ON CONFLICT(tenant_id,project_id,membership_id,role_id) DO NOTHING;
 END IF;

 INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data,metadata)
 VALUES(p_tenant,actor_user,'project.updated','project',p_project,old_row,new_row,jsonb_build_object('managerRoleAssignmentSynchronized',true));
 INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload) VALUES(p_tenant,'project',p_project,'project.updated.v2',new_row);
 RETURN p_project;
END $$;

COMMIT;

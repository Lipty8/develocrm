BEGIN;

ALTER TABLE projects ADD COLUMN address text;
ALTER TABLE projects ADD COLUMN description text;
ALTER TABLE projects ADD COLUMN project_company text;
ALTER TABLE projects ADD COLUMN default_currency text NOT NULL DEFAULT 'CZK'
  CHECK (default_currency ~ '^[A-Z]{3}$');
ALTER TABLE projects ADD COLUMN planned_unit_count integer
  CHECK (planned_unit_count IS NULL OR planned_unit_count >= 0);
ALTER TABLE projects ADD COLUMN note text;

INSERT INTO permissions(code, description)
VALUES ('projects.create', 'Projekty · založení')
ON CONFLICT(code) DO UPDATE SET description=EXCLUDED.description;

INSERT INTO role_permissions(tenant_id, role_id, permission_id, scope)
SELECT role.tenant_id, role.id, permission.id, 'workspace'
FROM roles role
JOIN permissions permission ON permission.code='projects.create'
WHERE role.code IN ('executive','admin')
ON CONFLICT(tenant_id, role_id, permission_id) DO UPDATE SET scope='workspace';

CREATE OR REPLACE FUNCTION app.create_project(
  p_tenant_id uuid, p_actor_membership_id uuid, p_name text, p_code text,
  p_slug text, p_location text, p_address text, p_description text,
  p_construction_status text, p_planned_handover_from date,
  p_manager_membership_id uuid, p_project_company text,
  p_default_currency text, p_planned_unit_count integer, p_note text
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_project_id uuid := gen_random_uuid();
  v_actor_user_id uuid;
BEGIN
  SELECT membership.user_id INTO v_actor_user_id
  FROM tenant_memberships membership
  WHERE membership.tenant_id=p_tenant_id AND membership.id=p_actor_membership_id
    AND membership.status='active';
  IF v_actor_user_id IS NULL THEN RAISE EXCEPTION 'active actor membership not found'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM role_assignments assignment
    JOIN roles role ON role.tenant_id=assignment.tenant_id AND role.id=assignment.role_id
    JOIN role_permissions role_permission
      ON role_permission.tenant_id=role.tenant_id AND role_permission.role_id=role.id
    JOIN permissions permission ON permission.id=role_permission.permission_id
    WHERE assignment.tenant_id=p_tenant_id
      AND assignment.membership_id=p_actor_membership_id
      AND permission.code='projects.create' AND role_permission.scope='workspace'
  ) THEN RAISE EXCEPTION 'missing permission projects.create'; END IF;
  IF p_manager_membership_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM tenant_memberships membership
    WHERE membership.tenant_id=p_tenant_id AND membership.id=p_manager_membership_id
      AND membership.status='active'
  ) THEN RAISE EXCEPTION 'manager must be an active membership in the same tenant'; END IF;

  INSERT INTO projects(
    id,tenant_id,code,name,slug,location,address,description,lifecycle_status,
    manager_membership_id,planned_handover_from,project_company,default_currency,
    planned_unit_count,note
  ) VALUES (
    v_project_id,p_tenant_id,upper(btrim(p_code)),btrim(p_name),lower(btrim(p_slug)),
    nullif(btrim(p_location),''),nullif(btrim(p_address),''),nullif(btrim(p_description),''),
    'preparation',p_manager_membership_id,p_planned_handover_from,
    nullif(btrim(p_project_company),''),upper(btrim(p_default_currency)),
    p_planned_unit_count,nullif(btrim(p_note),'')
  );
  INSERT INTO construction_status_events(
    tenant_id,project_id,structure_id,status_code,effective_at,note,recorded_by_membership_id
  ) VALUES (
    p_tenant_id,v_project_id,NULL,p_construction_status,now(),
    'Počáteční fáze při založení projektu',p_actor_membership_id
  );
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data)
  VALUES (
    p_tenant_id,v_actor_user_id,'project.created','project',v_project_id,
    jsonb_build_object('name',btrim(p_name),'code',upper(btrim(p_code)),
      'slug',lower(btrim(p_slug)),'constructionStatus',p_construction_status)
  );
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES (
    p_tenant_id,'project',v_project_id,'project.created.v1',
    jsonb_build_object('projectId',v_project_id,'code',upper(btrim(p_code)),
      'name',btrim(p_name),'actorMembershipId',p_actor_membership_id)
  );
  RETURN v_project_id;
END $$;

GRANT EXECUTE ON FUNCTION app.create_project(
  uuid,uuid,text,text,text,text,text,text,text,date,uuid,text,text,integer,text
) TO develocrm_app;

COMMIT;

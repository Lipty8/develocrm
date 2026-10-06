BEGIN;

-- Project access is now expressed directly as a business-area matrix.  The
-- legacy project roles remain in the catalogue for audit/history, but are no
-- longer an authorization source for project data.
ALTER TABLE project_custom_access
  DROP CONSTRAINT project_custom_access_access_level_check;
ALTER TABLE project_custom_access
  ADD CONSTRAINT project_custom_access_access_level_check
  CHECK (access_level IN ('none','read','edit'));
ALTER TABLE project_custom_access
  ADD COLUMN permission_overrides text[] NOT NULL DEFAULT ARRAY[]::text[];

CREATE OR REPLACE FUNCTION app.project_area_read_permissions(p_area text)
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_area
    WHEN 'project' THEN ARRAY['project.read','projects.read','media.read']
    WHEN 'units' THEN ARRAY['unit.read','units.read','accessory.read','accessories.read','price.read','prices.read','media.read']
    WHEN 'clients' THEN ARRAY['clients.read','clients.read_all','clients.read_contact_details','sales_case.read','sales_cases.read']
    WHEN 'contracts' THEN ARRAY['contract.read','contracts.read']
    WHEN 'payments' THEN ARRAY['payments.read']
    WHEN 'documents' THEN ARRAY['documents.view','documents.read']
    WHEN 'client_changes' THEN ARRAY['client_changes.read']
    WHEN 'handovers' THEN ARRAY['handover.read','handovers.read']
    WHEN 'complaints' THEN ARRAY['complaints.read']
    WHEN 'tasks' THEN ARRAY['tasks.read']
    ELSE ARRAY[]::text[] END
$$;

CREATE OR REPLACE FUNCTION app.project_area_edit_permissions(p_area text)
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT app.project_area_read_permissions(p_area) || CASE p_area
    WHEN 'project' THEN ARRAY['project.manage','projects.update','media.manage']
    WHEN 'units' THEN ARRAY['unit.manage','units.update','units.update_sales_status','accessory.manage','accessories.update','price.manage','prices.propose','media.manage']
    WHEN 'clients' THEN ARRAY['clients.create','clients.manage','clients.update','interests.manage','sales_case.manage','sales_cases.manage','holds.create','holds.cancel']
    WHEN 'contracts' THEN ARRAY['contract.manage','contracts.create','contracts.update']
    WHEN 'payments' THEN ARRAY['payments.record']
    WHEN 'documents' THEN ARRAY['documents.upload','documents.create','documents.edit_metadata','documents.update']
    WHEN 'client_changes' THEN ARRAY['client_changes.manage']
    WHEN 'handovers' THEN ARRAY['handover.manage','handovers.manage']
    WHEN 'complaints' THEN ARRAY['complaints.manage']
    WHEN 'tasks' THEN ARRAY['tasks.manage']
    ELSE ARRAY[]::text[] END
$$;

CREATE OR REPLACE FUNCTION app.permission_project_area(p_permission text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_permission LIKE 'project.%' OR p_permission LIKE 'projects.%' OR p_permission LIKE 'media.%' OR p_permission IN ('exports.run','audit.read') THEN 'project'
    WHEN p_permission LIKE 'unit.%' OR p_permission LIKE 'units.%' OR p_permission LIKE 'accessory.%' OR p_permission LIKE 'accessories.%'
      OR p_permission LIKE 'price.%' OR p_permission LIKE 'prices.%'
      OR p_permission IN ('discounts.approve','commercial_exceptions.approve','holds.confirm') THEN 'units'
    WHEN p_permission LIKE 'clients.%' OR p_permission LIKE 'interests.%' OR p_permission LIKE 'sales_case.%' OR p_permission LIKE 'sales_cases.%'
      OR p_permission IN ('holds.create','holds.cancel') THEN 'clients'
    WHEN p_permission LIKE 'contract.%' OR p_permission LIKE 'contracts.%' THEN 'contracts'
    WHEN p_permission LIKE 'payments.%' THEN 'payments'
    WHEN p_permission LIKE 'documents.%' THEN 'documents'
    WHEN p_permission LIKE 'client_changes.%' THEN 'client_changes'
    WHEN p_permission LIKE 'handover.%' OR p_permission LIKE 'handovers.%' THEN 'handovers'
    WHEN p_permission LIKE 'complaints.%' THEN 'complaints'
    WHEN p_permission LIKE 'tasks.%' THEN 'tasks'
    ELSE 'project' END
$$;

CREATE TEMP TABLE module_access_before ON COMMIT DROP AS
SELECT membership.tenant_id,membership.id membership_id,project.id project_id,permission.code,
  app.has_project_permission(membership.tenant_id,membership.id,project.id,permission.code) allowed
FROM tenant_memberships membership
JOIN projects project ON project.tenant_id=membership.tenant_id AND project.archived_at IS NULL
CROSS JOIN permissions permission
WHERE membership.status='active'
  AND permission.code NOT IN ('users.manage','roles.manage','role.manage','role.read','system.manage','integrations.manage','projects.create');

CREATE TEMP TABLE legacy_project_grants ON COMMIT DROP AS
SELECT before_access.tenant_id,before_access.project_id,before_access.membership_id,
  (SELECT max(assignment.assigned_by_user_id::text)::uuid FROM project_role_assignments assignment
    WHERE assignment.tenant_id=before_access.tenant_id AND assignment.project_id=before_access.project_id
      AND assignment.membership_id=before_access.membership_id) assigned_by_user_id,
  before_access.code
FROM module_access_before before_access
WHERE before_access.allowed AND EXISTS(
  SELECT 1 FROM project_role_assignments assignment
  WHERE assignment.tenant_id=before_access.tenant_id AND assignment.project_id=before_access.project_id
    AND assignment.membership_id=before_access.membership_id
);

-- The mutually-exclusive mode trigger requires removing deprecated role
-- assignments before existing matrix rows can be normalized.  The complete
-- effective snapshot and all legacy grants are already held in temp tables.
DELETE FROM project_role_assignments;

-- Preserve the exact effective permissions of an already configured matrix.
-- The new base levels are intentionally no broader than the 0047 levels;
-- permissions that used to be implicit (for example project status/manager
-- changes) become explicit overrides instead of silently disappearing.
UPDATE project_custom_access access SET permission_overrides=(
  SELECT ARRAY(
    SELECT DISTINCT before_access.code
    FROM module_access_before before_access
    WHERE before_access.tenant_id=access.tenant_id
      AND before_access.project_id=access.project_id
      AND before_access.membership_id=access.membership_id
      AND before_access.allowed
      AND app.permission_project_area(before_access.code)=access.area
      AND NOT(before_access.code=ANY(
        CASE access.access_level
          WHEN 'edit' THEN app.project_area_edit_permissions(access.area)
          WHEN 'read' THEN app.project_area_read_permissions(access.area)
          ELSE ARRAY[]::text[] END
      ))
    ORDER BY before_access.code
  )
);

WITH grouped AS (
  SELECT tenant_id,project_id,membership_id,max(assigned_by_user_id::text)::uuid assigned_by_user_id,
    app.permission_project_area(code) area,array_agg(DISTINCT code ORDER BY code) codes
  FROM legacy_project_grants
  GROUP BY tenant_id,project_id,membership_id,app.permission_project_area(code)
), classified AS (
  SELECT *,CASE
    WHEN ARRAY(SELECT candidate FROM unnest(app.project_area_edit_permissions(area)) candidate
      WHERE EXISTS(SELECT 1 FROM permissions permission WHERE permission.code=candidate)) <@ codes THEN 'edit'
    WHEN ARRAY(SELECT candidate FROM unnest(app.project_area_read_permissions(area)) candidate
      WHERE EXISTS(SELECT 1 FROM permissions permission WHERE permission.code=candidate)) <@ codes THEN 'read'
    ELSE 'none' END access_level
  FROM grouped
), normalized AS (
  SELECT *,CASE access_level
    WHEN 'edit' THEN app.project_area_edit_permissions(area)
    WHEN 'read' THEN app.project_area_read_permissions(area)
    ELSE ARRAY[]::text[] END base_permissions
  FROM classified
)
INSERT INTO project_custom_access(tenant_id,project_id,membership_id,area,access_level,permission_overrides,assigned_by_user_id)
SELECT tenant_id,project_id,membership_id,area,access_level,
  ARRAY(SELECT permission FROM unnest(codes) permission WHERE NOT(permission=ANY(base_permissions)) ORDER BY permission),
  assigned_by_user_id
FROM normalized
ON CONFLICT(tenant_id,project_id,membership_id,area) DO UPDATE SET
  permission_overrides=(SELECT ARRAY(SELECT DISTINCT permission FROM unnest(project_custom_access.permission_overrides || EXCLUDED.permission_overrides) permission ORDER BY permission)),
  assigned_by_user_id=EXCLUDED.assigned_by_user_id,
  assigned_at=now();

CREATE OR REPLACE FUNCTION app.custom_project_access_allows(p_area text,p_level text,p_permission text,p_overrides text[] DEFAULT ARRAY[]::text[])
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_permission=ANY(
      CASE p_level
        WHEN 'edit' THEN app.project_area_edit_permissions(p_area)
        WHEN 'read' THEN app.project_area_read_permissions(p_area)
        ELSE ARRAY[]::text[] END || COALESCE(p_overrides,ARRAY[]::text[])
    ) OR app.requested_project_permissions(p_permission) && COALESCE(p_overrides,ARRAY[]::text[])
$$;

CREATE OR REPLACE FUNCTION app.has_project_permission(p_tenant_id uuid,p_membership_id uuid,p_project_id uuid,p_permission text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,app AS $$
  SELECT EXISTS(
    SELECT 1 FROM tenant_memberships membership
    WHERE membership.tenant_id=p_tenant_id AND membership.id=p_membership_id AND membership.status='active'
      AND EXISTS(
        SELECT 1 FROM project_custom_access access
        WHERE access.tenant_id=p_tenant_id AND access.membership_id=p_membership_id
          AND access.project_id=p_project_id
          AND app.custom_project_access_allows(access.area,access.access_level,p_permission,access.permission_overrides)
      )
  )
$$;

-- New projects receive one explicit matrix for their creator.  This preserves
-- the former project_admin behavior without reintroducing project roles.
CREATE OR REPLACE FUNCTION app.assign_project_creator_access()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,app AS $$
DECLARE creator_membership uuid;creator_user uuid;area_name text;overrides text[];
BEGIN
  creator_user:=app.current_user_id();
  IF creator_user IS NULL THEN RETURN NEW; END IF;
  SELECT membership.id INTO creator_membership FROM tenant_memberships membership
  WHERE membership.tenant_id=NEW.tenant_id AND membership.user_id=creator_user AND membership.status='active'
  ORDER BY membership.accepted_at DESC NULLS LAST LIMIT 1;
  IF creator_membership IS NULL THEN RETURN NEW; END IF;
  FOREACH area_name IN ARRAY ARRAY['project','units','clients','contracts','payments','documents','client_changes','handovers','complaints','tasks'] LOOP
    overrides:=CASE area_name
      WHEN 'project' THEN ARRAY['projects.change_manager','projects.change_status','exports.run']
      WHEN 'units' THEN ARRAY['holds.confirm','prices.approve','discounts.approve','commercial_exceptions.approve']
      WHEN 'clients' THEN ARRAY['clients.archive']
      WHEN 'contracts' THEN ARRAY['contracts.mark_ready','contracts.record_signature']
      WHEN 'payments' THEN ARRAY['payments.manage','payments.reverse','payments.import','payments.export']
      WHEN 'documents' THEN ARRAY['documents.manage','documents.review','documents.archive']
      ELSE ARRAY[]::text[] END;
    INSERT INTO project_custom_access(tenant_id,project_id,membership_id,area,access_level,permission_overrides,assigned_by_user_id)
    VALUES(NEW.tenant_id,NEW.id,creator_membership,area_name,'edit',overrides,creator_user)
    ON CONFLICT(tenant_id,project_id,membership_id,area) DO NOTHING;
  END LOOP;
  RETURN NEW;
END $$;

-- A project manager is business data, not an authorization assignment. Access
-- is changed only through the explicit per-project matrix in user management.
CREATE OR REPLACE FUNCTION app.update_project_details(p_tenant uuid,p_project uuid,p_name text,p_location text,p_lifecycle text,p_manager uuid,p_handover_from date,p_handover_to date,p_actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE old_row jsonb;new_row jsonb;old_manager uuid;actor_user uuid;
BEGIN
 IF NOT app.has_project_permission(p_tenant,p_actor,p_project,'project.manage') THEN RAISE EXCEPTION 'project.manage permission required'; END IF;
 SELECT to_jsonb(project),manager_membership_id INTO old_row,old_manager FROM projects project WHERE tenant_id=p_tenant AND id=p_project FOR UPDATE;
 IF old_row IS NULL THEN RAISE EXCEPTION 'project not found'; END IF;
 IF old_manager IS DISTINCT FROM p_manager AND NOT app.has_project_permission(p_tenant,p_actor,p_project,'projects.change_manager') THEN RAISE EXCEPTION 'projects.change_manager permission required'; END IF;
 IF p_manager IS NOT NULL AND NOT EXISTS(SELECT 1 FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_manager AND status='active') THEN RAISE EXCEPTION 'project manager must be an active tenant member'; END IF;
 SELECT user_id INTO actor_user FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor AND status='active';
 IF actor_user IS NULL THEN RAISE EXCEPTION 'active actor membership required'; END IF;

 UPDATE projects SET name=btrim(p_name),location=NULLIF(btrim(p_location),''),lifecycle_status=p_lifecycle,manager_membership_id=p_manager,planned_handover_from=p_handover_from,planned_handover_to=p_handover_to,archived_at=CASE WHEN p_lifecycle='archived' THEN COALESCE(archived_at,now()) ELSE NULL END WHERE tenant_id=p_tenant AND id=p_project RETURNING to_jsonb(projects) INTO new_row;

 INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data,metadata)
 VALUES(p_tenant,actor_user,'project.updated','project',p_project,old_row,new_row,jsonb_build_object('projectAccessChanged',false));
 INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload) VALUES(p_tenant,'project',p_project,'project.updated.v2',new_row);
 RETURN p_project;
END $$;

-- Refund execution is intentionally separate from ordinary payment editing.
CREATE OR REPLACE FUNCTION app.create_payment_refund(
  p_tenant uuid,p_obligation uuid,p_source_transaction uuid,p_amount numeric,p_refunded_at timestamptz,
  p_reason text,p_idempotency_key text,p_actor_membership uuid
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE obligation payment_obligations%ROWTYPE;source_allocation numeric;already_source_refunded numeric;all_refunded numeric;planned numeric;actor uuid;refund_id uuid;stored_reason text;
BEGIN
  SELECT * INTO obligation FROM payment_obligations WHERE tenant_id=p_tenant AND id=p_obligation FOR UPDATE;
  SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF obligation.id IS NULL THEN RAISE EXCEPTION 'received payment allocation is required for refund';END IF;
  IF actor IS NULL OR NOT app.has_project_permission(p_tenant,p_actor_membership,obligation.project_id,'payments.reverse') THEN RAISE EXCEPTION 'payments.reverse permission required';END IF;
  SELECT id INTO refund_id FROM payment_refunds WHERE tenant_id=p_tenant AND idempotency_key=p_idempotency_key;
  IF refund_id IS NOT NULL THEN RETURN refund_id;END IF;
  SELECT allocation.amount INTO source_allocation FROM payment_allocations allocation
    WHERE allocation.tenant_id=p_tenant AND allocation.obligation_id=p_obligation AND allocation.transaction_id=p_source_transaction;
  IF source_allocation IS NULL THEN RAISE EXCEPTION 'received payment allocation is required for refund';END IF;
  SELECT decided_amount INTO planned FROM payment_refund_decisions WHERE tenant_id=p_tenant AND obligation_id=p_obligation ORDER BY decided_at DESC,id DESC LIMIT 1;
  IF planned IS NULL THEN RAISE EXCEPTION 'explicit refund decision is required';END IF;
  IF NOT EXISTS(SELECT 1 FROM contracts contract WHERE contract.tenant_id=p_tenant AND contract.id=obligation.contract_id AND contract.current_status IN ('cancelled','terminated')) THEN RAISE EXCEPTION 'refund is allowed only for an ended contract';END IF;
  IF p_amount IS NULL OR p_amount<=0 OR p_refunded_at IS NULL OR length(btrim(COALESCE(p_idempotency_key,'')))<8 THEN RAISE EXCEPTION 'valid refund amount, date and idempotency key are required';END IF;
  SELECT COALESCE(sum(amount),0) INTO already_source_refunded FROM payment_refunds WHERE tenant_id=p_tenant AND obligation_id=p_obligation AND source_transaction_id=p_source_transaction;
  SELECT COALESCE(sum(amount),0) INTO all_refunded FROM payment_refunds WHERE tenant_id=p_tenant AND obligation_id=p_obligation;
  IF p_amount>source_allocation-already_source_refunded OR p_amount>planned-all_refunded THEN RAISE EXCEPTION 'refund amount exceeds decided refundable amount';END IF;
  stored_reason:=COALESCE(NULLIF(btrim(p_reason),''),'Vratka evidovaná v CRM');
  INSERT INTO payment_refunds(tenant_id,project_id,obligation_id,source_transaction_id,amount,refunded_at,reason,idempotency_key,created_by_membership_id)
  VALUES(p_tenant,obligation.project_id,p_obligation,p_source_transaction,p_amount,p_refunded_at,stored_reason,btrim(p_idempotency_key),p_actor_membership) RETURNING id INTO refund_id;
  INSERT INTO domain_events(tenant_id,project_id,aggregate_id,event_type,payload,actor_membership_id)
  VALUES(p_tenant,obligation.project_id,p_obligation,'payment.refund_created',jsonb_build_object('refundId',refund_id,'amount',p_amount,'refundedAt',p_refunded_at),p_actor_membership);
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data,context)
  VALUES(p_tenant,actor,'payment.refund_created','payment_refund',refund_id,jsonb_build_object('amount',p_amount,'refundedAt',p_refunded_at,'reason',stored_reason),jsonb_build_object('projectId',obligation.project_id,'obligationId',p_obligation,'sourceTransactionId',p_source_transaction));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'payment_refund',refund_id,'payment.refund_created.v1',jsonb_build_object('refundId',refund_id,'obligationId',p_obligation,'sourceTransactionId',p_source_transaction,'amount',p_amount,'projectId',obligation.project_id));
  RETURN refund_id;
END $$;

DO $$
DECLARE drift_count integer;drift_details text;
BEGIN
  SELECT count(*),string_agg(format('%s/%s/%s:%s->%s',before_access.membership_id,before_access.project_id,
    before_access.code,before_access.allowed,app.has_project_permission(
      before_access.tenant_id,before_access.membership_id,before_access.project_id,before_access.code
    )),', ' ORDER BY before_access.membership_id,before_access.project_id,before_access.code)
  INTO drift_count,drift_details FROM module_access_before before_access
  WHERE before_access.allowed IS DISTINCT FROM app.has_project_permission(
    before_access.tenant_id,before_access.membership_id,before_access.project_id,before_access.code
  );
  IF drift_count<>0 THEN RAISE EXCEPTION 'Project module migration aborted: % unexpected permission changes: %',drift_count,drift_details;END IF;
END $$;

GRANT EXECUTE ON FUNCTION app.project_area_read_permissions(text) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.project_area_edit_permissions(text) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.permission_project_area(text) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.custom_project_access_allows(text,text,text,text[]) TO develocrm_app;

COMMIT;

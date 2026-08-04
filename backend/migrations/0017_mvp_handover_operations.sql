BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS unit_handovers_one_open_per_unit_uq
  ON unit_handovers(tenant_id,unit_id)
  WHERE status <> 'cancelled';

ALTER TABLE unit_handovers
  ADD COLUMN IF NOT EXISTS protocol_status text NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS protocol_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

DO $$ BEGIN
  ALTER TABLE unit_handovers ADD CONSTRAINT unit_handovers_protocol_status_check
    CHECK(protocol_status IN ('not_started','prepared','signed'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION app.schedule_unit_handover(
  p_tenant uuid,p_unit uuid,p_scheduled_at timestamptz,p_responsible uuid,p_actor uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_project uuid;v_handover uuid;v_actor_user uuid;
BEGIN
  SELECT project_id INTO v_project FROM units
   WHERE tenant_id=p_tenant AND id=p_unit AND archived_at IS NULL FOR UPDATE;
  IF v_project IS NULL THEN RAISE EXCEPTION 'unit not found'; END IF;
  IF NOT app.has_project_permission(p_tenant,p_actor,v_project,'handovers.manage') THEN RAISE EXCEPTION 'handovers.manage permission required'; END IF;
  IF p_scheduled_at<=now() THEN RAISE EXCEPTION 'handover must be scheduled in the future'; END IF;
  IF NOT EXISTS(SELECT 1 FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_responsible AND status='active') THEN RAISE EXCEPTION 'responsible membership is not active'; END IF;
  IF EXISTS(SELECT 1 FROM unit_handovers WHERE tenant_id=p_tenant AND unit_id=p_unit AND status<>'cancelled') THEN RAISE EXCEPTION 'unit already has an active handover'; END IF;
  INSERT INTO unit_handovers(tenant_id,project_id,unit_id,scheduled_at,responsible_membership_id)
  VALUES(p_tenant,v_project,p_unit,p_scheduled_at,p_responsible) RETURNING id INTO v_handover;
  SELECT user_id INTO v_actor_user FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor;
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data)
  VALUES(p_tenant,v_actor_user,'handover.scheduled','unit_handover',v_handover,jsonb_build_object('unitId',p_unit,'projectId',v_project,'scheduledAt',p_scheduled_at,'responsibleMembershipId',p_responsible));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'unit_handover',v_handover,'handover.scheduled.v1',jsonb_build_object('handoverId',v_handover,'unitId',p_unit,'projectId',v_project,'scheduledAt',p_scheduled_at));
  RETURN v_handover;
END $$;

CREATE OR REPLACE FUNCTION app.update_unit_handover(
  p_tenant uuid,p_handover uuid,p_scheduled_at timestamptz,p_responsible uuid,p_status text,p_readiness integer,p_attention text,p_actor uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_project uuid;v_actor_user uuid;v_before jsonb;v_after jsonb;
BEGIN
  SELECT project_id,to_jsonb(unit_handovers) INTO v_project,v_before FROM unit_handovers WHERE tenant_id=p_tenant AND id=p_handover FOR UPDATE;
  IF v_project IS NULL THEN RAISE EXCEPTION 'handover not found'; END IF;
  IF NOT app.has_project_permission(p_tenant,p_actor,v_project,'handovers.manage') THEN RAISE EXCEPTION 'handovers.manage permission required'; END IF;
  IF p_status NOT IN ('planned','ready','in_progress','completed','cancelled') THEN RAISE EXCEPTION 'invalid handover status'; END IF;
  IF p_readiness NOT BETWEEN 0 AND 100 THEN RAISE EXCEPTION 'invalid readiness'; END IF;
  IF NOT EXISTS(SELECT 1 FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_responsible AND status='active') THEN RAISE EXCEPTION 'responsible membership is not active'; END IF;
  UPDATE unit_handovers SET scheduled_at=p_scheduled_at,responsible_membership_id=p_responsible,status=p_status,readiness_percent=p_readiness,
    attention=NULLIF(btrim(p_attention),''),completed_at=CASE WHEN p_status='completed' THEN COALESCE(completed_at,now()) ELSE NULL END
   WHERE tenant_id=p_tenant AND id=p_handover RETURNING to_jsonb(unit_handovers) INTO v_after;
  SELECT user_id INTO v_actor_user FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor;
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data)
  VALUES(p_tenant,v_actor_user,'handover.updated','unit_handover',p_handover,v_before,v_after);
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'unit_handover',p_handover,'handover.updated.v1',v_after);
  RETURN p_handover;
END $$;

GRANT EXECUTE ON FUNCTION app.schedule_unit_handover(uuid,uuid,timestamptz,uuid,uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.update_unit_handover(uuid,uuid,timestamptz,uuid,text,integer,text,uuid) TO develocrm_app;

COMMIT;

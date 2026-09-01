BEGIN;

ALTER TABLE unit_handovers
  ADD COLUMN IF NOT EXISTS sales_case_id uuid,
  ADD COLUMN IF NOT EXISTS place text,
  ADD COLUMN IF NOT EXISTS note text,
  ADD COLUMN IF NOT EXISTS idempotency_key text;

DO $$ BEGIN
  ALTER TABLE unit_handovers ADD CONSTRAINT unit_handovers_sales_case_fk
    FOREIGN KEY(tenant_id,project_id,sales_case_id) REFERENCES sales_cases(tenant_id,project_id,id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DROP INDEX IF EXISTS unit_handovers_one_open_per_unit_uq;
CREATE UNIQUE INDEX unit_handovers_one_open_per_unit_uq
  ON unit_handovers(tenant_id,unit_id)
  WHERE status IN ('planned','ready','in_progress');
CREATE UNIQUE INDEX IF NOT EXISTS unit_handovers_idempotency_uq
  ON unit_handovers(tenant_id,idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS unit_handover_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  handover_id uuid NOT NULL,
  party_id uuid NOT NULL,
  participant_role text NOT NULL CHECK(participant_role IN ('buyer','co_buyer','representative','other')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unit_handover_participants_handover_fk FOREIGN KEY(tenant_id,handover_id) REFERENCES unit_handovers(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT unit_handover_participants_party_fk FOREIGN KEY(tenant_id,party_id) REFERENCES parties(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT unit_handover_participants_uq UNIQUE(tenant_id,handover_id,party_id,participant_role),
  CONSTRAINT unit_handover_participants_tenant_pair_uq UNIQUE(tenant_id,id)
);
ALTER TABLE unit_handover_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE unit_handover_participants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS unit_handover_participants_tenant_policy ON unit_handover_participants;
CREATE POLICY unit_handover_participants_tenant_policy ON unit_handover_participants
  USING(tenant_id=app.current_tenant_id()) WITH CHECK(tenant_id=app.current_tenant_id());
GRANT SELECT,INSERT ON unit_handover_participants TO develocrm_app;

CREATE OR REPLACE FUNCTION app.schedule_unit_handover_v2(
  p_tenant uuid,p_unit uuid,p_scheduled_at timestamptz,p_responsible uuid,
  p_place text,p_note text,p_idempotency_key text,p_actor uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_project uuid;v_case uuid;v_handover uuid;v_actor_user uuid;v_place text;
BEGIN
  IF NULLIF(btrim(p_idempotency_key),'') IS NULL THEN RAISE EXCEPTION 'handover idempotency key is required';END IF;
  SELECT id INTO v_handover FROM unit_handovers WHERE tenant_id=p_tenant AND idempotency_key=p_idempotency_key;
  IF v_handover IS NOT NULL THEN RETURN v_handover;END IF;
  SELECT project_id INTO v_project FROM units WHERE tenant_id=p_tenant AND id=p_unit AND archived_at IS NULL FOR UPDATE;
  IF v_project IS NULL THEN RAISE EXCEPTION 'unit not found';END IF;
  IF NOT app.has_project_permission(p_tenant,p_actor,v_project,'handovers.manage') THEN RAISE EXCEPTION 'handovers.manage permission required';END IF;
  IF p_scheduled_at<=now() THEN RAISE EXCEPTION 'handover must be scheduled in the future';END IF;
  IF NOT EXISTS(SELECT 1 FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_responsible AND status='active') THEN RAISE EXCEPTION 'responsible membership is not active';END IF;
  IF EXISTS(SELECT 1 FROM unit_handovers WHERE tenant_id=p_tenant AND unit_id=p_unit AND status IN ('planned','ready','in_progress')) THEN RAISE EXCEPTION 'unit already has an active handover';END IF;
  SELECT id INTO v_case FROM sales_cases WHERE tenant_id=p_tenant AND unit_id=p_unit AND status='active' ORDER BY opened_at DESC,id DESC LIMIT 1;
  SELECT COALESCE(NULLIF(btrim(p_place),''),NULLIF(btrim(location),''),'Místo bude upřesněno') INTO v_place FROM projects WHERE tenant_id=p_tenant AND id=v_project;
  INSERT INTO unit_handovers(tenant_id,project_id,unit_id,sales_case_id,scheduled_at,responsible_membership_id,place,note,idempotency_key)
  VALUES(p_tenant,v_project,p_unit,v_case,p_scheduled_at,p_responsible,v_place,NULLIF(btrim(p_note),''),p_idempotency_key)
  RETURNING id INTO v_handover;
  IF v_case IS NOT NULL THEN
    INSERT INTO unit_handover_participants(tenant_id,project_id,handover_id,party_id,participant_role)
    SELECT p_tenant,v_project,v_handover,participant.party_id,
      CASE participant.participant_role WHEN 'buyer' THEN 'buyer' WHEN 'co_buyer' THEN 'co_buyer' WHEN 'representative' THEN 'representative' ELSE 'other' END
    FROM sales_case_parties participant
    WHERE participant.tenant_id=p_tenant AND participant.sales_case_id=v_case AND participant.left_at IS NULL
      AND participant.participant_role IN ('buyer','co_buyer','representative')
    ON CONFLICT DO NOTHING;
  END IF;
  SELECT user_id INTO v_actor_user FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor;
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data,metadata)
  VALUES(p_tenant,v_actor_user,'handover.scheduled','unit_handover',v_handover,
    jsonb_build_object('unitId',p_unit,'projectId',v_project,'salesCaseId',v_case,'scheduledAt',p_scheduled_at,'responsibleMembershipId',p_responsible,'place',v_place),
    jsonb_build_object('note',NULLIF(btrim(p_note),'')));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'unit_handover',v_handover,'handover.scheduled.v1',jsonb_build_object('handoverId',v_handover,'unitId',p_unit,'projectId',v_project,'salesCaseId',v_case,'scheduledAt',p_scheduled_at));
  RETURN v_handover;
END $$;

CREATE OR REPLACE FUNCTION app.update_unit_handover_v2(
  p_tenant uuid,p_handover uuid,p_scheduled_at timestamptz,p_responsible uuid,p_status text,
  p_readiness integer,p_attention text,p_place text,p_note text,p_completed_at timestamptz,p_actor uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE row_before unit_handovers%ROWTYPE;v_actor_user uuid;v_after jsonb;v_unit_status text;v_case_stage text;v_completed_at timestamptz;
BEGIN
  SELECT * INTO row_before FROM unit_handovers WHERE tenant_id=p_tenant AND id=p_handover FOR UPDATE;
  IF row_before.id IS NULL THEN RAISE EXCEPTION 'handover not found';END IF;
  IF NOT app.has_project_permission(p_tenant,p_actor,row_before.project_id,'handovers.manage') THEN RAISE EXCEPTION 'handovers.manage permission required';END IF;
  IF p_status NOT IN ('planned','ready','in_progress','completed','cancelled') THEN RAISE EXCEPTION 'invalid handover status';END IF;
  IF p_readiness NOT BETWEEN 0 AND 100 THEN RAISE EXCEPTION 'invalid readiness';END IF;
  IF NOT EXISTS(SELECT 1 FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_responsible AND status='active') THEN RAISE EXCEPTION 'responsible membership is not active';END IF;
  IF NOT ((row_before.status='planned' AND p_status IN ('planned','ready','in_progress','completed','cancelled')) OR
          (row_before.status='ready' AND p_status IN ('ready','in_progress','completed','cancelled')) OR
          (row_before.status='in_progress' AND p_status IN ('in_progress','completed','cancelled')) OR
          (row_before.status='completed' AND p_status='completed') OR
          (row_before.status='cancelled' AND p_status='cancelled')) THEN RAISE EXCEPTION 'invalid handover status transition';END IF;
  IF row_before.status='completed' AND p_status='completed' THEN RETURN p_handover;END IF;
  IF p_status IN ('planned','ready') AND p_scheduled_at<=now() THEN RAISE EXCEPTION 'handover must be scheduled in the future';END IF;
  IF p_status='completed' THEN
    SELECT commercial_status INTO v_unit_status FROM units WHERE tenant_id=p_tenant AND id=row_before.unit_id FOR UPDATE;
    IF v_unit_status NOT IN ('sold','handed_over') THEN RAISE EXCEPTION 'handover completion requires a sold unit';END IF;
    v_completed_at:=COALESCE(p_completed_at,now());
    IF v_completed_at>now()+interval '5 minutes' THEN RAISE EXCEPTION 'handover completion date cannot be in the future';END IF;
    IF v_unit_status='sold' THEN
      PERFORM set_config('app.commercial_status_command','on',true);
      UPDATE units SET commercial_status='handed_over' WHERE tenant_id=p_tenant AND id=row_before.unit_id;
      INSERT INTO unit_commercial_status_events(tenant_id,project_id,unit_id,from_status,to_status,command,reason,recorded_by_membership_id)
      VALUES(p_tenant,row_before.project_id,row_before.unit_id,'sold','handed_over','completeHandover','Předání jednotky dokončeno',p_actor);
      INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data)
      SELECT p_tenant,user_id,'unit.commercial_status_changed','unit',row_before.unit_id,jsonb_build_object('commercialStatus','sold'),jsonb_build_object('commercialStatus','handed_over','command','completeHandover')
      FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor;
      INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
      VALUES(p_tenant,'unit',row_before.unit_id,'unit.commercial_status_changed.v1',jsonb_build_object('unitId',row_before.unit_id,'from','sold','to','handed_over','command','completeHandover'));
    END IF;
    IF row_before.sales_case_id IS NOT NULL THEN
      SELECT current_stage INTO v_case_stage FROM sales_cases WHERE tenant_id=p_tenant AND id=row_before.sales_case_id;
      IF v_case_stage IS DISTINCT FROM 'handover' THEN PERFORM app.record_sales_stage(p_tenant,row_before.sales_case_id,'handover','completeHandover','Předání jednotky dokončeno',p_actor);END IF;
    END IF;
  END IF;
  UPDATE unit_handovers SET scheduled_at=p_scheduled_at,responsible_membership_id=p_responsible,status=p_status,readiness_percent=p_readiness,
    attention=NULLIF(btrim(p_attention),''),place=COALESCE(NULLIF(btrim(p_place),''),place),note=NULLIF(btrim(p_note),''),
    completed_at=CASE WHEN p_status='completed' THEN COALESCE(v_completed_at,completed_at,now()) ELSE NULL END
  WHERE tenant_id=p_tenant AND id=p_handover RETURNING to_jsonb(unit_handovers) INTO v_after;
  SELECT user_id INTO v_actor_user FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor;
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data)
  VALUES(p_tenant,v_actor_user,CASE p_status WHEN 'completed' THEN 'handover.completed' WHEN 'cancelled' THEN 'handover.cancelled' ELSE 'handover.updated' END,
    'unit_handover',p_handover,to_jsonb(row_before),v_after);
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'unit_handover',p_handover,CASE p_status WHEN 'completed' THEN 'handover.completed.v1' WHEN 'cancelled' THEN 'handover.cancelled.v1' ELSE 'handover.updated.v1' END,v_after);
  RETURN p_handover;
END $$;

GRANT EXECUTE ON FUNCTION app.schedule_unit_handover_v2(uuid,uuid,timestamptz,uuid,text,text,text,uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.update_unit_handover_v2(uuid,uuid,timestamptz,uuid,text,integer,text,text,text,timestamptz,uuid) TO develocrm_app;

COMMIT;

BEGIN;

ALTER TABLE unit_handovers DROP CONSTRAINT IF EXISTS unit_handovers_status_check;
DROP INDEX IF EXISTS unit_handovers_one_open_per_unit_uq;

UPDATE unit_handovers SET status='planned' WHERE status IN ('ready','in_progress');
UPDATE unit_handovers SET status='handed_over' WHERE status='completed';

ALTER TABLE unit_handovers
  ADD CONSTRAINT unit_handovers_status_check CHECK(status IN ('planned','handed_over','cancelled'));

CREATE UNIQUE INDEX unit_handovers_one_open_per_unit_uq
  ON unit_handovers(tenant_id,unit_id)
  WHERE status='planned';

ALTER TABLE unit_handovers
  ADD CONSTRAINT unit_handovers_tenant_project_pair_uq UNIQUE(tenant_id,project_id,id);

CREATE TABLE unit_handover_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  handover_id uuid NOT NULL,
  event_type text NOT NULL CHECK(event_type IN ('planned','rescheduled','handed_over','cancelled')),
  previous_scheduled_at timestamptz,
  scheduled_at timestamptz,
  recorded_by_membership_id uuid,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unit_handover_events_handover_fk FOREIGN KEY(tenant_id,project_id,handover_id) REFERENCES unit_handovers(tenant_id,project_id,id) ON DELETE RESTRICT,
  CONSTRAINT unit_handover_events_actor_fk FOREIGN KEY(tenant_id,recorded_by_membership_id) REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT unit_handover_events_tenant_pair_uq UNIQUE(tenant_id,id)
);
CREATE INDEX unit_handover_events_timeline_idx ON unit_handover_events(tenant_id,handover_id,recorded_at DESC,id DESC);
ALTER TABLE unit_handover_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE unit_handover_events FORCE ROW LEVEL SECURITY;
CREATE POLICY unit_handover_events_tenant_policy ON unit_handover_events
  USING(tenant_id=app.current_tenant_id()) WITH CHECK(tenant_id=app.current_tenant_id());
GRANT SELECT,INSERT ON unit_handover_events TO develocrm_app;

INSERT INTO unit_handover_events(tenant_id,project_id,handover_id,event_type,scheduled_at,recorded_at)
SELECT tenant_id,project_id,id,
  CASE status WHEN 'handed_over' THEN 'handed_over' WHEN 'cancelled' THEN 'cancelled' ELSE 'planned' END,
  COALESCE(completed_at,scheduled_at),created_at
FROM unit_handovers;

CREATE OR REPLACE FUNCTION app.capture_unit_handover_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_actor uuid;
BEGIN
  v_actor:=NULLIF(current_setting('app.actor_membership_id',true),'')::uuid;
  IF v_actor IS NULL THEN
    SELECT id INTO v_actor FROM tenant_memberships
    WHERE tenant_id=NEW.tenant_id AND user_id=app.current_user_id() AND status='active'
    ORDER BY accepted_at NULLS LAST,id LIMIT 1;
  END IF;
  IF TG_OP='INSERT' THEN
    INSERT INTO unit_handover_events(tenant_id,project_id,handover_id,event_type,scheduled_at,recorded_by_membership_id)
    VALUES(NEW.tenant_id,NEW.project_id,NEW.id,'planned',NEW.scheduled_at,v_actor);
  ELSIF OLD.status='planned' AND NEW.status='planned' AND OLD.scheduled_at IS DISTINCT FROM NEW.scheduled_at THEN
    INSERT INTO unit_handover_events(tenant_id,project_id,handover_id,event_type,previous_scheduled_at,scheduled_at,recorded_by_membership_id)
    VALUES(NEW.tenant_id,NEW.project_id,NEW.id,'rescheduled',OLD.scheduled_at,NEW.scheduled_at,v_actor);
  ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('handed_over','cancelled') THEN
    INSERT INTO unit_handover_events(tenant_id,project_id,handover_id,event_type,previous_scheduled_at,scheduled_at,recorded_by_membership_id)
    VALUES(NEW.tenant_id,NEW.project_id,NEW.id,NEW.status,OLD.scheduled_at,COALESCE(NEW.completed_at,NEW.scheduled_at),v_actor);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS unit_handovers_capture_event ON unit_handovers;
CREATE TRIGGER unit_handovers_capture_event
  AFTER INSERT OR UPDATE OF scheduled_at,status ON unit_handovers
  FOR EACH ROW EXECUTE FUNCTION app.capture_unit_handover_event();

CREATE OR REPLACE FUNCTION app.update_unit_handover_v2(
  p_tenant uuid,p_handover uuid,p_scheduled_at timestamptz,p_responsible uuid,p_status text,
  p_readiness integer,p_attention text,p_place text,p_note text,p_completed_at timestamptz,p_actor uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE row_before unit_handovers%ROWTYPE;v_actor_user uuid;v_after jsonb;v_unit_status text;v_case_stage text;v_completed_at timestamptz;v_target_status text;v_action text;
BEGIN
  SELECT * INTO row_before FROM unit_handovers WHERE tenant_id=p_tenant AND id=p_handover FOR UPDATE;
  IF row_before.id IS NULL THEN RAISE EXCEPTION 'handover not found';END IF;
  IF NOT app.has_project_permission(p_tenant,p_actor,row_before.project_id,'handovers.manage') THEN RAISE EXCEPTION 'handovers.manage permission required';END IF;
  IF p_status NOT IN ('planned','rescheduled','handed_over','cancelled') THEN RAISE EXCEPTION 'invalid handover status';END IF;
  IF p_readiness NOT BETWEEN 0 AND 100 THEN RAISE EXCEPTION 'invalid readiness';END IF;
  IF NOT EXISTS(SELECT 1 FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_responsible AND status='active') THEN RAISE EXCEPTION 'responsible membership is not active';END IF;
  v_target_status:=CASE WHEN p_status='rescheduled' THEN 'planned' ELSE p_status END;
  IF row_before.status='handed_over' AND v_target_status='handed_over' THEN RETURN p_handover;END IF;
  IF row_before.status='cancelled' AND v_target_status='cancelled' THEN RETURN p_handover;END IF;
  IF row_before.status<>'planned' OR v_target_status NOT IN ('planned','handed_over','cancelled') THEN RAISE EXCEPTION 'invalid handover status transition';END IF;
  IF v_target_status='planned' AND p_scheduled_at<=now() THEN RAISE EXCEPTION 'handover must be scheduled in the future';END IF;
  IF p_status='rescheduled' AND row_before.scheduled_at IS NOT DISTINCT FROM p_scheduled_at THEN RAISE EXCEPTION 'rescheduled handover requires a new date';END IF;
  IF v_target_status='handed_over' THEN
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
  PERFORM set_config('app.actor_membership_id',p_actor::text,true);
  UPDATE unit_handovers SET scheduled_at=p_scheduled_at,responsible_membership_id=p_responsible,status=v_target_status,readiness_percent=p_readiness,
    attention=NULLIF(btrim(p_attention),''),place=COALESCE(NULLIF(btrim(p_place),''),place),note=NULLIF(btrim(p_note),''),
    completed_at=CASE WHEN v_target_status='handed_over' THEN COALESCE(v_completed_at,completed_at,now()) ELSE NULL END
  WHERE tenant_id=p_tenant AND id=p_handover RETURNING to_jsonb(unit_handovers) INTO v_after;
  SELECT user_id INTO v_actor_user FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor;
  v_action:=CASE WHEN v_target_status='handed_over' THEN 'handover.handed_over' WHEN v_target_status='cancelled' THEN 'handover.cancelled'
    WHEN row_before.scheduled_at IS DISTINCT FROM p_scheduled_at THEN 'handover.rescheduled' ELSE 'handover.updated' END;
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data)
  VALUES(p_tenant,v_actor_user,v_action,'unit_handover',p_handover,to_jsonb(row_before),v_after);
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'unit_handover',p_handover,v_action||'.v1',v_after);
  RETURN p_handover;
END $$;

GRANT EXECUTE ON FUNCTION app.update_unit_handover_v2(uuid,uuid,timestamptz,uuid,text,integer,text,text,text,timestamptz,uuid) TO develocrm_app;

COMMIT;

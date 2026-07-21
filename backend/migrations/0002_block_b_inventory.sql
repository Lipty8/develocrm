BEGIN;

CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9ČŘŠŽÝÁÍÉÚŮĚ_-]{2,16}$'),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 180),
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  location text,
  lifecycle_status text NOT NULL DEFAULT 'active' CHECK (lifecycle_status IN ('preparation', 'active', 'completed', 'archived')),
  manager_membership_id uuid,
  planned_handover_from date,
  planned_handover_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT projects_tenant_pair_uq UNIQUE (tenant_id, id),
  CONSTRAINT projects_manager_fk FOREIGN KEY (tenant_id, manager_membership_id)
    REFERENCES tenant_memberships(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT projects_handover_range CHECK (
    planned_handover_to IS NULL OR planned_handover_from IS NULL OR planned_handover_to >= planned_handover_from
  ),
  CONSTRAINT projects_archived_state CHECK ((lifecycle_status = 'archived') = (archived_at IS NOT NULL))
);
CREATE UNIQUE INDEX projects_tenant_code_uq ON projects (tenant_id, lower(code));
CREATE UNIQUE INDEX projects_tenant_slug_uq ON projects (tenant_id, lower(slug));

CREATE TABLE project_structures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  parent_id uuid,
  kind text NOT NULL CHECK (kind IN ('stage', 'building', 'section')),
  code text NOT NULL CHECK (length(btrim(code)) BETWEEN 1 AND 40),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 140),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT project_structures_project_fk FOREIGN KEY (tenant_id, project_id)
    REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT project_structures_parent_fk FOREIGN KEY (tenant_id, project_id, parent_id)
    REFERENCES project_structures(tenant_id, project_id, id) ON DELETE RESTRICT,
  CONSTRAINT project_structures_project_pair_uq UNIQUE (tenant_id, project_id, id),
  CONSTRAINT project_structures_tenant_pair_uq UNIQUE (tenant_id, id),
  CONSTRAINT project_structures_not_self CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE UNIQUE INDEX project_structures_code_uq
  ON project_structures (tenant_id, project_id, lower(code)) WHERE archived_at IS NULL;

CREATE TABLE construction_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  structure_id uuid,
  status_code text NOT NULL CHECK (status_code IN (
    'preparation', 'permitting', 'construction', 'rough_construction', 'installations', 'fit_out', 'completed'
  )),
  effective_at timestamptz NOT NULL,
  note text,
  recorded_by_membership_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT construction_events_project_fk FOREIGN KEY (tenant_id, project_id)
    REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT construction_events_structure_fk FOREIGN KEY (tenant_id, project_id, structure_id)
    REFERENCES project_structures(tenant_id, project_id, id) ON DELETE RESTRICT,
  CONSTRAINT construction_events_actor_fk FOREIGN KEY (tenant_id, recorded_by_membership_id)
    REFERENCES tenant_memberships(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT construction_events_tenant_pair_uq UNIQUE (tenant_id, id)
);
CREATE INDEX construction_events_current_idx
  ON construction_status_events (tenant_id, project_id, structure_id, effective_at DESC, recorded_at DESC);

CREATE TABLE units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  structure_id uuid,
  code text NOT NULL CHECK (length(btrim(code)) BETWEEN 1 AND 40),
  unit_type text NOT NULL DEFAULT 'apartment' CHECK (unit_type IN ('apartment', 'house', 'commercial', 'studio', 'other')),
  layout text,
  floor_label text,
  floor_number numeric(5,2),
  area_m2 numeric(10,2) NOT NULL CHECK (area_m2 > 0),
  orientation text,
  balcony_m2 numeric(10,2) CHECK (balcony_m2 IS NULL OR balcony_m2 >= 0),
  terrace_m2 numeric(10,2) CHECK (terrace_m2 IS NULL OR terrace_m2 >= 0),
  garden_m2 numeric(10,2) CHECK (garden_m2 IS NULL OR garden_m2 >= 0),
  commercial_status text NOT NULL DEFAULT 'available' CHECK (commercial_status IN (
    'available', 'pre_reserved', 'reserved', 'contracted', 'sold', 'handed_over', 'blocked'
  )),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT units_project_fk FOREIGN KEY (tenant_id, project_id)
    REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT units_structure_fk FOREIGN KEY (tenant_id, project_id, structure_id)
    REFERENCES project_structures(tenant_id, project_id, id) ON DELETE RESTRICT,
  CONSTRAINT units_project_pair_uq UNIQUE (tenant_id, project_id, id),
  CONSTRAINT units_tenant_pair_uq UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX units_code_uq ON units (tenant_id, project_id, lower(code)) WHERE archived_at IS NULL;
CREATE INDEX units_project_status_idx ON units (tenant_id, project_id, commercial_status) WHERE archived_at IS NULL;

CREATE TABLE unit_completion_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  unit_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('set_override', 'clear_override')),
  status_code text CHECK (status_code IN (
    'preparation', 'construction', 'rough_construction', 'installations', 'fit_out', 'completed'
  )),
  effective_at timestamptz NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) >= 3),
  recorded_by_membership_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unit_completion_event_shape CHECK (
    (event_type = 'set_override' AND status_code IS NOT NULL)
    OR (event_type = 'clear_override' AND status_code IS NULL)
  ),
  CONSTRAINT unit_completion_unit_fk FOREIGN KEY (tenant_id, project_id, unit_id)
    REFERENCES units(tenant_id, project_id, id) ON DELETE RESTRICT,
  CONSTRAINT unit_completion_actor_fk FOREIGN KEY (tenant_id, recorded_by_membership_id)
    REFERENCES tenant_memberships(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT unit_completion_tenant_pair_uq UNIQUE (tenant_id, id)
);
CREATE INDEX unit_completion_current_idx
  ON unit_completion_status_events (tenant_id, unit_id, effective_at DESC, recorded_at DESC);

CREATE TABLE unit_commercial_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  unit_id uuid NOT NULL,
  from_status text CHECK (from_status IS NULL OR from_status IN (
    'available', 'pre_reserved', 'reserved', 'contracted', 'sold', 'handed_over', 'blocked'
  )),
  to_status text NOT NULL CHECK (to_status IN (
    'available', 'pre_reserved', 'reserved', 'contracted', 'sold', 'handed_over', 'blocked'
  )),
  command text NOT NULL CHECK (command IN (
    'seed', 'createPreReservation', 'createReservation', 'expireHold', 'cancelPreReservation',
    'confirmReservation', 'cancelReservation', 'activateFuturePurchaseContract',
    'confirmFinalContractEffective', 'completeHandover', 'blockUnit', 'unblockUnit', 'compensateContract'
  )),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 3),
  recorded_by_membership_id uuid NOT NULL,
  effective_at timestamptz NOT NULL DEFAULT now(),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unit_commercial_seed_shape CHECK ((from_status IS NULL) = (command = 'seed')),
  CONSTRAINT unit_commercial_changed CHECK (from_status IS NULL OR from_status <> to_status),
  CONSTRAINT unit_commercial_unit_fk FOREIGN KEY (tenant_id, project_id, unit_id)
    REFERENCES units(tenant_id, project_id, id) ON DELETE RESTRICT,
  CONSTRAINT unit_commercial_actor_fk FOREIGN KEY (tenant_id, recorded_by_membership_id)
    REFERENCES tenant_memberships(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT unit_commercial_tenant_pair_uq UNIQUE (tenant_id, id)
);
CREATE INDEX unit_commercial_history_idx
  ON unit_commercial_status_events (tenant_id, unit_id, effective_at DESC, recorded_at DESC);

CREATE TABLE accessory_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[a-z][a-z0-9_]*$'),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 100),
  category text NOT NULL CHECK (category IN ('parking', 'cellar', 'wallbox', 'garage', 'storage', 'other')),
  allows_sharing boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT accessory_types_tenant_pair_uq UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX accessory_types_code_uq ON accessory_types (tenant_id, lower(code)) WHERE archived_at IS NULL;

CREATE TABLE accessories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  structure_id uuid,
  accessory_type_id uuid NOT NULL,
  code text NOT NULL CHECK (length(btrim(code)) BETWEEN 1 AND 40),
  area_m2 numeric(10,2) CHECK (area_m2 IS NULL OR area_m2 > 0),
  description text,
  operational_status text NOT NULL DEFAULT 'active' CHECK (operational_status IN ('active', 'out_of_service', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT accessories_project_fk FOREIGN KEY (tenant_id, project_id)
    REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT accessories_structure_fk FOREIGN KEY (tenant_id, project_id, structure_id)
    REFERENCES project_structures(tenant_id, project_id, id) ON DELETE RESTRICT,
  CONSTRAINT accessories_type_fk FOREIGN KEY (tenant_id, accessory_type_id)
    REFERENCES accessory_types(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT accessories_project_pair_uq UNIQUE (tenant_id, project_id, id),
  CONSTRAINT accessories_tenant_pair_uq UNIQUE (tenant_id, id),
  CONSTRAINT accessories_archived_state CHECK ((operational_status = 'archived') = (archived_at IS NOT NULL))
);
CREATE UNIQUE INDEX accessories_code_uq ON accessories (tenant_id, project_id, lower(code)) WHERE archived_at IS NULL;

CREATE TABLE accessory_relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  source_accessory_id uuid NOT NULL,
  target_accessory_id uuid NOT NULL,
  relation_type text NOT NULL CHECK (relation_type IN ('installed_at', 'depends_on', 'paired_with')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT accessory_relations_source_fk FOREIGN KEY (tenant_id, project_id, source_accessory_id)
    REFERENCES accessories(tenant_id, project_id, id) ON DELETE RESTRICT,
  CONSTRAINT accessory_relations_target_fk FOREIGN KEY (tenant_id, project_id, target_accessory_id)
    REFERENCES accessories(tenant_id, project_id, id) ON DELETE RESTRICT,
  CONSTRAINT accessory_relations_not_self CHECK (source_accessory_id <> target_accessory_id),
  CONSTRAINT accessory_relation_uq UNIQUE (tenant_id, source_accessory_id, target_accessory_id, relation_type),
  CONSTRAINT accessory_relations_tenant_pair_uq UNIQUE (tenant_id, id)
);

CREATE TABLE unit_accessory_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  unit_id uuid NOT NULL,
  accessory_id uuid NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_to timestamptz,
  note text,
  assigned_by_membership_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unit_accessory_assignment_range CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT unit_accessory_assignment_unit_fk FOREIGN KEY (tenant_id, project_id, unit_id)
    REFERENCES units(tenant_id, project_id, id) ON DELETE RESTRICT,
  CONSTRAINT unit_accessory_assignment_accessory_fk FOREIGN KEY (tenant_id, project_id, accessory_id)
    REFERENCES accessories(tenant_id, project_id, id) ON DELETE RESTRICT,
  CONSTRAINT unit_accessory_assignment_actor_fk FOREIGN KEY (tenant_id, assigned_by_membership_id)
    REFERENCES tenant_memberships(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT unit_accessory_assignments_tenant_pair_uq UNIQUE (tenant_id, id)
);
CREATE INDEX unit_accessory_assignments_lookup_idx
  ON unit_accessory_assignments (tenant_id, accessory_id, valid_from, valid_to);

CREATE TABLE accessory_price_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  accessory_id uuid NOT NULL,
  amount numeric(16,2) NOT NULL CHECK (amount >= 0),
  currency char(3) NOT NULL DEFAULT 'CZK' CHECK (currency ~ '^[A-Z]{3}$'),
  valid_from timestamptz NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) >= 3),
  recorded_by_membership_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT accessory_price_accessory_fk FOREIGN KEY (tenant_id, project_id, accessory_id)
    REFERENCES accessories(tenant_id, project_id, id) ON DELETE RESTRICT,
  CONSTRAINT accessory_price_actor_fk FOREIGN KEY (tenant_id, recorded_by_membership_id)
    REFERENCES tenant_memberships(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT accessory_price_tenant_pair_uq UNIQUE (tenant_id, id),
  CONSTRAINT accessory_price_effective_uq UNIQUE (tenant_id, accessory_id, valid_from)
);
CREATE INDEX accessory_price_lookup_idx
  ON accessory_price_history (tenant_id, accessory_id, valid_from DESC);

CREATE TABLE project_role_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  role_id uuid NOT NULL,
  assigned_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_role_assignment_project_fk FOREIGN KEY (tenant_id, project_id)
    REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT project_role_assignment_membership_fk FOREIGN KEY (tenant_id, membership_id)
    REFERENCES tenant_memberships(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT project_role_assignment_role_fk FOREIGN KEY (tenant_id, role_id)
    REFERENCES roles(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT project_role_assignment_uq UNIQUE (tenant_id, project_id, membership_id, role_id),
  CONSTRAINT project_role_assignments_tenant_pair_uq UNIQUE (tenant_id, id)
);

CREATE OR REPLACE FUNCTION app.validate_project_structure_hierarchy()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_kind text;
BEGIN
  IF NEW.parent_id IS NULL THEN
    IF NEW.kind = 'section' THEN
      RAISE EXCEPTION 'section must have a building or section parent';
    END IF;
    RETURN NEW;
  END IF;
  SELECT kind INTO parent_kind FROM project_structures
    WHERE tenant_id = NEW.tenant_id AND project_id = NEW.project_id AND id = NEW.parent_id;
  IF parent_kind IS NULL THEN RETURN NEW; END IF;
  IF NEW.kind = 'stage' OR (NEW.kind = 'building' AND parent_kind <> 'stage')
     OR (NEW.kind = 'section' AND parent_kind NOT IN ('building', 'section')) THEN
    RAISE EXCEPTION 'invalid project structure hierarchy: % under %', NEW.kind, parent_kind;
  END IF;
  IF EXISTS (
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_id FROM project_structures
       WHERE tenant_id = NEW.tenant_id AND project_id = NEW.project_id AND id = NEW.parent_id
      UNION ALL
      SELECT parent.id, parent.parent_id FROM project_structures parent
      JOIN ancestors child ON child.parent_id = parent.id
      WHERE parent.tenant_id = NEW.tenant_id AND parent.project_id = NEW.project_id
    ) SELECT 1 FROM ancestors WHERE id = NEW.id
  ) THEN
    RAISE EXCEPTION 'project structure cycle is not allowed';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER project_structure_hierarchy_guard
  BEFORE INSERT OR UPDATE OF tenant_id, project_id, parent_id, kind ON project_structures
  FOR EACH ROW EXECUTE FUNCTION app.validate_project_structure_hierarchy();

CREATE OR REPLACE FUNCTION app.guard_unit_commercial_status()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.commercial_status IS DISTINCT FROM OLD.commercial_status
     AND current_setting('app.commercial_status_command', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'commercial status can only be changed by a domain command';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER units_commercial_status_guard
  BEFORE UPDATE OF commercial_status ON units FOR EACH ROW
  EXECUTE FUNCTION app.guard_unit_commercial_status();

CREATE OR REPLACE FUNCTION app.reject_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$;
CREATE TRIGGER construction_events_append_only BEFORE UPDATE OR DELETE ON construction_status_events
  FOR EACH ROW EXECUTE FUNCTION app.reject_append_only();
CREATE TRIGGER unit_completion_events_append_only BEFORE UPDATE OR DELETE ON unit_completion_status_events
  FOR EACH ROW EXECUTE FUNCTION app.reject_append_only();
CREATE TRIGGER unit_commercial_events_append_only BEFORE UPDATE OR DELETE ON unit_commercial_status_events
  FOR EACH ROW EXECUTE FUNCTION app.reject_append_only();
CREATE TRIGGER accessory_prices_append_only BEFORE UPDATE OR DELETE ON accessory_price_history
  FOR EACH ROW EXECUTE FUNCTION app.reject_append_only();

CREATE OR REPLACE FUNCTION app.prevent_accessory_assignment_overlap()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE shareable boolean;
BEGIN
  SELECT type.allows_sharing INTO shareable
  FROM accessories accessory
  JOIN accessory_types type ON type.tenant_id = accessory.tenant_id AND type.id = accessory.accessory_type_id
  WHERE accessory.tenant_id = NEW.tenant_id AND accessory.id = NEW.accessory_id
  FOR UPDATE OF accessory;
  IF shareable IS NULL THEN RAISE EXCEPTION 'accessory not found'; END IF;
  IF NOT shareable AND EXISTS (
    SELECT 1 FROM unit_accessory_assignments existing
    WHERE existing.tenant_id = NEW.tenant_id AND existing.accessory_id = NEW.accessory_id
      AND existing.id <> NEW.id
      AND existing.valid_from < COALESCE(NEW.valid_to, 'infinity'::timestamptz)
      AND NEW.valid_from < COALESCE(existing.valid_to, 'infinity'::timestamptz)
  ) THEN
    RAISE EXCEPTION 'non-shareable accessory assignment overlaps an existing assignment';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER accessory_assignment_overlap_guard
  BEFORE INSERT OR UPDATE ON unit_accessory_assignments
  FOR EACH ROW EXECUTE FUNCTION app.prevent_accessory_assignment_overlap();

CREATE OR REPLACE FUNCTION app.validate_accessory_relation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_category text; target_category text;
BEGIN
  SELECT type.category INTO source_category FROM accessories accessory
  JOIN accessory_types type ON type.tenant_id = accessory.tenant_id AND type.id = accessory.accessory_type_id
  WHERE accessory.tenant_id = NEW.tenant_id AND accessory.id = NEW.source_accessory_id;
  SELECT type.category INTO target_category FROM accessories accessory
  JOIN accessory_types type ON type.tenant_id = accessory.tenant_id AND type.id = accessory.accessory_type_id
  WHERE accessory.tenant_id = NEW.tenant_id AND accessory.id = NEW.target_accessory_id;
  IF NEW.relation_type = 'installed_at' AND (source_category <> 'wallbox' OR target_category NOT IN ('parking', 'garage')) THEN
    RAISE EXCEPTION 'installed_at requires wallbox source and parking or garage target';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER accessory_relation_guard BEFORE INSERT OR UPDATE ON accessory_relations
  FOR EACH ROW EXECUTE FUNCTION app.validate_accessory_relation();

CREATE OR REPLACE FUNCTION app.transition_unit_commercial_status(
  p_tenant_id uuid, p_unit_id uuid, p_to_status text, p_command text,
  p_reason text, p_actor_membership_id uuid
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE current_status text; project uuid; actor uuid; event_id uuid := gen_random_uuid(); allowed boolean := false;
BEGIN
  SELECT commercial_status, project_id INTO current_status, project FROM units
    WHERE tenant_id = p_tenant_id AND id = p_unit_id FOR UPDATE;
  IF current_status IS NULL THEN RAISE EXCEPTION 'unit not found'; END IF;
  SELECT user_id INTO actor FROM tenant_memberships
    WHERE tenant_id = p_tenant_id AND id = p_actor_membership_id AND status = 'active';
  IF actor IS NULL THEN RAISE EXCEPTION 'active actor membership not found'; END IF;
  IF p_command NOT IN ('blockUnit', 'unblockUnit') THEN
    RAISE EXCEPTION 'command % requires its source module from block C or D', p_command;
  END IF;
  allowed :=
    (current_status = 'available' AND p_to_status IN ('pre_reserved', 'reserved', 'blocked')) OR
    (current_status = 'pre_reserved' AND p_to_status IN ('available', 'reserved', 'blocked')) OR
    (current_status = 'reserved' AND p_to_status IN ('available', 'contracted', 'blocked')) OR
    (current_status = 'contracted' AND p_to_status IN ('sold', 'available')) OR
    (current_status = 'sold' AND p_to_status IN ('handed_over', 'available')) OR
    (current_status = 'blocked' AND p_to_status = 'available');
  IF NOT allowed THEN RAISE EXCEPTION 'commercial status transition % -> % is not allowed', current_status, p_to_status; END IF;
  allowed := CASE p_command
    WHEN 'createPreReservation' THEN current_status = 'available' AND p_to_status = 'pre_reserved'
    WHEN 'createReservation' THEN current_status = 'available' AND p_to_status = 'reserved'
    WHEN 'expireHold' THEN current_status IN ('pre_reserved', 'reserved') AND p_to_status = 'available'
    WHEN 'cancelPreReservation' THEN current_status = 'pre_reserved' AND p_to_status = 'available'
    WHEN 'confirmReservation' THEN current_status = 'pre_reserved' AND p_to_status = 'reserved'
    WHEN 'cancelReservation' THEN current_status = 'reserved' AND p_to_status = 'available'
    WHEN 'activateFuturePurchaseContract' THEN current_status = 'reserved' AND p_to_status = 'contracted'
    WHEN 'confirmFinalContractEffective' THEN current_status = 'contracted' AND p_to_status = 'sold'
    WHEN 'completeHandover' THEN current_status = 'sold' AND p_to_status = 'handed_over'
    WHEN 'blockUnit' THEN current_status IN ('available', 'pre_reserved', 'reserved') AND p_to_status = 'blocked'
    WHEN 'unblockUnit' THEN current_status = 'blocked' AND p_to_status = 'available'
    ELSE false
  END;
  IF NOT allowed THEN RAISE EXCEPTION 'command % does not match transition', p_command; END IF;
  PERFORM set_config('app.commercial_status_command', 'on', true);
  UPDATE units SET commercial_status = p_to_status WHERE tenant_id = p_tenant_id AND id = p_unit_id;
  INSERT INTO unit_commercial_status_events
    (id, tenant_id, project_id, unit_id, from_status, to_status, command, reason, recorded_by_membership_id)
  VALUES (event_id, p_tenant_id, project, p_unit_id, current_status, p_to_status, p_command, p_reason, p_actor_membership_id);
  INSERT INTO audit_log (tenant_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
  VALUES (p_tenant_id, actor, 'unit.commercial_status_changed', 'unit', p_unit_id,
    jsonb_build_object('commercialStatus', current_status), jsonb_build_object('commercialStatus', p_to_status, 'command', p_command));
  INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, event_type, payload)
  VALUES (p_tenant_id, 'unit', p_unit_id, 'unit.commercial_status_changed.v1',
    jsonb_build_object('unitId', p_unit_id, 'from', current_status, 'to', p_to_status, 'command', p_command));
  RETURN event_id;
END $$;

CREATE OR REPLACE FUNCTION app.effective_unit_construction_status(p_tenant_id uuid, p_unit_id uuid)
RETURNS text LANGUAGE sql STABLE AS $$
  WITH RECURSIVE selected_unit AS (
    SELECT project_id, structure_id FROM units WHERE tenant_id = p_tenant_id AND id = p_unit_id
  ), lineage AS (
    SELECT structure.id, structure.parent_id, 0 AS depth
    FROM project_structures structure JOIN selected_unit unit ON unit.structure_id = structure.id
    WHERE structure.tenant_id = p_tenant_id AND structure.project_id = unit.project_id
    UNION ALL
    SELECT parent.id, parent.parent_id, child.depth + 1
    FROM project_structures parent JOIN lineage child ON child.parent_id = parent.id
    JOIN selected_unit unit ON true
    WHERE parent.tenant_id = p_tenant_id AND parent.project_id = unit.project_id
  ), override_event AS (
    SELECT event_type, status_code FROM unit_completion_status_events
    WHERE tenant_id = p_tenant_id AND unit_id = p_unit_id AND effective_at <= now()
    ORDER BY effective_at DESC, recorded_at DESC, id DESC LIMIT 1
  ), inherited AS (
    SELECT event.status_code, lineage.depth, event.effective_at, event.recorded_at, event.id
    FROM construction_status_events event JOIN lineage ON lineage.id = event.structure_id
    WHERE event.tenant_id = p_tenant_id AND event.effective_at <= now()
    UNION ALL
    SELECT event.status_code, 1000000, event.effective_at, event.recorded_at, event.id
    FROM construction_status_events event JOIN selected_unit unit ON unit.project_id = event.project_id
    WHERE event.tenant_id = p_tenant_id AND event.structure_id IS NULL AND event.effective_at <= now()
  )
  SELECT CASE
    WHEN (SELECT event_type FROM override_event) = 'set_override' THEN (SELECT status_code FROM override_event)
    ELSE (SELECT status_code FROM inherited ORDER BY depth, effective_at DESC, recorded_at DESC, id DESC LIMIT 1)
  END
$$;

CREATE OR REPLACE FUNCTION app.has_project_permission(
  p_tenant_id uuid, p_membership_id uuid, p_project_id uuid, p_permission text
) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM role_assignments assignment
    JOIN role_permissions grant_row
      ON grant_row.tenant_id=assignment.tenant_id AND grant_row.role_id=assignment.role_id
    JOIN permissions permission ON permission.id=grant_row.permission_id
    WHERE assignment.tenant_id=p_tenant_id AND assignment.membership_id=p_membership_id
      AND permission.code=p_permission
    UNION ALL
    SELECT 1 FROM project_role_assignments assignment
    JOIN role_permissions grant_row
      ON grant_row.tenant_id=assignment.tenant_id AND grant_row.role_id=assignment.role_id
    JOIN permissions permission ON permission.id=grant_row.permission_id
    WHERE assignment.tenant_id=p_tenant_id AND assignment.project_id=p_project_id
      AND assignment.membership_id=p_membership_id AND permission.code=p_permission
  )
$$;

CREATE TRIGGER projects_touch_updated_at BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER project_structures_touch_updated_at BEFORE UPDATE ON project_structures FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER units_touch_updated_at BEFORE UPDATE ON units FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER accessory_types_touch_updated_at BEFORE UPDATE ON accessory_types FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER accessories_touch_updated_at BEFORE UPDATE ON accessories FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

INSERT INTO permissions (code, description) VALUES
  ('project.read', 'Zobrazit projekty a jejich strukturu'), ('project.manage', 'Spravovat projekty'),
  ('structure.manage', 'Spravovat etapy, budovy a sekce'), ('construction_status.manage', 'Zapisovat stavební stav'),
  ('unit.read', 'Zobrazit jednotky'), ('unit.manage', 'Spravovat parametry jednotek'),
  ('commercial_status.manage', 'Provádět řízené obchodní přechody'),
  ('accessory.read', 'Zobrazit příslušenství'), ('accessory.manage', 'Spravovat příslušenství a jeho přiřazení')
ON CONFLICT (code) DO NOTHING;

CREATE POLICY users_same_tenant_select ON users FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM tenant_memberships target_membership
    WHERE target_membership.user_id = users.id
      AND target_membership.tenant_id = app.current_tenant_id()
      AND target_membership.status = 'active'
  )
);
INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT role.tenant_id, role.id, permission.id FROM roles role CROSS JOIN permissions permission
WHERE role.code = 'admin' ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT role.tenant_id, role.id, permission.id FROM roles role JOIN permissions permission ON permission.code IN
  ('project.read','project.manage','structure.manage','construction_status.manage','unit.read','unit.manage','commercial_status.manage','accessory.read','accessory.manage')
WHERE role.code = 'project_manager' ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT role.tenant_id, role.id, permission.id FROM roles role JOIN permissions permission ON permission.code IN
  ('project.read','unit.read','accessory.read') WHERE role.code IN ('sales','back_office') ON CONFLICT DO NOTHING;

DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'projects','project_structures','construction_status_events','units','unit_completion_status_events',
    'unit_commercial_status_events','accessory_types','accessories','accessory_relations',
    'unit_accessory_assignments','accessory_price_history','project_role_assignments'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id())',
      table_name || '_tenant_policy', table_name
    );
  END LOOP;
END $$;

DROP POLICY project_role_assignments_tenant_policy ON project_role_assignments;
CREATE POLICY project_role_assignments_tenant_policy ON project_role_assignments
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id() AND assigned_by_user_id = app.current_user_id());

GRANT SELECT, INSERT, UPDATE ON projects, project_structures, units, accessory_types, accessories TO develocrm_app;
GRANT SELECT, INSERT ON construction_status_events, unit_completion_status_events, unit_commercial_status_events,
  accessory_relations, unit_accessory_assignments, accessory_price_history TO develocrm_app;
GRANT SELECT, INSERT, DELETE ON project_role_assignments TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.transition_unit_commercial_status(uuid, uuid, text, text, text, uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.effective_unit_construction_status(uuid, uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.has_project_permission(uuid, uuid, uuid, text) TO develocrm_app;

COMMIT;

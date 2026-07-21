BEGIN;

CREATE TABLE parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  party_type text NOT NULL CHECK (party_type IN ('individual','organization')),
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 2 AND 200),
  lifecycle_status text NOT NULL DEFAULT 'active' CHECK (lifecycle_status IN ('active','inactive','merged','archived')),
  merged_into_party_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), archived_at timestamptz,
  CONSTRAINT parties_tenant_pair_uq UNIQUE (tenant_id,id),
  CONSTRAINT parties_merge_fk FOREIGN KEY (tenant_id,merged_into_party_id) REFERENCES parties(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT parties_not_self_merged CHECK (merged_into_party_id IS NULL OR merged_into_party_id<>id),
  CONSTRAINT parties_merged_state CHECK ((lifecycle_status='merged')=(merged_into_party_id IS NOT NULL)),
  CONSTRAINT parties_archived_state CHECK ((lifecycle_status='archived')=(archived_at IS NOT NULL))
);
CREATE INDEX parties_name_idx ON parties (tenant_id,lower(display_name)) WHERE archived_at IS NULL;

CREATE TABLE party_individual_details (
  tenant_id uuid NOT NULL, party_id uuid NOT NULL,
  first_name text NOT NULL, last_name text NOT NULL, preferred_name text,
  date_of_birth date, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,party_id),
  CONSTRAINT party_individual_party_fk FOREIGN KEY (tenant_id,party_id) REFERENCES parties(tenant_id,id) ON DELETE RESTRICT
);

CREATE TABLE party_organization_details (
  tenant_id uuid NOT NULL, party_id uuid NOT NULL,
  legal_name text NOT NULL, registration_number text, vat_number text, contact_person text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,party_id),
  CONSTRAINT party_organization_party_fk FOREIGN KEY (tenant_id,party_id) REFERENCES parties(tenant_id,id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX party_organization_registration_uq
  ON party_organization_details (tenant_id,upper(registration_number)) WHERE registration_number IS NOT NULL;

CREATE TABLE party_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, party_id uuid NOT NULL,
  contact_type text NOT NULL CHECK (contact_type IN ('email','phone','data_box','website','other')),
  label text, value text NOT NULL CHECK (length(btrim(value))>0), normalized_value text NOT NULL,
  is_primary boolean NOT NULL DEFAULT false, verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), archived_at timestamptz,
  CONSTRAINT party_contacts_party_fk FOREIGN KEY (tenant_id,party_id) REFERENCES parties(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT party_contacts_tenant_pair_uq UNIQUE (tenant_id,id),
  CONSTRAINT party_contact_value_uq UNIQUE (tenant_id,party_id,contact_type,normalized_value)
);
CREATE UNIQUE INDEX party_contact_primary_uq ON party_contacts (tenant_id,party_id,contact_type)
  WHERE is_primary AND archived_at IS NULL;
CREATE INDEX party_contacts_search_idx ON party_contacts (tenant_id,contact_type,normalized_value);

CREATE TABLE party_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, party_id uuid NOT NULL,
  address_type text NOT NULL CHECK (address_type IN ('residence','registered_office','correspondence','billing','other')),
  line1 text NOT NULL, line2 text, city text NOT NULL, postal_code text, country_code char(2) NOT NULL DEFAULT 'CZ',
  is_primary boolean NOT NULL DEFAULT false, valid_from date, valid_to date,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT party_addresses_party_fk FOREIGN KEY (tenant_id,party_id) REFERENCES parties(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT party_addresses_tenant_pair_uq UNIQUE (tenant_id,id),
  CONSTRAINT party_address_range CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to>=valid_from)
);
CREATE UNIQUE INDEX party_address_primary_uq ON party_addresses (tenant_id,party_id,address_type) WHERE is_primary AND valid_to IS NULL;

CREATE TABLE party_external_identifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, party_id uuid NOT NULL,
  source_system text NOT NULL, external_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT party_external_party_fk FOREIGN KEY (tenant_id,party_id) REFERENCES parties(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT party_external_identifier_uq UNIQUE (tenant_id,source_system,external_id),
  CONSTRAINT party_external_tenant_pair_uq UNIQUE (tenant_id,id)
);

CREATE TABLE party_private_identifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, party_id uuid NOT NULL,
  identifier_type text NOT NULL CHECK (identifier_type IN ('birth_number','passport','national_id','other')),
  ciphertext bytea NOT NULL, deterministic_hash bytea NOT NULL, key_version integer NOT NULL CHECK (key_version>0), last_four char(4),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT party_private_party_fk FOREIGN KEY (tenant_id,party_id) REFERENCES parties(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT party_private_identifier_uq UNIQUE (tenant_id,identifier_type,deterministic_hash),
  CONSTRAINT party_private_tenant_pair_uq UNIQUE (tenant_id,id)
);

CREATE TABLE party_project_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL, party_id uuid NOT NULL,
  relationship_type text NOT NULL CHECK (relationship_type IN ('prospect','buyer','owner','representative','other')),
  valid_from timestamptz NOT NULL DEFAULT now(), valid_to timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT party_project_project_fk FOREIGN KEY (tenant_id,project_id) REFERENCES projects(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT party_project_party_fk FOREIGN KEY (tenant_id,party_id) REFERENCES parties(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT party_project_range CHECK (valid_to IS NULL OR valid_to>valid_from),
  CONSTRAINT party_project_tenant_pair_uq UNIQUE (tenant_id,id)
);
CREATE UNIQUE INDEX party_project_active_uq ON party_project_links (tenant_id,project_id,party_id,relationship_type) WHERE valid_to IS NULL;

CREATE TABLE unit_interests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL, unit_id uuid NOT NULL, party_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','converted','closed')),
  first_interest_at timestamptz NOT NULL, last_interest_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unit_interests_unit_fk FOREIGN KEY (tenant_id,project_id,unit_id) REFERENCES units(tenant_id,project_id,id) ON DELETE RESTRICT,
  CONSTRAINT unit_interests_party_fk FOREIGN KEY (tenant_id,party_id) REFERENCES parties(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT unit_interest_uq UNIQUE (tenant_id,unit_id,party_id),
  CONSTRAINT unit_interests_tenant_pair_uq UNIQUE (tenant_id,id),
  CONSTRAINT unit_interests_project_pair_uq UNIQUE (tenant_id,project_id,id),
  CONSTRAINT unit_interest_time CHECK (last_interest_at>=first_interest_at)
);

CREATE TABLE sales_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL, unit_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','won','lost','cancelled','expired')),
  current_stage text NOT NULL DEFAULT 'interest' CHECK (current_stage IN ('interest','pre_reservation','reservation','rs','sbk','ks','handover')),
  opened_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz, close_reason text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_cases_unit_fk FOREIGN KEY (tenant_id,project_id,unit_id) REFERENCES units(tenant_id,project_id,id) ON DELETE RESTRICT,
  CONSTRAINT sales_cases_tenant_pair_uq UNIQUE (tenant_id,id),
  CONSTRAINT sales_cases_project_pair_uq UNIQUE (tenant_id,project_id,id),
  CONSTRAINT sales_case_closed_shape CHECK ((status='active')=(closed_at IS NULL))
);
CREATE UNIQUE INDEX sales_case_one_active_unit_uq ON sales_cases (tenant_id,unit_id) WHERE status='active';
CREATE INDEX sales_cases_project_idx ON sales_cases (tenant_id,project_id,status,current_stage);

CREATE TABLE sales_case_parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL,
  sales_case_id uuid NOT NULL, party_id uuid NOT NULL,
  participant_role text NOT NULL CHECK (participant_role IN ('buyer','co_buyer','representative','advisor','other')),
  ownership_share numeric(7,6) CHECK (ownership_share IS NULL OR (ownership_share>0 AND ownership_share<=1)),
  is_primary boolean NOT NULL DEFAULT false, joined_at timestamptz NOT NULL DEFAULT now(), left_at timestamptz,
  CONSTRAINT sales_case_parties_case_fk FOREIGN KEY (tenant_id,project_id,sales_case_id) REFERENCES sales_cases(tenant_id,project_id,id) ON DELETE RESTRICT,
  CONSTRAINT sales_case_parties_party_fk FOREIGN KEY (tenant_id,party_id) REFERENCES parties(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT sales_case_party_uq UNIQUE (tenant_id,sales_case_id,party_id,participant_role),
  CONSTRAINT sales_case_parties_tenant_pair_uq UNIQUE (tenant_id,id),
  CONSTRAINT sales_case_party_range CHECK (left_at IS NULL OR left_at>joined_at)
);
CREATE UNIQUE INDEX sales_case_primary_party_uq ON sales_case_parties (tenant_id,sales_case_id) WHERE is_primary AND left_at IS NULL;

CREATE TABLE interest_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL,
  unit_interest_id uuid NOT NULL, sales_case_id uuid,
  event_type text NOT NULL CHECK (event_type IN ('inquiry','viewing','offer','pre_reservation_requested','reservation_requested','converted_to_sales_case','reopened','closed','lost')),
  outcome text, note text, occurred_at timestamptz NOT NULL, recorded_by_membership_id uuid NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT interest_events_interest_fk FOREIGN KEY (tenant_id,project_id,unit_interest_id) REFERENCES unit_interests(tenant_id,project_id,id) ON DELETE RESTRICT,
  CONSTRAINT interest_events_case_fk FOREIGN KEY (tenant_id,project_id,sales_case_id) REFERENCES sales_cases(tenant_id,project_id,id) ON DELETE RESTRICT,
  CONSTRAINT interest_events_actor_fk FOREIGN KEY (tenant_id,recorded_by_membership_id) REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT interest_events_tenant_pair_uq UNIQUE (tenant_id,id)
);
CREATE INDEX interest_events_history_idx ON interest_events (tenant_id,unit_interest_id,occurred_at DESC,recorded_at DESC);

CREATE TABLE sales_stage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL, sales_case_id uuid NOT NULL,
  from_stage text CHECK (from_stage IS NULL OR from_stage IN ('interest','pre_reservation','reservation','rs','sbk','ks','handover')),
  to_stage text NOT NULL CHECK (to_stage IN ('interest','pre_reservation','reservation','rs','sbk','ks','handover')),
  command text NOT NULL, reason text NOT NULL CHECK (length(btrim(reason))>=3),
  occurred_at timestamptz NOT NULL DEFAULT now(), recorded_by_membership_id uuid NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_stage_case_fk FOREIGN KEY (tenant_id,project_id,sales_case_id) REFERENCES sales_cases(tenant_id,project_id,id) ON DELETE RESTRICT,
  CONSTRAINT sales_stage_actor_fk FOREIGN KEY (tenant_id,recorded_by_membership_id) REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT sales_stage_changed CHECK (from_stage IS NULL OR from_stage<>to_stage),
  CONSTRAINT sales_stage_tenant_pair_uq UNIQUE (tenant_id,id)
);
CREATE INDEX sales_stage_history_idx ON sales_stage_events (tenant_id,sales_case_id,occurred_at DESC,recorded_at DESC);

CREATE TABLE unit_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL,
  unit_id uuid NOT NULL, sales_case_id uuid NOT NULL,
  hold_type text NOT NULL CHECK (hold_type IN ('pre_reservation','reservation')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','cancelled','converted')),
  starts_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, ended_at timestamptz,
  idempotency_key text NOT NULL, expiring_event_emitted_at timestamptz,
  created_by_membership_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unit_holds_unit_fk FOREIGN KEY (tenant_id,project_id,unit_id) REFERENCES units(tenant_id,project_id,id) ON DELETE RESTRICT,
  CONSTRAINT unit_holds_case_fk FOREIGN KEY (tenant_id,project_id,sales_case_id) REFERENCES sales_cases(tenant_id,project_id,id) ON DELETE RESTRICT,
  CONSTRAINT unit_holds_actor_fk FOREIGN KEY (tenant_id,created_by_membership_id) REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT unit_hold_time CHECK (expires_at>starts_at),
  CONSTRAINT unit_hold_end_state CHECK ((status='active')=(ended_at IS NULL)),
  CONSTRAINT unit_hold_idempotency_uq UNIQUE (tenant_id,idempotency_key),
  CONSTRAINT unit_holds_tenant_pair_uq UNIQUE (tenant_id,id)
);
CREATE INDEX unit_holds_unit_time_idx ON unit_holds (tenant_id,unit_id,starts_at,expires_at) WHERE status='active';

CREATE OR REPLACE FUNCTION app.validate_party_detail_type() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected text := CASE TG_TABLE_NAME WHEN 'party_individual_details' THEN 'individual' ELSE 'organization' END; actual text;
BEGIN
  SELECT party_type INTO actual FROM parties WHERE tenant_id=NEW.tenant_id AND id=NEW.party_id;
  IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'party detail type mismatch'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER party_individual_type_guard BEFORE INSERT OR UPDATE ON party_individual_details FOR EACH ROW EXECUTE FUNCTION app.validate_party_detail_type();
CREATE TRIGGER party_organization_type_guard BEFORE INSERT OR UPDATE ON party_organization_details FOR EACH ROW EXECUTE FUNCTION app.validate_party_detail_type();

CREATE OR REPLACE FUNCTION app.validate_private_identifier_party() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM parties WHERE tenant_id=NEW.tenant_id AND id=NEW.party_id AND party_type='individual') THEN
    RAISE EXCEPTION 'private identifier requires an individual party';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER party_private_identifier_guard BEFORE INSERT OR UPDATE ON party_private_identifiers FOR EACH ROW EXECUTE FUNCTION app.validate_private_identifier_party();

CREATE OR REPLACE FUNCTION app.guard_sales_case_stage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.current_stage IS DISTINCT FROM OLD.current_stage AND current_setting('app.sales_stage_command',true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'sales stage can only be changed by a domain command';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sales_case_stage_guard BEFORE UPDATE OF current_stage ON sales_cases FOR EACH ROW EXECUTE FUNCTION app.guard_sales_case_stage();

CREATE TRIGGER interest_events_append_only BEFORE UPDATE OR DELETE ON interest_events FOR EACH ROW EXECUTE FUNCTION app.reject_append_only();
CREATE TRIGGER sales_stage_events_append_only BEFORE UPDATE OR DELETE ON sales_stage_events FOR EACH ROW EXECUTE FUNCTION app.reject_append_only();

CREATE OR REPLACE FUNCTION app.prevent_unit_hold_overlap() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM units WHERE tenant_id=NEW.tenant_id AND id=NEW.unit_id FOR UPDATE;
  IF NEW.status='active' AND EXISTS (
    SELECT 1 FROM unit_holds existing WHERE existing.tenant_id=NEW.tenant_id AND existing.unit_id=NEW.unit_id
      AND existing.status='active' AND existing.id<>NEW.id
      AND existing.starts_at<NEW.expires_at AND NEW.starts_at<existing.expires_at
  ) THEN RAISE EXCEPTION 'unit hold interval overlaps an active hold'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER unit_hold_overlap_guard BEFORE INSERT OR UPDATE ON unit_holds FOR EACH ROW EXECUTE FUNCTION app.prevent_unit_hold_overlap();

CREATE OR REPLACE FUNCTION app.record_sales_stage(
  p_tenant uuid,p_case uuid,p_to text,p_command text,p_reason text,p_actor_membership uuid
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE previous text; project uuid; event_id uuid:=gen_random_uuid();
BEGIN
  SELECT current_stage,project_id INTO previous,project FROM sales_cases WHERE tenant_id=p_tenant AND id=p_case FOR UPDATE;
  IF previous IS NULL THEN RAISE EXCEPTION 'sales case not found'; END IF;
  IF previous=p_to THEN RETURN NULL; END IF;
  PERFORM set_config('app.sales_stage_command','on',true);
  UPDATE sales_cases SET current_stage=p_to WHERE tenant_id=p_tenant AND id=p_case;
  INSERT INTO sales_stage_events(id,tenant_id,project_id,sales_case_id,from_stage,to_stage,command,reason,recorded_by_membership_id)
  VALUES(event_id,p_tenant,project,p_case,previous,p_to,p_command,p_reason,p_actor_membership);
  RETURN event_id;
END $$;

CREATE OR REPLACE FUNCTION app.transition_unit_commercial_status(
  p_tenant_id uuid,p_unit_id uuid,p_to_status text,p_command text,p_reason text,p_actor_membership_id uuid
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE current_status text; project uuid; actor uuid; event_id uuid:=gen_random_uuid(); allowed boolean:=false;
BEGIN
  SELECT commercial_status,project_id INTO current_status,project FROM units WHERE tenant_id=p_tenant_id AND id=p_unit_id FOR UPDATE;
  SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant_id AND id=p_actor_membership_id AND status='active';
  IF current_status IS NULL OR actor IS NULL THEN RAISE EXCEPTION 'unit or active actor membership not found'; END IF;
  allowed:=CASE p_command
    WHEN 'createPreReservation' THEN current_status='available' AND p_to_status='pre_reserved'
      AND EXISTS(SELECT 1 FROM unit_holds WHERE tenant_id=p_tenant_id AND unit_id=p_unit_id AND status='active' AND hold_type='pre_reservation' AND starts_at<=now() AND expires_at>now())
    WHEN 'createReservation' THEN current_status='available' AND p_to_status='reserved'
      AND EXISTS(SELECT 1 FROM unit_holds WHERE tenant_id=p_tenant_id AND unit_id=p_unit_id AND status='active' AND hold_type='reservation' AND starts_at<=now() AND expires_at>now())
    WHEN 'confirmReservation' THEN current_status='pre_reserved' AND p_to_status='reserved'
      AND EXISTS(SELECT 1 FROM unit_holds WHERE tenant_id=p_tenant_id AND unit_id=p_unit_id AND status='active' AND hold_type='reservation' AND starts_at<=now() AND expires_at>now())
    WHEN 'expireHold' THEN current_status IN ('pre_reserved','reserved') AND p_to_status='available'
      AND NOT EXISTS(SELECT 1 FROM unit_holds WHERE tenant_id=p_tenant_id AND unit_id=p_unit_id AND status='active' AND starts_at<=now() AND expires_at>now())
    WHEN 'cancelPreReservation' THEN current_status='pre_reserved' AND p_to_status='available'
      AND NOT EXISTS(SELECT 1 FROM unit_holds WHERE tenant_id=p_tenant_id AND unit_id=p_unit_id AND status='active' AND starts_at<=now() AND expires_at>now())
    WHEN 'cancelReservation' THEN current_status='reserved' AND p_to_status='available'
      AND NOT EXISTS(SELECT 1 FROM unit_holds WHERE tenant_id=p_tenant_id AND unit_id=p_unit_id AND status='active' AND starts_at<=now() AND expires_at>now())
    WHEN 'blockUnit' THEN current_status IN ('available','pre_reserved','reserved') AND p_to_status='blocked'
      AND NOT EXISTS(SELECT 1 FROM unit_holds WHERE tenant_id=p_tenant_id AND unit_id=p_unit_id AND status='active' AND starts_at<=now() AND expires_at>now())
    WHEN 'unblockUnit' THEN current_status='blocked' AND p_to_status='available'
    ELSE false END;
  IF NOT allowed THEN RAISE EXCEPTION 'commercial status command % violates source invariants',p_command; END IF;
  PERFORM set_config('app.commercial_status_command','on',true);
  UPDATE units SET commercial_status=p_to_status WHERE tenant_id=p_tenant_id AND id=p_unit_id;
  INSERT INTO unit_commercial_status_events(id,tenant_id,project_id,unit_id,from_status,to_status,command,reason,recorded_by_membership_id)
  VALUES(event_id,p_tenant_id,project,p_unit_id,current_status,p_to_status,p_command,p_reason,p_actor_membership_id);
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data)
  VALUES(p_tenant_id,actor,'unit.commercial_status_changed','unit',p_unit_id,jsonb_build_object('commercialStatus',current_status),jsonb_build_object('commercialStatus',p_to_status,'command',p_command));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant_id,'unit',p_unit_id,'unit.commercial_status_changed.v1',jsonb_build_object('unitId',p_unit_id,'from',current_status,'to',p_to_status,'command',p_command));
  RETURN event_id;
END $$;

CREATE OR REPLACE FUNCTION app.expire_unit_hold(p_tenant uuid,p_hold uuid,p_actor_membership uuid)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE hold_row unit_holds%ROWTYPE; actor uuid; unit_status text;
BEGIN
  SELECT * INTO hold_row FROM unit_holds WHERE tenant_id=p_tenant AND id=p_hold FOR UPDATE;
  IF hold_row.id IS NULL OR hold_row.status<>'active' THEN RETURN false; END IF;
  IF hold_row.expires_at>now() THEN RETURN false; END IF;
  SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF actor IS NULL THEN RAISE EXCEPTION 'active actor membership not found'; END IF;
  IF NOT app.has_project_permission(p_tenant,p_actor_membership,hold_row.project_id,'holds.manage') THEN RAISE EXCEPTION 'holds.manage permission required'; END IF;
  UPDATE unit_holds SET status='expired',ended_at=now() WHERE tenant_id=p_tenant AND id=p_hold;
  SELECT commercial_status INTO unit_status FROM units WHERE tenant_id=p_tenant AND id=hold_row.unit_id FOR UPDATE;
  IF NOT EXISTS(SELECT 1 FROM unit_holds WHERE tenant_id=p_tenant AND unit_id=hold_row.unit_id AND status='active' AND starts_at<=now() AND expires_at>now())
     AND unit_status=(CASE hold_row.hold_type WHEN 'pre_reservation' THEN 'pre_reserved' ELSE 'reserved' END) THEN
    PERFORM app.record_sales_stage(p_tenant,hold_row.sales_case_id,'interest','expireHold','Platnost rezervace skončila',p_actor_membership);
    PERFORM app.transition_unit_commercial_status(p_tenant,hold_row.unit_id,'available','expireHold','Platnost rezervace skončila',p_actor_membership);
  END IF;
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'hold',p_hold,'hold.expired.v1',jsonb_build_object('holdId',p_hold,'unitId',hold_row.unit_id));
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data)
  VALUES(p_tenant,actor,'hold.expired','unit_hold',p_hold,jsonb_build_object('unitId',hold_row.unit_id));
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION app.cancel_unit_hold(p_tenant uuid,p_hold uuid,p_actor_membership uuid,p_reason text)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE hold_row unit_holds%ROWTYPE; actor uuid; command text; unit_status text;
BEGIN
  SELECT * INTO hold_row FROM unit_holds WHERE tenant_id=p_tenant AND id=p_hold FOR UPDATE;
  IF hold_row.id IS NULL OR hold_row.status<>'active' THEN RETURN false; END IF;
  SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF actor IS NULL OR length(btrim(p_reason))<3 THEN RAISE EXCEPTION 'active actor and reason are required'; END IF;
  IF NOT app.has_project_permission(p_tenant,p_actor_membership,hold_row.project_id,'holds.manage') THEN RAISE EXCEPTION 'holds.manage permission required'; END IF;
  UPDATE unit_holds SET status='cancelled',ended_at=now() WHERE tenant_id=p_tenant AND id=p_hold;
  command:=CASE hold_row.hold_type WHEN 'pre_reservation' THEN 'cancelPreReservation' ELSE 'cancelReservation' END;
  SELECT commercial_status INTO unit_status FROM units WHERE tenant_id=p_tenant AND id=hold_row.unit_id FOR UPDATE;
  IF NOT EXISTS(SELECT 1 FROM unit_holds WHERE tenant_id=p_tenant AND unit_id=hold_row.unit_id AND status='active' AND starts_at<=now() AND expires_at>now())
     AND unit_status=(CASE hold_row.hold_type WHEN 'pre_reservation' THEN 'pre_reserved' ELSE 'reserved' END) THEN
    PERFORM app.record_sales_stage(p_tenant,hold_row.sales_case_id,'interest',command,p_reason,p_actor_membership);
    PERFORM app.transition_unit_commercial_status(p_tenant,hold_row.unit_id,'available',command,p_reason,p_actor_membership);
  END IF;
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'hold',p_hold,'hold.cancelled.v1',jsonb_build_object('holdId',p_hold,'unitId',hold_row.unit_id,'reason',p_reason));
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data)
  VALUES(p_tenant,actor,'hold.cancelled','unit_hold',p_hold,jsonb_build_object('reason',p_reason));
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION app.create_unit_hold(
  p_tenant uuid,p_unit uuid,p_hold_type text,p_party_ids uuid[],p_expires_at timestamptz,
  p_actor_membership uuid,p_interest_id uuid,p_idempotency_key text,p_reason text
) RETURNS TABLE(sales_case_id uuid,hold_id uuid) LANGUAGE plpgsql AS $$
DECLARE project uuid; actor uuid; current_status text; case_id uuid; new_hold uuid:=gen_random_uuid(); participant_id uuid; interest_id uuid; stale uuid;
BEGIN
  SELECT project_id,commercial_status INTO project,current_status FROM units WHERE tenant_id=p_tenant AND id=p_unit FOR UPDATE;
  SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF project IS NULL OR actor IS NULL OR p_hold_type NOT IN ('pre_reservation','reservation') OR p_expires_at<=now() OR cardinality(p_party_ids)<1 THEN
    RAISE EXCEPTION 'invalid hold command'; END IF;
  IF NOT app.has_project_permission(p_tenant,p_actor_membership,project,'holds.manage') THEN RAISE EXCEPTION 'holds.manage permission required'; END IF;
  IF (SELECT count(DISTINCT value) FROM unnest(p_party_ids) value)<>cardinality(p_party_ids)
     OR (SELECT count(*) FROM parties WHERE tenant_id=p_tenant AND id=ANY(p_party_ids) AND lifecycle_status='active')<>cardinality(p_party_ids) THEN
    RAISE EXCEPTION 'all participants must be unique active parties of the tenant'; END IF;
  SELECT unit_holds.sales_case_id,unit_holds.id INTO case_id,new_hold FROM unit_holds
    WHERE tenant_id=p_tenant AND idempotency_key=p_idempotency_key;
  IF new_hold IS NOT NULL THEN RETURN QUERY SELECT case_id,new_hold; RETURN; END IF;
  new_hold:=gen_random_uuid();
  FOR stale IN SELECT id FROM unit_holds WHERE tenant_id=p_tenant AND unit_id=p_unit AND status='active' AND expires_at<=now() FOR UPDATE
  LOOP PERFORM app.expire_unit_hold(p_tenant,stale,p_actor_membership); END LOOP;
  IF EXISTS(SELECT 1 FROM unit_holds WHERE tenant_id=p_tenant AND unit_id=p_unit AND status='active' AND starts_at< p_expires_at AND now()<expires_at) THEN
    RAISE EXCEPTION 'unit hold interval overlaps an active hold';
  END IF;
  SELECT id INTO case_id FROM sales_cases WHERE tenant_id=p_tenant AND unit_id=p_unit AND status='active' FOR UPDATE;
  IF case_id IS NULL THEN
    case_id:=gen_random_uuid();
    INSERT INTO sales_cases(id,tenant_id,project_id,unit_id,status,current_stage) VALUES(case_id,p_tenant,project,p_unit,'active','interest');
    INSERT INTO sales_stage_events(tenant_id,project_id,sales_case_id,from_stage,to_stage,command,reason,recorded_by_membership_id)
    VALUES(p_tenant,project,case_id,NULL,'interest','openCase',p_reason,p_actor_membership);
  END IF;
  FOREACH participant_id IN ARRAY p_party_ids LOOP
    INSERT INTO sales_case_parties(tenant_id,project_id,sales_case_id,party_id,participant_role,is_primary)
    VALUES(p_tenant,project,case_id,participant_id,CASE WHEN participant_id=p_party_ids[1] THEN 'buyer' ELSE 'co_buyer' END,participant_id=p_party_ids[1])
    ON CONFLICT ON CONSTRAINT sales_case_party_uq DO NOTHING;
    IF NOT EXISTS(SELECT 1 FROM party_project_links WHERE tenant_id=p_tenant AND project_id=project AND party_id=participant_id AND relationship_type='buyer' AND valid_to IS NULL) THEN
      INSERT INTO party_project_links(tenant_id,project_id,party_id,relationship_type) VALUES(p_tenant,project,participant_id,'buyer');
    END IF;
    INSERT INTO unit_interests(tenant_id,project_id,unit_id,party_id,status,first_interest_at,last_interest_at)
    VALUES(p_tenant,project,p_unit,participant_id,'converted',now(),now())
    ON CONFLICT (tenant_id,unit_id,party_id) DO UPDATE SET status='converted',last_interest_at=EXCLUDED.last_interest_at
    RETURNING id INTO interest_id;
    INSERT INTO interest_events(tenant_id,project_id,unit_interest_id,sales_case_id,event_type,outcome,occurred_at,recorded_by_membership_id)
    VALUES(p_tenant,project,interest_id,case_id,'converted_to_sales_case',p_hold_type,now(),p_actor_membership);
  END LOOP;
  IF p_interest_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM unit_interests WHERE tenant_id=p_tenant AND id=p_interest_id AND unit_id=p_unit) THEN
    RAISE EXCEPTION 'interest does not belong to unit'; END IF;
  INSERT INTO unit_holds(id,tenant_id,project_id,unit_id,sales_case_id,hold_type,starts_at,expires_at,idempotency_key,created_by_membership_id)
  VALUES(new_hold,p_tenant,project,p_unit,case_id,p_hold_type,now(),p_expires_at,p_idempotency_key,p_actor_membership);
  PERFORM app.record_sales_stage(p_tenant,case_id,CASE p_hold_type WHEN 'pre_reservation' THEN 'pre_reservation' ELSE 'reservation' END,
    CASE p_hold_type WHEN 'pre_reservation' THEN 'createPreReservation' ELSE 'createReservation' END,p_reason,p_actor_membership);
  PERFORM app.transition_unit_commercial_status(p_tenant,p_unit,CASE p_hold_type WHEN 'pre_reservation' THEN 'pre_reserved' ELSE 'reserved' END,
    CASE p_hold_type WHEN 'pre_reservation' THEN 'createPreReservation' ELSE 'createReservation' END,p_reason,p_actor_membership);
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data)
  VALUES(p_tenant,actor,'hold.created','unit_hold',new_hold,jsonb_build_object('type',p_hold_type,'unitId',p_unit,'salesCaseId',case_id));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'hold',new_hold,'hold.created.v1',jsonb_build_object('holdId',new_hold,'unitId',p_unit,'salesCaseId',case_id,'type',p_hold_type));
  RETURN QUERY SELECT case_id,new_hold;
END $$;

CREATE OR REPLACE FUNCTION app.convert_pre_reservation(
  p_tenant uuid,p_hold uuid,p_expires_at timestamptz,p_actor_membership uuid,p_idempotency_key text,p_reason text
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE old unit_holds%ROWTYPE; new_hold uuid:=gen_random_uuid(); actor uuid;
BEGIN
  SELECT * INTO old FROM unit_holds WHERE tenant_id=p_tenant AND id=p_hold FOR UPDATE;
  SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF old.id IS NULL OR old.status<>'active' OR old.hold_type<>'pre_reservation' OR old.expires_at<=now() OR p_expires_at<=now() OR actor IS NULL THEN
    RAISE EXCEPTION 'active pre-reservation and actor are required'; END IF;
  IF NOT app.has_project_permission(p_tenant,p_actor_membership,old.project_id,'holds.manage') THEN RAISE EXCEPTION 'holds.manage permission required'; END IF;
  SELECT id INTO new_hold FROM unit_holds WHERE tenant_id=p_tenant AND idempotency_key=p_idempotency_key;
  IF FOUND THEN RETURN new_hold; END IF;
  new_hold:=gen_random_uuid();
  UPDATE unit_holds SET status='converted',ended_at=now() WHERE tenant_id=p_tenant AND id=p_hold;
  INSERT INTO unit_holds(id,tenant_id,project_id,unit_id,sales_case_id,hold_type,starts_at,expires_at,idempotency_key,created_by_membership_id)
  VALUES(new_hold,p_tenant,old.project_id,old.unit_id,old.sales_case_id,'reservation',now(),p_expires_at,p_idempotency_key,p_actor_membership);
  PERFORM app.record_sales_stage(p_tenant,old.sales_case_id,'reservation','confirmReservation',p_reason,p_actor_membership);
  PERFORM app.transition_unit_commercial_status(p_tenant,old.unit_id,'reserved','confirmReservation',p_reason,p_actor_membership);
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data)
  VALUES(p_tenant,actor,'hold.converted','unit_hold',new_hold,jsonb_build_object('fromHoldId',p_hold,'unitId',old.unit_id));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'hold',new_hold,'hold.converted.v1',jsonb_build_object('fromHoldId',p_hold,'holdId',new_hold,'unitId',old.unit_id));
  RETURN new_hold;
END $$;

CREATE OR REPLACE FUNCTION app.enqueue_expiring_holds(p_tenant uuid,p_horizon interval)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE hold_row unit_holds%ROWTYPE; emitted integer:=0;
BEGIN
  FOR hold_row IN SELECT * FROM unit_holds WHERE tenant_id=p_tenant AND status='active' AND expires_at>now()
    AND expires_at<=now()+p_horizon AND expiring_event_emitted_at IS NULL FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE unit_holds SET expiring_event_emitted_at=now() WHERE tenant_id=p_tenant AND id=hold_row.id;
    INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
    VALUES(p_tenant,'hold',hold_row.id,'hold.expiring.v1',jsonb_build_object('holdId',hold_row.id,'unitId',hold_row.unit_id,'expiresAt',hold_row.expires_at));
    emitted:=emitted+1;
  END LOOP;
  RETURN emitted;
END $$;

CREATE TRIGGER parties_touch_updated_at BEFORE UPDATE ON parties FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER party_individual_touch_updated_at BEFORE UPDATE ON party_individual_details FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER party_organization_touch_updated_at BEFORE UPDATE ON party_organization_details FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER party_contacts_touch_updated_at BEFORE UPDATE ON party_contacts FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER party_addresses_touch_updated_at BEFORE UPDATE ON party_addresses FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER unit_interests_touch_updated_at BEFORE UPDATE ON unit_interests FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER sales_cases_touch_updated_at BEFORE UPDATE ON sales_cases FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

INSERT INTO permissions(code,description) VALUES
  ('clients.read','Zobrazit klienty a zájemce'),('clients.manage','Spravovat canonical parties a kontakty'),
  ('clients.export','Exportovat klientské kontakty'),('interests.manage','Spravovat historii zájmu'),
  ('sales_case.read','Zobrazit obchodní kontext jednotky'),('sales_case.manage','Spravovat sales case a účastníky'),
  ('holds.manage','Vytvářet, převádět, rušit a expirovat rezervace')
ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(tenant_id,role_id,permission_id)
SELECT role.tenant_id,role.id,permission.id FROM roles role CROSS JOIN permissions permission WHERE role.code='admin' ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(tenant_id,role_id,permission_id)
SELECT role.tenant_id,role.id,permission.id FROM roles role JOIN permissions permission ON permission.code IN
 ('clients.read','clients.manage','clients.export','interests.manage','sales_case.read','sales_case.manage','holds.manage')
WHERE role.code IN ('project_manager','back_office') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(tenant_id,role_id,permission_id)
SELECT role.tenant_id,role.id,permission.id FROM roles role JOIN permissions permission ON permission.code IN
 ('clients.read','clients.manage','clients.export','interests.manage','sales_case.read','sales_case.manage','holds.manage')
WHERE role.code='sales' ON CONFLICT DO NOTHING;

DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['parties','party_individual_details','party_organization_details','party_contacts','party_addresses',
    'party_external_identifiers','party_private_identifiers','party_project_links','unit_interests','sales_cases','sales_case_parties',
    'interest_events','sales_stage_events','unit_holds'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('CREATE POLICY %I ON %I USING (tenant_id=app.current_tenant_id()) WITH CHECK (tenant_id=app.current_tenant_id())',table_name||'_tenant_policy',table_name);
  END LOOP;
END $$;

GRANT SELECT,INSERT,UPDATE ON parties,party_individual_details,party_organization_details,party_contacts,party_addresses,
  party_external_identifiers,party_private_identifiers,party_project_links,unit_interests,sales_cases,sales_case_parties,unit_holds TO develocrm_app;
GRANT SELECT,INSERT ON interest_events,sales_stage_events TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.create_unit_hold(uuid,uuid,text,uuid[],timestamptz,uuid,uuid,text,text) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.expire_unit_hold(uuid,uuid,uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.cancel_unit_hold(uuid,uuid,uuid,text) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.convert_pre_reservation(uuid,uuid,timestamptz,uuid,text,text) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.enqueue_expiring_holds(uuid,interval) TO develocrm_app;

COMMIT;

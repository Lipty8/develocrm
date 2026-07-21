BEGIN;

CREATE TABLE unit_price_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL, unit_id uuid NOT NULL,
  price_type text NOT NULL CHECK (price_type IN ('list_price','individual_discount','sale_price','contract_price')),
  amount numeric(15,2) NOT NULL CHECK (amount>=0), amount_net numeric(15,2) CHECK (amount_net IS NULL OR (amount_net>=0 AND amount_net<=amount)), currency char(3) NOT NULL DEFAULT 'CZK', valid_from timestamptz NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason))>=3), recorded_by_membership_id uuid NOT NULL,
  approved_by_membership_id uuid, approved_at timestamptz, recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unit_prices_unit_fk FOREIGN KEY (tenant_id,project_id,unit_id) REFERENCES units(tenant_id,project_id,id) ON DELETE RESTRICT,
  CONSTRAINT unit_prices_author_fk FOREIGN KEY (tenant_id,recorded_by_membership_id) REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT unit_prices_approver_fk FOREIGN KEY (tenant_id,approved_by_membership_id) REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT unit_prices_tenant_pair_uq UNIQUE (tenant_id,id),
  CONSTRAINT unit_price_effective_uq UNIQUE (tenant_id,unit_id,price_type,valid_from),
  CONSTRAINT unit_price_approval_shape CHECK ((approved_by_membership_id IS NULL)=(approved_at IS NULL)),
  CONSTRAINT unit_price_sensitive_approval CHECK (price_type NOT IN ('individual_discount','contract_price') OR approved_by_membership_id IS NOT NULL)
);
CREATE INDEX unit_prices_current_idx ON unit_price_history(tenant_id,unit_id,price_type,valid_from DESC,recorded_at DESC);

CREATE TABLE contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL, unit_id uuid NOT NULL,
  sales_case_id uuid NOT NULL, contract_type text NOT NULL CHECK (contract_type IN ('rs','sbk','ks','amendment')),
  parent_contract_id uuid, reference text NOT NULL, title text NOT NULL,
  current_status text NOT NULL DEFAULT 'draft' CHECK (current_status IN ('draft','sent','negotiation','approved','signing','signed','cancelled','terminated')),
  created_by_membership_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  signed_at timestamptz, ended_at timestamptz, end_reason text,
  CONSTRAINT contracts_unit_fk FOREIGN KEY (tenant_id,project_id,unit_id) REFERENCES units(tenant_id,project_id,id) ON DELETE RESTRICT,
  CONSTRAINT contracts_case_fk FOREIGN KEY (tenant_id,project_id,sales_case_id) REFERENCES sales_cases(tenant_id,project_id,id) ON DELETE RESTRICT,
  CONSTRAINT contracts_creator_fk FOREIGN KEY (tenant_id,created_by_membership_id) REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT contracts_tenant_pair_uq UNIQUE (tenant_id,id),
  CONSTRAINT contracts_project_pair_uq UNIQUE (tenant_id,project_id,id),
  CONSTRAINT contracts_case_pair_uq UNIQUE (tenant_id,sales_case_id,id),
  CONSTRAINT contracts_reference_uq UNIQUE (tenant_id,reference),
  CONSTRAINT contracts_signed_shape CHECK ((current_status IN ('signed','terminated'))=(signed_at IS NOT NULL)),
  CONSTRAINT contracts_ended_shape CHECK ((current_status IN ('cancelled','terminated'))=(ended_at IS NOT NULL)),
  CONSTRAINT contracts_end_reason_shape CHECK ((ended_at IS NULL)=(end_reason IS NULL))
);
ALTER TABLE contracts ADD CONSTRAINT contracts_parent_fk FOREIGN KEY (tenant_id,project_id,parent_contract_id) REFERENCES contracts(tenant_id,project_id,id) ON DELETE RESTRICT;
CREATE INDEX contracts_scope_idx ON contracts(tenant_id,project_id,current_status,contract_type);

CREATE TABLE contract_parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL, contract_id uuid NOT NULL, party_id uuid NOT NULL,
  participant_role text NOT NULL CHECK (participant_role IN ('buyer','co_buyer','seller','representative','guarantor','other')),
  signing_required boolean NOT NULL DEFAULT true, signature_status text NOT NULL DEFAULT 'pending' CHECK (signature_status IN ('pending','signed','declined','not_required')),
  signed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contract_parties_contract_fk FOREIGN KEY (tenant_id,project_id,contract_id) REFERENCES contracts(tenant_id,project_id,id) ON DELETE RESTRICT,
  CONSTRAINT contract_parties_party_fk FOREIGN KEY (tenant_id,party_id) REFERENCES parties(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT contract_party_uq UNIQUE (tenant_id,contract_id,party_id,participant_role),
  CONSTRAINT contract_parties_tenant_pair_uq UNIQUE (tenant_id,id),
  CONSTRAINT contract_party_signature_shape CHECK ((signature_status='signed')=(signed_at IS NOT NULL)),
  CONSTRAINT contract_party_required_shape CHECK (signing_required OR signature_status='not_required')
);

CREATE TABLE contract_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL, contract_id uuid NOT NULL,
  version_number integer NOT NULL CHECK (version_number>0), based_on_version_id uuid,
  version_status text NOT NULL DEFAULT 'working' CHECK (version_status IN ('working','approved_for_signing','signed','superseded','cancelled')),
  source_type text NOT NULL DEFAULT 'manual' CHECK (source_type IN ('manual','generated','imported')),
  display_name text NOT NULL, generation_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  external_document_id text, external_document_version text, checksum text,
  created_by_membership_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), approved_at timestamptz, signed_at timestamptz, locked_at timestamptz,
  CONSTRAINT contract_versions_contract_fk FOREIGN KEY (tenant_id,project_id,contract_id) REFERENCES contracts(tenant_id,project_id,id) ON DELETE RESTRICT,
  CONSTRAINT contract_versions_creator_fk FOREIGN KEY (tenant_id,created_by_membership_id) REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT contract_versions_tenant_pair_uq UNIQUE (tenant_id,id),
  CONSTRAINT contract_versions_contract_pair_uq UNIQUE (tenant_id,project_id,contract_id,id),
  CONSTRAINT contract_version_number_uq UNIQUE (tenant_id,contract_id,version_number),
  CONSTRAINT contract_version_signed_shape CHECK ((version_status='signed')=(signed_at IS NOT NULL AND locked_at IS NOT NULL))
);
ALTER TABLE contract_versions ADD CONSTRAINT contract_versions_based_on_fk
  FOREIGN KEY (tenant_id,project_id,contract_id,based_on_version_id) REFERENCES contract_versions(tenant_id,project_id,contract_id,id) ON DELETE RESTRICT;
ALTER TABLE contract_parties ADD COLUMN signed_version_id uuid;
ALTER TABLE contract_parties ADD CONSTRAINT contract_party_signed_version_fk
  FOREIGN KEY (tenant_id,project_id,contract_id,signed_version_id) REFERENCES contract_versions(tenant_id,project_id,contract_id,id) ON DELETE RESTRICT;
ALTER TABLE contract_parties ADD CONSTRAINT contract_party_signed_version_shape CHECK ((signature_status='signed')=(signed_version_id IS NOT NULL));

CREATE TABLE contract_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL, contract_id uuid NOT NULL,
  from_status text CHECK (from_status IS NULL OR from_status IN ('draft','sent','negotiation','approved','signing','signed','cancelled','terminated')),
  to_status text NOT NULL CHECK (to_status IN ('draft','sent','negotiation','approved','signing','signed','cancelled','terminated')),
  command text NOT NULL, reason text NOT NULL CHECK (length(btrim(reason))>=3), occurred_at timestamptz NOT NULL DEFAULT now(),
  recorded_by_membership_id uuid NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contract_status_contract_fk FOREIGN KEY (tenant_id,project_id,contract_id) REFERENCES contracts(tenant_id,project_id,id) ON DELETE RESTRICT,
  CONSTRAINT contract_status_actor_fk FOREIGN KEY (tenant_id,recorded_by_membership_id) REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT contract_status_changed CHECK (from_status IS NULL OR from_status<>to_status),
  CONSTRAINT contract_status_tenant_pair_uq UNIQUE (tenant_id,id)
);
CREATE INDEX contract_status_history_idx ON contract_status_events(tenant_id,contract_id,occurred_at DESC,recorded_at DESC);

CREATE OR REPLACE FUNCTION app.reject_contract_version_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR OLD.version_status='signed' THEN RAISE EXCEPTION 'contract versions are historical and signed versions are immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER contract_versions_history_guard BEFORE UPDATE OR DELETE ON contract_versions FOR EACH ROW EXECUTE FUNCTION app.reject_contract_version_mutation();
CREATE TRIGGER unit_prices_append_only BEFORE UPDATE OR DELETE ON unit_price_history FOR EACH ROW EXECUTE FUNCTION app.reject_append_only();
CREATE TRIGGER contract_status_append_only BEFORE UPDATE OR DELETE ON contract_status_events FOR EACH ROW EXECUTE FUNCTION app.reject_append_only();

CREATE OR REPLACE FUNCTION app.guard_contract_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.current_status IS DISTINCT FROM OLD.current_status AND current_setting('app.contract_status_command',true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'contract status can only be changed by a domain command';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER contract_status_guard BEFORE UPDATE OF current_status ON contracts FOR EACH ROW EXECUTE FUNCTION app.guard_contract_status();
CREATE TRIGGER contracts_touch_updated_at BEFORE UPDATE ON contracts FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE OR REPLACE FUNCTION app.guard_contract_parties() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE contract_state text;
BEGIN
  SELECT current_status INTO contract_state FROM contracts WHERE tenant_id=COALESCE(NEW.tenant_id,OLD.tenant_id) AND id=COALESCE(NEW.contract_id,OLD.contract_id);
  IF contract_state IN ('signed','terminated') THEN RAISE EXCEPTION 'participants of a signed contract are immutable'; END IF;
  RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER contract_parties_guard BEFORE INSERT OR UPDATE OR DELETE ON contract_parties FOR EACH ROW EXECUTE FUNCTION app.guard_contract_parties();

CREATE OR REPLACE FUNCTION app.current_unit_price(p_tenant uuid,p_unit uuid,p_at timestamptz DEFAULT now())
RETURNS numeric LANGUAGE sql STABLE AS $$
  WITH latest AS (
    SELECT DISTINCT ON (price_type) price_type,amount FROM unit_price_history
    WHERE tenant_id=p_tenant AND unit_id=p_unit AND valid_from<=p_at
    ORDER BY price_type,valid_from DESC,recorded_at DESC,id DESC
  )
  SELECT COALESCE(
    (SELECT amount FROM latest WHERE price_type='contract_price'),
    (SELECT amount FROM latest WHERE price_type='sale_price'),
    GREATEST(COALESCE((SELECT amount FROM latest WHERE price_type='list_price'),0)-COALESCE((SELECT amount FROM latest WHERE price_type='individual_discount'),0),0)
  )
$$;

CREATE OR REPLACE VIEW unit_price_intervals AS
SELECT price.*,lead(valid_from) OVER (PARTITION BY tenant_id,unit_id,price_type ORDER BY valid_from,recorded_at,id) valid_to
FROM unit_price_history price;

CREATE OR REPLACE FUNCTION app.record_unit_price(
  p_tenant uuid,p_unit uuid,p_price_type text,p_amount numeric,p_currency text,p_valid_from timestamptz,
  p_reason text,p_actor_membership uuid,p_approver_membership uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE project uuid; actor uuid; approver uuid; price_id uuid:=gen_random_uuid(); previous numeric;
BEGIN
  SELECT project_id INTO project FROM units WHERE tenant_id=p_tenant AND id=p_unit FOR UPDATE;
  SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF project IS NULL OR actor IS NULL OR NOT app.has_project_permission(p_tenant,p_actor_membership,project,'price.manage') THEN RAISE EXCEPTION 'price.manage permission required'; END IF;
  IF p_approver_membership IS NOT NULL THEN
    SELECT user_id INTO approver FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_approver_membership AND status='active';
    IF approver IS NULL OR NOT app.has_project_permission(p_tenant,p_approver_membership,project,'price.approve') THEN RAISE EXCEPTION 'price.approve permission required'; END IF;
  END IF;
  SELECT amount INTO previous FROM unit_price_history WHERE tenant_id=p_tenant AND unit_id=p_unit AND price_type=p_price_type AND valid_from<=p_valid_from ORDER BY valid_from DESC LIMIT 1;
  INSERT INTO unit_price_history(id,tenant_id,project_id,unit_id,price_type,amount,currency,valid_from,reason,recorded_by_membership_id,approved_by_membership_id,approved_at)
  VALUES(price_id,p_tenant,project,p_unit,p_price_type,p_amount,upper(p_currency),p_valid_from,p_reason,p_actor_membership,p_approver_membership,CASE WHEN p_approver_membership IS NULL THEN NULL ELSE now() END);
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data)
  VALUES(p_tenant,actor,'unit.price_recorded','unit_price',price_id,jsonb_build_object('previousAmount',previous),jsonb_build_object('unitId',p_unit,'priceType',p_price_type,'amount',p_amount,'currency',upper(p_currency),'validFrom',p_valid_from));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'unit',p_unit,'unit.price_recorded.v1',jsonb_build_object('priceId',price_id,'unitId',p_unit,'priceType',p_price_type,'amount',p_amount,'validFrom',p_valid_from));
  RETURN price_id;
END $$;

CREATE OR REPLACE FUNCTION app.create_contract(
  p_tenant uuid,p_case uuid,p_type text,p_reference text,p_title text,p_actor_membership uuid,p_parent_contract uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE project uuid; unit uuid; actor uuid; contract_id uuid:=gen_random_uuid();
BEGIN
  SELECT project_id,unit_id INTO project,unit FROM sales_cases WHERE tenant_id=p_tenant AND id=p_case AND status='active' FOR UPDATE;
  SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF project IS NULL OR actor IS NULL OR NOT app.has_project_permission(p_tenant,p_actor_membership,project,'contract.manage') THEN RAISE EXCEPTION 'contract.manage permission required'; END IF;
  IF p_type='amendment' AND (p_parent_contract IS NULL OR NOT EXISTS(SELECT 1 FROM contracts WHERE tenant_id=p_tenant AND project_id=project AND id=p_parent_contract AND unit_id=unit)) THEN RAISE EXCEPTION 'amendment requires parent contract in the same sales case'; END IF;
  IF p_type<>'amendment' AND p_parent_contract IS NOT NULL THEN RAISE EXCEPTION 'only amendment may have a parent contract'; END IF;
  INSERT INTO contracts(id,tenant_id,project_id,unit_id,sales_case_id,contract_type,parent_contract_id,reference,title,created_by_membership_id)
  VALUES(contract_id,p_tenant,project,unit,p_case,p_type,p_parent_contract,p_reference,p_title,p_actor_membership);
  INSERT INTO contract_status_events(tenant_id,project_id,contract_id,from_status,to_status,command,reason,recorded_by_membership_id)
  VALUES(p_tenant,project,contract_id,NULL,'draft','createContract','Smlouva vytvořena',p_actor_membership);
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data)
  VALUES(p_tenant,actor,'contract.created','contract',contract_id,jsonb_build_object('type',p_type,'unitId',unit,'salesCaseId',p_case));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'contract',contract_id,'contract.created.v1',jsonb_build_object('contractId',contract_id,'type',p_type,'unitId',unit));
  RETURN contract_id;
END $$;

CREATE OR REPLACE FUNCTION app.create_contract_version(
  p_tenant uuid,p_contract uuid,p_display_name text,p_source_type text,p_actor_membership uuid,
  p_based_on uuid DEFAULT NULL,p_generation_payload jsonb DEFAULT '{}'::jsonb
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE project uuid; actor uuid; current_state text; version_id uuid:=gen_random_uuid(); next_number integer;
BEGIN
  SELECT project_id,current_status INTO project,current_state FROM contracts WHERE tenant_id=p_tenant AND id=p_contract FOR UPDATE;
  SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF project IS NULL OR actor IS NULL OR current_state IN ('signed','cancelled','terminated') OR NOT app.has_project_permission(p_tenant,p_actor_membership,project,'contract.manage') THEN RAISE EXCEPTION 'contract is not versionable or permission is missing'; END IF;
  IF p_based_on IS NOT NULL AND NOT EXISTS(SELECT 1 FROM contract_versions WHERE tenant_id=p_tenant AND contract_id=p_contract AND id=p_based_on) THEN RAISE EXCEPTION 'based-on version must belong to the contract'; END IF;
  SELECT COALESCE(max(version_number),0)+1 INTO next_number FROM contract_versions WHERE tenant_id=p_tenant AND contract_id=p_contract;
  UPDATE contract_versions SET version_status='superseded' WHERE tenant_id=p_tenant AND contract_id=p_contract AND version_status IN ('working','approved_for_signing');
  INSERT INTO contract_versions(id,tenant_id,project_id,contract_id,version_number,based_on_version_id,source_type,display_name,generation_payload,created_by_membership_id)
  VALUES(version_id,p_tenant,project,p_contract,next_number,p_based_on,p_source_type,p_display_name,COALESCE(p_generation_payload,'{}'::jsonb),p_actor_membership);
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data)
  VALUES(p_tenant,actor,'contract.version_created','contract_version',version_id,jsonb_build_object('contractId',p_contract,'versionNumber',next_number,'basedOnVersionId',p_based_on));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'contract',p_contract,'contract.version_created.v1',jsonb_build_object('contractId',p_contract,'versionId',version_id,'versionNumber',next_number));
  RETURN version_id;
END $$;

CREATE OR REPLACE FUNCTION app.transition_contract_status(
  p_tenant uuid,p_contract uuid,p_to text,p_reason text,p_actor_membership uuid
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE old_state text; project uuid; actor uuid; event_id uuid:=gen_random_uuid(); allowed boolean:=false; required_permission text:='contract.manage'; latest_version uuid;
BEGIN
  SELECT current_status,project_id INTO old_state,project FROM contracts WHERE tenant_id=p_tenant AND id=p_contract FOR UPDATE;
  SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF old_state IS NULL OR actor IS NULL THEN RAISE EXCEPTION 'contract or actor not found'; END IF;
  IF p_to='signed' THEN RAISE EXCEPTION 'signed status is reached only by completing required signatures'; END IF;
  allowed:=CASE old_state
    WHEN 'draft' THEN p_to IN ('sent','cancelled')
    WHEN 'sent' THEN p_to IN ('negotiation','approved','cancelled')
    WHEN 'negotiation' THEN p_to IN ('sent','approved','cancelled')
    WHEN 'approved' THEN p_to IN ('signing','negotiation','cancelled')
    WHEN 'signing' THEN p_to IN ('negotiation','cancelled')
    WHEN 'signed' THEN p_to='terminated'
    ELSE false END;
  IF NOT allowed THEN RAISE EXCEPTION 'contract workflow transition is not allowed'; END IF;
  IF p_to IN ('approved','signing') THEN required_permission:=CASE p_to WHEN 'approved' THEN 'contract.approve' ELSE 'contract.sign' END; END IF;
  IF NOT app.has_project_permission(p_tenant,p_actor_membership,project,required_permission) THEN RAISE EXCEPTION '% permission required',required_permission; END IF;
  SELECT id INTO latest_version FROM contract_versions WHERE tenant_id=p_tenant AND contract_id=p_contract ORDER BY version_number DESC LIMIT 1;
  IF p_to IN ('approved','signing') AND latest_version IS NULL THEN RAISE EXCEPTION 'contract requires a logical version'; END IF;
  IF p_to='approved' THEN UPDATE contract_versions SET version_status='approved_for_signing',approved_at=now() WHERE tenant_id=p_tenant AND id=latest_version AND version_status='working'; END IF;
  IF p_to='signing' AND NOT EXISTS(SELECT 1 FROM contract_versions WHERE tenant_id=p_tenant AND id=latest_version AND version_status='approved_for_signing') THEN RAISE EXCEPTION 'latest version must be approved for signing'; END IF;
  PERFORM set_config('app.contract_status_command','on',true);
  UPDATE contracts SET current_status=p_to,ended_at=CASE WHEN p_to='cancelled' OR p_to='terminated' THEN now() ELSE NULL END,end_reason=CASE WHEN p_to='cancelled' OR p_to='terminated' THEN p_reason ELSE NULL END WHERE tenant_id=p_tenant AND id=p_contract;
  INSERT INTO contract_status_events(id,tenant_id,project_id,contract_id,from_status,to_status,command,reason,recorded_by_membership_id)
  VALUES(event_id,p_tenant,project,p_contract,old_state,p_to,CASE p_to WHEN 'terminated' THEN 'terminateContract' WHEN 'cancelled' THEN 'cancelContract' ELSE 'transitionContract' END,p_reason,p_actor_membership);
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data)
  VALUES(p_tenant,actor,'contract.status_changed','contract',p_contract,jsonb_build_object('status',old_state),jsonb_build_object('status',p_to,'reason',p_reason));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'contract',p_contract,'contract.status_changed.v1',jsonb_build_object('contractId',p_contract,'from',old_state,'to',p_to));
  RETURN event_id;
END $$;

CREATE OR REPLACE FUNCTION app.transition_unit_commercial_status(
  p_tenant_id uuid,p_unit_id uuid,p_to_status text,p_command text,p_reason text,p_actor_membership_id uuid
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE old_unit_status text; project uuid; actor uuid; event_id uuid:=gen_random_uuid(); allowed boolean:=false;
BEGIN
  SELECT commercial_status,project_id INTO old_unit_status,project FROM units WHERE tenant_id=p_tenant_id AND id=p_unit_id FOR UPDATE;
  SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant_id AND id=p_actor_membership_id AND status='active';
  IF old_unit_status IS NULL OR actor IS NULL THEN RAISE EXCEPTION 'unit or active actor membership not found'; END IF;
  allowed:=CASE p_command
    WHEN 'createPreReservation' THEN old_unit_status='available' AND p_to_status='pre_reserved' AND EXISTS(SELECT 1 FROM unit_holds WHERE tenant_id=p_tenant_id AND unit_id=p_unit_id AND status='active' AND hold_type='pre_reservation' AND starts_at<=now() AND expires_at>now())
    WHEN 'createReservation' THEN old_unit_status='available' AND p_to_status='reserved' AND EXISTS(SELECT 1 FROM unit_holds WHERE tenant_id=p_tenant_id AND unit_id=p_unit_id AND status='active' AND hold_type='reservation' AND starts_at<=now() AND expires_at>now())
    WHEN 'confirmReservation' THEN old_unit_status='pre_reserved' AND p_to_status='reserved' AND EXISTS(SELECT 1 FROM unit_holds WHERE tenant_id=p_tenant_id AND unit_id=p_unit_id AND status='active' AND hold_type='reservation' AND starts_at<=now() AND expires_at>now())
    WHEN 'expireHold' THEN old_unit_status IN ('pre_reserved','reserved') AND p_to_status='available' AND NOT EXISTS(SELECT 1 FROM unit_holds WHERE tenant_id=p_tenant_id AND unit_id=p_unit_id AND status='active' AND starts_at<=now() AND expires_at>now())
    WHEN 'cancelPreReservation' THEN old_unit_status='pre_reserved' AND p_to_status='available' AND NOT EXISTS(SELECT 1 FROM unit_holds WHERE tenant_id=p_tenant_id AND unit_id=p_unit_id AND status='active' AND starts_at<=now() AND expires_at>now())
    WHEN 'cancelReservation' THEN old_unit_status='reserved' AND p_to_status='available' AND NOT EXISTS(SELECT 1 FROM unit_holds WHERE tenant_id=p_tenant_id AND unit_id=p_unit_id AND status='active' AND starts_at<=now() AND expires_at>now())
    WHEN 'activateFuturePurchaseContract' THEN old_unit_status='reserved' AND p_to_status='contracted' AND EXISTS(SELECT 1 FROM contracts contract WHERE contract.tenant_id=p_tenant_id AND contract.unit_id=p_unit_id AND contract.contract_type='sbk' AND contract.current_status='signed')
    WHEN 'confirmFinalContractEffective' THEN old_unit_status='contracted' AND p_to_status='sold' AND EXISTS(SELECT 1 FROM contracts contract WHERE contract.tenant_id=p_tenant_id AND contract.unit_id=p_unit_id AND contract.contract_type='ks' AND contract.current_status='signed')
    WHEN 'blockUnit' THEN old_unit_status IN ('available','pre_reserved','reserved') AND p_to_status='blocked' AND NOT EXISTS(SELECT 1 FROM unit_holds WHERE tenant_id=p_tenant_id AND unit_id=p_unit_id AND status='active' AND starts_at<=now() AND expires_at>now())
    WHEN 'unblockUnit' THEN old_unit_status='blocked' AND p_to_status='available'
    ELSE false END;
  IF NOT allowed THEN RAISE EXCEPTION 'commercial status command % violates source invariants',p_command; END IF;
  PERFORM set_config('app.commercial_status_command','on',true);
  UPDATE units SET commercial_status=p_to_status WHERE tenant_id=p_tenant_id AND id=p_unit_id;
  INSERT INTO unit_commercial_status_events(id,tenant_id,project_id,unit_id,from_status,to_status,command,reason,recorded_by_membership_id)
  VALUES(event_id,p_tenant_id,project,p_unit_id,old_unit_status,p_to_status,p_command,p_reason,p_actor_membership_id);
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data)
  VALUES(p_tenant_id,actor,'unit.commercial_status_changed','unit',p_unit_id,jsonb_build_object('commercialStatus',old_unit_status),jsonb_build_object('commercialStatus',p_to_status,'command',p_command));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant_id,'unit',p_unit_id,'unit.commercial_status_changed.v1',jsonb_build_object('unitId',p_unit_id,'from',old_unit_status,'to',p_to_status,'command',p_command));
  RETURN event_id;
END $$;

CREATE OR REPLACE FUNCTION app.record_contract_party_signature(
  p_tenant uuid,p_contract_party uuid,p_version uuid,p_actor_membership uuid,p_reason text
) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE participant contract_parties%ROWTYPE; contract_row contracts%ROWTYPE; actor uuid; remaining integer; stage_target text; status_target text; status_command text;
BEGIN
  SELECT * INTO participant FROM contract_parties WHERE tenant_id=p_tenant AND id=p_contract_party FOR UPDATE;
  SELECT * INTO contract_row FROM contracts WHERE tenant_id=p_tenant AND id=participant.contract_id FOR UPDATE;
  SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF participant.id IS NULL OR contract_row.current_status<>'signing' OR actor IS NULL OR NOT app.has_project_permission(p_tenant,p_actor_membership,contract_row.project_id,'contract.sign') THEN RAISE EXCEPTION 'contract.sign permission and signing workflow are required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM contract_versions WHERE tenant_id=p_tenant AND contract_id=contract_row.id AND id=p_version AND version_status='approved_for_signing') THEN RAISE EXCEPTION 'approved contract version is required'; END IF;
  UPDATE contract_parties SET signature_status='signed',signed_at=now(),signed_version_id=p_version WHERE tenant_id=p_tenant AND id=p_contract_party AND signature_status<>'signed';
  SELECT count(*) INTO remaining FROM contract_parties WHERE tenant_id=p_tenant AND contract_id=contract_row.id AND signing_required AND signature_status<>'signed';
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data)
  VALUES(p_tenant,actor,'contract.party_signed','contract_party',p_contract_party,jsonb_build_object('contractId',contract_row.id,'versionId',p_version));
  IF remaining>0 THEN RETURN false; END IF;
  UPDATE contract_versions SET version_status='signed',signed_at=now(),locked_at=now() WHERE tenant_id=p_tenant AND id=p_version;
  PERFORM set_config('app.contract_status_command','on',true);
  UPDATE contracts SET current_status='signed',signed_at=now() WHERE tenant_id=p_tenant AND id=contract_row.id;
  INSERT INTO contract_status_events(tenant_id,project_id,contract_id,from_status,to_status,command,reason,recorded_by_membership_id)
  VALUES(p_tenant,contract_row.project_id,contract_row.id,'signing','signed','completeSignatures',p_reason,p_actor_membership);
  IF contract_row.contract_type IN ('rs','sbk','ks') THEN
    stage_target:=contract_row.contract_type;
    PERFORM app.record_sales_stage(p_tenant,contract_row.sales_case_id,stage_target,'contractSigned',p_reason,p_actor_membership);
  END IF;
  IF contract_row.contract_type='sbk' THEN status_target:='contracted';status_command:='activateFuturePurchaseContract'; END IF;
  IF contract_row.contract_type='ks' THEN status_target:='sold';status_command:='confirmFinalContractEffective'; END IF;
  IF status_target IS NOT NULL THEN PERFORM app.transition_unit_commercial_status(p_tenant,contract_row.unit_id,status_target,status_command,p_reason,p_actor_membership); END IF;
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data)
  VALUES(p_tenant,actor,'contract.signed','contract',contract_row.id,jsonb_build_object('versionId',p_version,'type',contract_row.contract_type));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'contract',contract_row.id,'contract.signed.v1',jsonb_build_object('contractId',contract_row.id,'versionId',p_version,'type',contract_row.contract_type,'unitId',contract_row.unit_id));
  RETURN true;
END $$;

INSERT INTO permissions(code,description) VALUES
 ('price.read','Zobrazit ceny jednotek'),('price.manage','Zapisovat nové cenové události'),('price.approve','Schvalovat slevy a smluvní ceny'),
 ('contract.read','Zobrazit smlouvy a verze'),('contract.manage','Spravovat smlouvy a pracovní verze'),('contract.approve','Schvalovat verze k podpisu'),('contract.sign','Evidovat podpisy smluv')
ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(tenant_id,role_id,permission_id)
SELECT role.tenant_id,role.id,permission.id FROM roles role CROSS JOIN permissions permission WHERE role.code='admin' ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(tenant_id,role_id,permission_id)
SELECT role.tenant_id,role.id,permission.id FROM roles role JOIN permissions permission ON permission.code IN ('price.read','price.manage','price.approve','contract.read','contract.manage','contract.approve','contract.sign')
WHERE role.code IN ('project_manager','back_office') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(tenant_id,role_id,permission_id)
SELECT role.tenant_id,role.id,permission.id FROM roles role JOIN permissions permission ON permission.code IN ('price.read','price.manage','contract.read','contract.manage','contract.sign')
WHERE role.code='sales' ON CONFLICT DO NOTHING;

DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['unit_price_history','contracts','contract_parties','contract_versions','contract_status_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('CREATE POLICY %I ON %I USING (tenant_id=app.current_tenant_id()) WITH CHECK (tenant_id=app.current_tenant_id())',table_name||'_tenant_policy',table_name);
  END LOOP;
END $$;

GRANT SELECT,INSERT ON unit_price_history,contract_status_events TO develocrm_app;
GRANT SELECT,INSERT,UPDATE ON contracts,contract_parties,contract_versions TO develocrm_app;
GRANT SELECT ON unit_price_intervals TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.current_unit_price(uuid,uuid,timestamptz) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.record_unit_price(uuid,uuid,text,numeric,text,timestamptz,text,uuid,uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.create_contract(uuid,uuid,text,text,text,uuid,uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.create_contract_version(uuid,uuid,text,text,uuid,uuid,jsonb) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.transition_contract_status(uuid,uuid,text,text,uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.record_contract_party_signature(uuid,uuid,uuid,uuid,text) TO develocrm_app;

COMMIT;

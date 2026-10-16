BEGIN;
-- A plain unsigned draft is not a sales commitment. Other lifecycle states
-- remain conservative until a separate business rule explicitly covers them.
CREATE FUNCTION app.contract_blocks_unit_release(p_tenant uuid,p_contract uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT EXISTS(SELECT 1 FROM contracts c WHERE c.tenant_id=p_tenant AND c.id=p_contract
    AND (c.current_status NOT IN ('cancelled','terminated') OR c.ended_at IS NULL OR c.ended_at>now())
    AND NOT (c.current_status='draft' AND c.signed_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM contract_versions v WHERE v.tenant_id=c.tenant_id AND v.contract_id=c.id AND (v.signed_at IS NOT NULL OR v.version_status='signed'))
      AND NOT EXISTS(SELECT 1 FROM contract_parties p WHERE p.tenant_id=c.tenant_id AND p.contract_id=c.id AND p.signature_status='signed')))
$$;
GRANT EXECUTE ON FUNCTION app.contract_blocks_unit_release(uuid,uuid) TO develocrm_app;
CREATE OR REPLACE FUNCTION app.contract_end_release_assessment(p_tenant uuid,p_contract uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE c contracts%ROWTYPE;s sales_cases%ROWTYPE;u units%ROWTYPE;reasons jsonb:='[]';
BEGIN
  SELECT * INTO c FROM contracts WHERE tenant_id=p_tenant AND id=p_contract;
  IF c.id IS NULL THEN RETURN NULL;END IF;
  IF c.contract_type NOT IN ('rs','sbk','ks') OR c.current_status NOT IN ('cancelled','terminated') THEN RETURN NULL;END IF;
  SELECT * INTO s FROM sales_cases WHERE tenant_id=p_tenant AND id=c.sales_case_id;
  SELECT * INTO u FROM units WHERE tenant_id=p_tenant AND id=c.unit_id;
  IF s.id IS NULL OR u.id IS NULL OR s.project_id<>c.project_id OR s.unit_id<>c.unit_id THEN
    reasons:=reasons||jsonb_build_array(jsonb_build_object('code','INVALID_CONTEXT','message','Obchodní vazby nejsou úplné. Kontaktujte administrátora.'));
  END IF;
  IF s.status IS DISTINCT FROM 'active' THEN
    reasons:=reasons||jsonb_build_array(jsonb_build_object('code','HISTORICAL_CASE','message','Obchod již není aktivní. Historické případy je nutné vypořádat samostatně s administrátorem.'));
  END IF;
  IF c.ended_at IS NULL OR c.ended_at>now() THEN
    reasons:=reasons||jsonb_build_array(jsonb_build_object('code','NOT_EFFECTIVE','message','Ukončení smlouvy dosud nenabylo účinnosti. Vyčkejte na účinné ukončení.'));
  END IF;
  IF EXISTS(SELECT 1 FROM contracts other WHERE other.tenant_id=p_tenant AND other.unit_id=c.unit_id AND other.id<>c.id
    AND app.contract_blocks_unit_release(p_tenant,other.id)) THEN
    reasons:=reasons||jsonb_build_array(jsonb_build_object('code','OTHER_CONTRACT','message','Jednotka má další smluvní závazek nebo smlouvu v probíhajícím schvalování. Nejprve vyřešte její další trvání.'));
  END IF;
  -- Native model has no cadastral/ownership clearance evidence. Never infer it from cancellation.
  IF u.commercial_status IN ('sold','handed_over') OR EXISTS(
    SELECT 1 FROM contracts k WHERE k.tenant_id=p_tenant AND k.unit_id=c.unit_id AND k.contract_type='ks'
    AND (k.signed_at IS NOT NULL OR EXISTS(SELECT 1 FROM contract_versions v WHERE v.tenant_id=k.tenant_id AND v.contract_id=k.id AND v.signed_at IS NOT NULL))) THEN
    reasons:=reasons||jsonb_build_array(jsonb_build_object('code','OWNERSHIP_UNVERIFIED','message','Nelze ověřit možnost dalšího prodeje po kupní smlouvě nebo převodu vlastnictví. Administrátor musí nejprve doložit právní stav; automatické uvolnění není dostupné.'));
  END IF;
  IF u.commercial_status='blocked' THEN
    reasons:=reasons||jsonb_build_array(jsonb_build_object('code','UNIT_BLOCKED','message','Jednotka je samostatně blokovaná. Nejprve prověřte a vyřešte důvod blokace.'));
  END IF;
  IF EXISTS(SELECT 1 FROM unit_handovers h WHERE h.tenant_id=p_tenant AND h.unit_id=c.unit_id AND h.status<>'cancelled') THEN
    reasons:=reasons||jsonb_build_array(jsonb_build_object('code','HANDOVER_EXISTS','message','Jednotka má naplánované nebo dokončené předání. Nejprve prověřte předání a právní stav.'));
  END IF;
  IF EXISTS(SELECT 1 FROM sales_cases other WHERE other.tenant_id=p_tenant AND other.unit_id=c.unit_id AND other.id<>c.sales_case_id AND other.status='active') THEN
    reasons:=reasons||jsonb_build_array(jsonb_build_object('code','OTHER_CASE','message','Jednotka má jiný aktivní obchod. Nejprve prověřte souběžné obchodní případy.'));
  END IF;
  IF EXISTS(SELECT 1 FROM unit_holds h WHERE h.tenant_id=p_tenant AND h.unit_id=c.unit_id AND h.status='active'
    AND NOT (h.sales_case_id=c.sales_case_id AND h.hold_type='reservation' AND EXISTS(
      SELECT 1 FROM contracts r WHERE r.tenant_id=p_tenant AND r.sales_case_id=c.sales_case_id AND r.contract_type='rs'
      AND r.current_status IN ('cancelled','terminated') AND r.ended_at<=now() AND h.idempotency_key='signed-rs-reservation:'||r.id
      AND EXISTS(SELECT 1 FROM audit_log proof WHERE proof.tenant_id=h.tenant_id AND proof.entity_id=h.id
        AND proof.action IN ('hold.created_by_rs_signature','hold.converted_by_rs_signature')
        AND proof.after_data->>'contractId'=r.id::text)))) THEN
    reasons:=reasons||jsonb_build_array(jsonb_build_object('code','OTHER_HOLD','message','Jednotku chrání další blokace nebo předrezervace. Nejprve ověřte její oprávněnost a případně ji samostatně ukončete.'));
  END IF;
  IF NOT EXISTS(SELECT 1 FROM contracts b JOIN contract_versions v ON v.tenant_id=b.tenant_id AND v.contract_id=b.id
    WHERE b.tenant_id=p_tenant AND b.sales_case_id=c.sales_case_id AND b.contract_type IN ('rs','sbk','ks') AND v.signed_at IS NOT NULL) THEN
    reasons:=reasons||jsonb_build_array(jsonb_build_object('code','NO_SIGNED_COMMITMENT','message','Zrušení rozpracované smlouvy neukončuje obchod. Pokračujte u jednotky v aktivním jednání.'));
  END IF;
  RETURN jsonb_build_object('state',CASE WHEN jsonb_array_length(reasons)>0 THEN 'blocked' ELSE 'eligible' END,'reasons',reasons,'salesCaseId',c.sales_case_id,'unitId',c.unit_id);
END $$;
CREATE OR REPLACE FUNCTION app.transition_unit_commercial_status(
  p_tenant_id uuid,p_unit_id uuid,p_to_status text,p_command text,p_reason text,p_actor_membership_id uuid
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE old_unit_status text;project uuid;actor uuid;event_id uuid:=gen_random_uuid();allowed boolean:=false;
BEGIN
  SELECT commercial_status,project_id INTO old_unit_status,project FROM units WHERE tenant_id=p_tenant_id AND id=p_unit_id FOR UPDATE;
  SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant_id AND id=p_actor_membership_id AND status='active';
  IF old_unit_status IS NULL OR actor IS NULL THEN RAISE EXCEPTION 'unit or active actor membership not found';END IF;
  allowed:=CASE p_command
    WHEN 'createPreReservation' THEN old_unit_status='available' AND p_to_status='pre_reserved' AND EXISTS(SELECT 1 FROM unit_holds WHERE tenant_id=p_tenant_id AND unit_id=p_unit_id AND status='active' AND hold_type='pre_reservation' AND starts_at<=now() AND expires_at>now())
    WHEN 'createReservation' THEN old_unit_status='available' AND p_to_status='reserved' AND EXISTS(SELECT 1 FROM unit_holds WHERE tenant_id=p_tenant_id AND unit_id=p_unit_id AND status='active' AND hold_type='reservation' AND starts_at<=now() AND expires_at>now())
    WHEN 'confirmReservation' THEN old_unit_status='pre_reserved' AND p_to_status='reserved' AND EXISTS(SELECT 1 FROM unit_holds WHERE tenant_id=p_tenant_id AND unit_id=p_unit_id AND status='active' AND hold_type='reservation' AND starts_at<=now() AND expires_at>now())
    WHEN 'expireHold' THEN old_unit_status IN ('pre_reserved','reserved') AND p_to_status='available' AND NOT EXISTS(SELECT 1 FROM unit_holds WHERE tenant_id=p_tenant_id AND unit_id=p_unit_id AND status='active' AND starts_at<=now() AND expires_at>now())
    WHEN 'cancelPreReservation' THEN old_unit_status='pre_reserved' AND p_to_status='available' AND NOT EXISTS(SELECT 1 FROM unit_holds WHERE tenant_id=p_tenant_id AND unit_id=p_unit_id AND status='active' AND starts_at<=now() AND expires_at>now())
    WHEN 'cancelReservation' THEN old_unit_status='reserved' AND p_to_status='available' AND NOT EXISTS(SELECT 1 FROM unit_holds WHERE tenant_id=p_tenant_id AND unit_id=p_unit_id AND status='active' AND starts_at<=now() AND expires_at>now())
    WHEN 'activateFuturePurchaseContract' THEN old_unit_status IN ('available','pre_reserved','reserved') AND p_to_status='contracted' AND EXISTS(SELECT 1 FROM contracts contract WHERE contract.tenant_id=p_tenant_id AND contract.unit_id=p_unit_id AND contract.contract_type='sbk' AND contract.current_status='signed')
    WHEN 'confirmFinalContractEffective' THEN old_unit_status IN ('available','pre_reserved','reserved','contracted') AND p_to_status='sold' AND EXISTS(SELECT 1 FROM contracts contract WHERE contract.tenant_id=p_tenant_id AND contract.unit_id=p_unit_id AND contract.contract_type='ks' AND contract.current_status='signed')
    WHEN 'blockUnit' THEN old_unit_status IN ('available','pre_reserved','reserved') AND p_to_status='blocked' AND NOT EXISTS(SELECT 1 FROM unit_holds WHERE tenant_id=p_tenant_id AND unit_id=p_unit_id AND status='active' AND starts_at<=now() AND expires_at>now())
    WHEN 'unblockUnit' THEN old_unit_status='blocked' AND p_to_status='available'
    WHEN 'compensateContract' THEN old_unit_status IN ('pre_reserved','reserved','contracted') AND p_to_status='available'
      AND app.has_project_permission(p_tenant_id,p_actor_membership_id,project,'contract.manage')
      AND NOT app.has_effective_signed_contract(p_tenant_id,p_unit_id)
      AND NOT EXISTS(SELECT 1 FROM contracts WHERE tenant_id=p_tenant_id AND unit_id=p_unit_id AND app.contract_blocks_unit_release(p_tenant_id,contracts.id))
      AND NOT EXISTS(SELECT 1 FROM sales_cases WHERE tenant_id=p_tenant_id AND unit_id=p_unit_id AND status='active')
      AND NOT EXISTS(SELECT 1 FROM unit_holds WHERE tenant_id=p_tenant_id AND unit_id=p_unit_id AND status='active')
      AND EXISTS(SELECT 1 FROM sales_cases WHERE tenant_id=p_tenant_id AND unit_id=p_unit_id AND status='cancelled' AND closed_at IS NOT NULL)
      AND NOT EXISTS(SELECT 1 FROM contracts k WHERE k.tenant_id=p_tenant_id AND k.unit_id=p_unit_id AND k.contract_type='ks' AND (k.signed_at IS NOT NULL OR EXISTS(SELECT 1 FROM contract_versions v WHERE v.tenant_id=k.tenant_id AND v.contract_id=k.id AND v.signed_at IS NOT NULL)))
    ELSE false END;
  IF NOT allowed THEN RAISE EXCEPTION 'commercial status command % violates source invariants',p_command;END IF;
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


-- Keep unfinished documents, but never sign or advance a closed historical sale.
CREATE FUNCTION app.guard_contract_active_case() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c contracts%ROWTYPE; needs_active boolean:=false; case_id uuid;
BEGIN
  IF TG_TABLE_NAME='contracts' THEN
    needs_active:=NEW.current_status NOT IN ('draft','cancelled','terminated')
      AND (TG_OP='INSERT' OR NEW.current_status IS DISTINCT FROM OLD.current_status);
    c:=NEW;
  ELSIF TG_TABLE_NAME='contract_versions' THEN
    needs_active:=(NEW.version_status='signed' OR NEW.signed_at IS NOT NULL)
      AND (TG_OP='INSERT' OR NEW.version_status IS DISTINCT FROM OLD.version_status OR NEW.signed_at IS DISTINCT FROM OLD.signed_at);
    SELECT * INTO c FROM contracts WHERE tenant_id=NEW.tenant_id AND id=NEW.contract_id;
  ELSE
    needs_active:=NEW.signature_status='signed'
      AND (TG_OP='INSERT' OR NEW.signature_status IS DISTINCT FROM OLD.signature_status OR NEW.signed_version_id IS DISTINCT FROM OLD.signed_version_id);
    SELECT * INTO c FROM contracts WHERE tenant_id=NEW.tenant_id AND id=NEW.contract_id;
  END IF;
  IF needs_active THEN
    PERFORM app.lock_workflow_unit(c.tenant_id,c.unit_id);
    SELECT id INTO case_id FROM sales_cases WHERE tenant_id=c.tenant_id AND id=c.sales_case_id
      AND project_id=c.project_id AND unit_id=c.unit_id AND status='active' AND closed_at IS NULL FOR UPDATE;
    IF case_id IS NULL THEN RAISE EXCEPTION 'CONTRACT_CASE_CLOSED';END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER contract_active_case BEFORE INSERT OR UPDATE ON contracts FOR EACH ROW EXECUTE FUNCTION app.guard_contract_active_case();
CREATE TRIGGER contract_version_active_case BEFORE INSERT OR UPDATE ON contract_versions FOR EACH ROW EXECUTE FUNCTION app.guard_contract_active_case();
CREATE TRIGGER contract_party_active_case BEFORE INSERT OR UPDATE ON contract_parties FOR EACH ROW EXECUTE FUNCTION app.guard_contract_active_case();
COMMIT;


BEGIN;
-- A client-supplied idempotency key is not evidence of a system reservation.
-- Require the append-only signature audit as well; no historical backfill.
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
    AND other.current_status NOT IN ('cancelled','terminated')) THEN
    reasons:=reasons||jsonb_build_array(jsonb_build_object('code','OTHER_CONTRACT','message','Jednotka má další platnou nebo rozpracovanou smlouvu. Nejprve vyřešte její další trvání.'));
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
COMMIT;

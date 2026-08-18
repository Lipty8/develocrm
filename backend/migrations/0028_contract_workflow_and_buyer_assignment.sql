BEGIN;

-- Signing is a domain command performed directly from an approved version. The
-- legacy `signing` value remains accepted by old rows/events, but is no longer
-- produced by current commands.
DO $$
DECLARE item record; target_status text; target_signed_at timestamptz;
BEGIN
  FOR item IN
    SELECT contract.tenant_id,contract.id,contract.project_id,contract.created_by_membership_id,
      latest.version_status,latest.signed_at
    FROM contracts contract
    LEFT JOIN LATERAL (
      SELECT version_status,signed_at FROM contract_versions version
      WHERE version.tenant_id=contract.tenant_id AND version.contract_id=contract.id
      ORDER BY version.version_number DESC,version.id DESC LIMIT 1
    ) latest ON true
    WHERE contract.current_status='signing'
  LOOP
    target_status:=CASE WHEN item.version_status='signed' THEN 'signed' ELSE 'approved' END;
    target_signed_at:=CASE WHEN target_status='signed' THEN COALESCE(item.signed_at,now()) ELSE NULL END;
    PERFORM set_config('app.contract_status_command','on',true);
    UPDATE contracts SET current_status=target_status,signed_at=target_signed_at
    WHERE tenant_id=item.tenant_id AND id=item.id;
    INSERT INTO contract_status_events(
      tenant_id,project_id,contract_id,from_status,to_status,command,reason,
      recorded_by_membership_id,source
    ) VALUES(
      item.tenant_id,item.project_id,item.id,'signing',target_status,'migrateLegacySigning',
      'Odstranění historického mezistavu K podpisu',item.created_by_membership_id,'automation'
    );
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION app.synchronize_signed_contract(
  p_tenant uuid,p_contract uuid,p_actor_membership uuid,p_reason text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE contract_row contracts%ROWTYPE;unit_status text;reason_text text:=COALESCE(NULLIF(btrim(p_reason),''),'Podepsaná smlouva');
BEGIN
  SELECT * INTO contract_row FROM contracts WHERE tenant_id=p_tenant AND id=p_contract FOR UPDATE;
  IF contract_row.id IS NULL OR contract_row.current_status<>'signed' THEN RAISE EXCEPTION 'signed contract is required';END IF;
  IF contract_row.contract_type='rs' THEN
    PERFORM app.ensure_signed_rs_reservation(p_tenant,p_contract,p_actor_membership,reason_text);
    RETURN;
  END IF;
  IF contract_row.contract_type NOT IN ('sbk','ks') THEN RETURN;END IF;
  PERFORM app.record_sales_stage(p_tenant,contract_row.sales_case_id,contract_row.contract_type,'contractSigned',reason_text,p_actor_membership);
  SELECT commercial_status INTO unit_status FROM units WHERE tenant_id=p_tenant AND id=contract_row.unit_id FOR UPDATE;
  IF contract_row.contract_type='sbk' AND unit_status='reserved' THEN
    PERFORM app.transition_unit_commercial_status(p_tenant,contract_row.unit_id,'contracted','activateFuturePurchaseContract',reason_text,p_actor_membership);
  ELSIF contract_row.contract_type='ks' THEN
    IF unit_status='reserved' AND EXISTS(
      SELECT 1 FROM contracts prior WHERE prior.tenant_id=p_tenant AND prior.sales_case_id=contract_row.sales_case_id
        AND prior.contract_type='sbk' AND prior.current_status='signed'
    ) THEN
      PERFORM app.transition_unit_commercial_status(p_tenant,contract_row.unit_id,'contracted','activateFuturePurchaseContract',reason_text,p_actor_membership);
      unit_status:='contracted';
    END IF;
    IF unit_status='contracted' THEN
      PERFORM app.transition_unit_commercial_status(p_tenant,contract_row.unit_id,'sold','confirmFinalContractEffective',reason_text,p_actor_membership);
    ELSIF unit_status<>'sold' THEN
      RAISE EXCEPTION 'signed KS requires a reserved unit with signed SBK or a contracted unit';
    END IF;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION app.rollback_ended_rs(
  p_tenant uuid,p_contract uuid,p_actor_membership uuid,p_reason text
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE contract_row contracts%ROWTYPE;unit_status text;active_hold uuid;actor uuid;
BEGIN
  SELECT * INTO contract_row FROM contracts WHERE tenant_id=p_tenant AND id=p_contract FOR UPDATE;
  IF contract_row.id IS NULL OR contract_row.contract_type<>'rs' OR contract_row.current_status NOT IN ('cancelled','terminated') THEN RETURN;END IF;
  IF EXISTS(
    SELECT 1 FROM contracts later WHERE later.tenant_id=p_tenant AND later.sales_case_id=contract_row.sales_case_id
      AND later.contract_type IN ('sbk','ks') AND later.current_status='signed'
  ) THEN RETURN;END IF;
  SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  SELECT id INTO active_hold FROM unit_holds
  WHERE tenant_id=p_tenant AND sales_case_id=contract_row.sales_case_id AND hold_type='reservation' AND status='active'
  ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF active_hold IS NOT NULL THEN
    UPDATE unit_holds SET status='cancelled',ended_at=now() WHERE tenant_id=p_tenant AND id=active_hold;
    INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
    VALUES(p_tenant,'hold',active_hold,'hold.cancelled_by_rs_end.v1',jsonb_build_object('holdId',active_hold,'contractId',p_contract,'unitId',contract_row.unit_id));
  END IF;
  SELECT commercial_status INTO unit_status FROM units WHERE tenant_id=p_tenant AND id=contract_row.unit_id FOR UPDATE;
  IF unit_status='reserved' AND NOT EXISTS(
    SELECT 1 FROM unit_holds hold WHERE hold.tenant_id=p_tenant AND hold.unit_id=contract_row.unit_id
      AND hold.status='active' AND hold.starts_at<=now() AND hold.expires_at>now()
  ) THEN
    PERFORM app.record_sales_stage(p_tenant,contract_row.sales_case_id,'interest','endSignedReservation',p_reason,p_actor_membership);
    PERFORM app.transition_unit_commercial_status(p_tenant,contract_row.unit_id,'available','cancelReservation',p_reason,p_actor_membership);
  END IF;
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data,metadata)
  VALUES(p_tenant,actor,'rs.commercial_process_released','contract',p_contract,
    jsonb_build_object('salesCaseId',contract_row.sales_case_id,'unitId',contract_row.unit_id,'holdId',active_hold),
    jsonb_build_object('projectId',contract_row.project_id,'reason',p_reason));
END $$;

CREATE OR REPLACE FUNCTION app.transition_contract_status(
  p_tenant uuid,p_contract uuid,p_to text,p_reason text,p_actor_membership uuid
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE old_state text;project uuid;actor uuid;event_id uuid:=gen_random_uuid();allowed boolean:=false;required_permission text:='contract.manage';latest_version uuid;contract_type text;reason_text text:=COALESCE(NULLIF(btrim(p_reason),''),'Změna stavu smlouvy');
BEGIN
  SELECT current_status,project_id,contracts.contract_type INTO old_state,project,contract_type FROM contracts WHERE tenant_id=p_tenant AND id=p_contract FOR UPDATE;
  SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF old_state IS NULL OR actor IS NULL THEN RAISE EXCEPTION 'contract or actor not found';END IF;
  IF p_to='signed' THEN RAISE EXCEPTION 'signed status is reached only by the signature command';END IF;
  IF p_to='signing' THEN RAISE EXCEPTION 'signing is no longer a workflow status';END IF;
  allowed:=CASE old_state
    WHEN 'draft' THEN p_to IN ('sent','cancelled')
    WHEN 'sent' THEN p_to IN ('negotiation','approved','cancelled')
    WHEN 'negotiation' THEN p_to IN ('sent','approved','cancelled')
    WHEN 'approved' THEN p_to IN ('negotiation','cancelled')
    WHEN 'signing' THEN p_to IN ('approved','negotiation','cancelled')
    WHEN 'signed' THEN p_to='terminated'
    ELSE false END;
  IF NOT allowed THEN RAISE EXCEPTION 'contract workflow transition is not allowed';END IF;
  IF p_to='approved' THEN required_permission:='contract.approve';END IF;
  IF NOT app.has_project_permission(p_tenant,p_actor_membership,project,required_permission) THEN RAISE EXCEPTION '% permission required',required_permission;END IF;
  SELECT id INTO latest_version FROM contract_versions WHERE tenant_id=p_tenant AND contract_id=p_contract ORDER BY version_number DESC,id DESC LIMIT 1;
  IF p_to='approved' AND latest_version IS NULL THEN RAISE EXCEPTION 'contract requires a logical version';END IF;
  IF p_to='approved' THEN
    UPDATE contract_versions SET version_status='approved_for_signing',approved_at=COALESCE(approved_at,now())
    WHERE tenant_id=p_tenant AND id=latest_version AND version_status='working';
  END IF;
  PERFORM set_config('app.contract_status_command','on',true);
  UPDATE contracts SET current_status=p_to,
    ended_at=CASE WHEN p_to IN ('cancelled','terminated') THEN now() ELSE NULL END,
    end_reason=CASE WHEN p_to IN ('cancelled','terminated') THEN reason_text ELSE NULL END
  WHERE tenant_id=p_tenant AND id=p_contract;
  INSERT INTO contract_status_events(id,tenant_id,project_id,contract_id,from_status,to_status,command,reason,recorded_by_membership_id)
  VALUES(event_id,p_tenant,project,p_contract,old_state,p_to,CASE p_to WHEN 'terminated' THEN 'terminateContract' WHEN 'cancelled' THEN 'cancelContract' ELSE 'transitionContract' END,reason_text,p_actor_membership);
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data)
  VALUES(p_tenant,actor,'contract.status_changed','contract',p_contract,jsonb_build_object('status',old_state),jsonb_build_object('status',p_to,'reason',reason_text));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'contract',p_contract,'contract.status_changed.v1',jsonb_build_object('contractId',p_contract,'from',old_state,'to',p_to));
  IF contract_type='rs' AND p_to IN ('cancelled','terminated') THEN PERFORM app.rollback_ended_rs(p_tenant,p_contract,p_actor_membership,reason_text);END IF;
  RETURN event_id;
END $$;

CREATE OR REPLACE FUNCTION app.sign_contract_externally(
  p_tenant uuid,p_contract uuid,p_version uuid,p_signed_at timestamptz,
  p_actor_membership uuid,p_note text DEFAULT NULL
) RETURNS TABLE(completed boolean,already_signed boolean,version_id uuid) LANGUAGE plpgsql AS $$
DECLARE contract_row contracts%ROWTYPE;actor uuid;current_version contract_versions%ROWTYPE;signature_time timestamptz:=COALESCE(p_signed_at,now());note_text text:=COALESCE(NULLIF(btrim(p_note),''),'Podpis smlouvy zaznamenán');
BEGIN
  SELECT * INTO contract_row FROM contracts WHERE tenant_id=p_tenant AND id=p_contract FOR UPDATE;
  SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF contract_row.id IS NULL THEN RAISE EXCEPTION 'contract not found';END IF;
  IF actor IS NULL OR NOT app.has_project_permission(p_tenant,p_actor_membership,contract_row.project_id,'contract.sign') THEN RAISE EXCEPTION 'contract.sign permission required';END IF;
  SELECT * INTO current_version FROM contract_versions WHERE tenant_id=p_tenant AND contract_id=p_contract ORDER BY version_number DESC,id DESC LIMIT 1 FOR UPDATE;
  IF current_version.id IS NULL THEN RAISE EXCEPTION 'contract requires a logical version';END IF;
  IF p_version IS NULL OR p_version<>current_version.id THEN RAISE EXCEPTION 'current contract version is required';END IF;
  IF contract_row.current_status='signed' THEN
    IF current_version.version_status<>'signed' THEN RAISE EXCEPTION 'signed contract version is inconsistent';END IF;
    PERFORM app.synchronize_signed_contract(p_tenant,p_contract,p_actor_membership,note_text);
    RETURN QUERY SELECT true,true,current_version.id;RETURN;
  END IF;
  IF contract_row.current_status NOT IN ('approved','signing') THEN RAISE EXCEPTION 'contract must be approved';END IF;
  IF current_version.version_status<>'approved_for_signing' THEN RAISE EXCEPTION 'approved contract version is required';END IF;
  IF signature_time>now()+interval '5 minutes' THEN RAISE EXCEPTION 'signature date cannot be in the future';END IF;
  IF NOT EXISTS(SELECT 1 FROM contract_parties WHERE tenant_id=p_tenant AND contract_id=p_contract AND signing_required) THEN RAISE EXCEPTION 'contract requires a signing party';END IF;
  UPDATE contract_parties SET signature_status='signed',signed_at=signature_time,signed_version_id=current_version.id
  WHERE tenant_id=p_tenant AND contract_id=p_contract AND signing_required AND signature_status<>'signed';
  UPDATE contract_versions SET version_status='signed',signed_at=signature_time,locked_at=now() WHERE tenant_id=p_tenant AND id=current_version.id;
  PERFORM set_config('app.contract_status_command','on',true);
  UPDATE contracts SET current_status='signed',signed_at=signature_time WHERE tenant_id=p_tenant AND id=p_contract;
  INSERT INTO contract_status_events(tenant_id,project_id,contract_id,from_status,to_status,command,reason,recorded_by_membership_id,source)
  VALUES(p_tenant,contract_row.project_id,p_contract,contract_row.current_status,'signed','recordExternalSignature',note_text,p_actor_membership,'signature');
  PERFORM app.synchronize_signed_contract(p_tenant,p_contract,p_actor_membership,note_text);
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data,metadata)
  VALUES(p_tenant,actor,'contract.signed','contract',p_contract,jsonb_build_object('versionId',current_version.id,'type',contract_row.contract_type,'signedAt',signature_time,'method','external'),jsonb_build_object('projectId',contract_row.project_id,'unitId',contract_row.unit_id,'note',NULLIF(btrim(p_note),'')));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'contract',p_contract,'contract.signed.v1',jsonb_build_object('contractId',p_contract,'versionId',current_version.id,'type',contract_row.contract_type,'unitId',contract_row.unit_id,'signedAt',signature_time,'method','external'));
  RETURN QUERY SELECT true,false,current_version.id;
END $$;

CREATE OR REPLACE FUNCTION app.record_contract_party_signature(
  p_tenant uuid,p_contract_party uuid,p_version uuid,p_actor_membership uuid,p_reason text
) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE participant contract_parties%ROWTYPE;contract_row contracts%ROWTYPE;actor uuid;remaining integer;reason_text text:=COALESCE(NULLIF(btrim(p_reason),''),'Podpis účastníka zaznamenán');
BEGIN
  SELECT * INTO participant FROM contract_parties WHERE tenant_id=p_tenant AND id=p_contract_party FOR UPDATE;
  SELECT * INTO contract_row FROM contracts WHERE tenant_id=p_tenant AND id=participant.contract_id FOR UPDATE;
  SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF participant.id IS NULL OR contract_row.current_status NOT IN ('approved','signing') OR actor IS NULL OR NOT app.has_project_permission(p_tenant,p_actor_membership,contract_row.project_id,'contract.sign') THEN RAISE EXCEPTION 'contract.sign permission and approved workflow are required';END IF;
  IF NOT EXISTS(SELECT 1 FROM contract_versions WHERE tenant_id=p_tenant AND contract_id=contract_row.id AND id=p_version AND version_status='approved_for_signing') THEN RAISE EXCEPTION 'approved contract version is required';END IF;
  IF participant.signature_status='signed' AND participant.signed_version_id=p_version THEN RETURN contract_row.current_status='signed';END IF;
  UPDATE contract_parties SET signature_status='signed',signed_at=now(),signed_version_id=p_version WHERE tenant_id=p_tenant AND id=p_contract_party;
  SELECT count(*) INTO remaining FROM contract_parties WHERE tenant_id=p_tenant AND contract_id=contract_row.id AND signing_required AND signature_status<>'signed';
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data) VALUES(p_tenant,actor,'contract.party_signed','contract_party',p_contract_party,jsonb_build_object('contractId',contract_row.id,'versionId',p_version));
  IF remaining>0 THEN RETURN false;END IF;
  UPDATE contract_versions SET version_status='signed',signed_at=now(),locked_at=now() WHERE tenant_id=p_tenant AND id=p_version;
  PERFORM set_config('app.contract_status_command','on',true);
  UPDATE contracts SET current_status='signed',signed_at=now() WHERE tenant_id=p_tenant AND id=contract_row.id;
  INSERT INTO contract_status_events(tenant_id,project_id,contract_id,from_status,to_status,command,reason,recorded_by_membership_id,source)
  VALUES(p_tenant,contract_row.project_id,contract_row.id,contract_row.current_status,'signed','completeSignatures',reason_text,p_actor_membership,'signature');
  PERFORM app.synchronize_signed_contract(p_tenant,contract_row.id,p_actor_membership,reason_text);
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data) VALUES(p_tenant,actor,'contract.signed','contract',contract_row.id,jsonb_build_object('versionId',p_version,'type',contract_row.contract_type));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload) VALUES(p_tenant,'contract',contract_row.id,'contract.signed.v1',jsonb_build_object('contractId',contract_row.id,'versionId',p_version,'type',contract_row.contract_type,'unitId',contract_row.unit_id));
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION app.change_sales_case_buyer(
  p_tenant uuid,p_case uuid,p_new_party uuid,p_actor_membership uuid,p_reason text
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE case_row sales_cases%ROWTYPE;actor uuid;event_id uuid:=gen_random_uuid();previous_buyers jsonb;interest_id uuid;reason_text text:=COALESCE(NULLIF(btrim(p_reason),''),'Změna kupujícího');
BEGIN
  SELECT * INTO case_row FROM sales_cases WHERE tenant_id=p_tenant AND id=p_case FOR UPDATE;
  SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF case_row.id IS NULL OR case_row.status<>'active' THEN RAISE EXCEPTION 'active sales case is required';END IF;
  IF actor IS NULL OR NOT app.has_project_permission(p_tenant,p_actor_membership,case_row.project_id,'sales_case.manage') THEN RAISE EXCEPTION 'sales_case.manage permission required';END IF;
  IF p_new_party IS NOT NULL AND NOT EXISTS(SELECT 1 FROM parties WHERE tenant_id=p_tenant AND id=p_new_party AND lifecycle_status='active') THEN RAISE EXCEPTION 'new buyer must be an active client of the workspace';END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('partyId',party_id,'role',participant_role,'isPrimary',is_primary)),'[]'::jsonb)
  INTO previous_buyers FROM sales_case_parties
  WHERE tenant_id=p_tenant AND sales_case_id=p_case AND participant_role IN ('buyer','co_buyer') AND left_at IS NULL;
  IF p_new_party IS NOT NULL AND EXISTS(
    SELECT 1 FROM sales_case_parties WHERE tenant_id=p_tenant AND sales_case_id=p_case AND party_id=p_new_party AND left_at IS NULL
  ) AND jsonb_array_length(previous_buyers)=1 THEN RETURN event_id;END IF;
  UPDATE sales_case_parties SET left_at=now(),is_primary=false
  WHERE tenant_id=p_tenant AND sales_case_id=p_case AND participant_role IN ('buyer','co_buyer') AND left_at IS NULL;
  IF p_new_party IS NOT NULL THEN
    INSERT INTO sales_case_parties(tenant_id,project_id,sales_case_id,party_id,participant_role,is_primary,joined_at,left_at)
    VALUES(p_tenant,case_row.project_id,p_case,p_new_party,'buyer',true,now(),NULL)
    ON CONFLICT ON CONSTRAINT sales_case_party_uq DO UPDATE SET left_at=NULL,is_primary=true;
    INSERT INTO party_project_links(tenant_id,project_id,party_id,relationship_type)
    SELECT p_tenant,case_row.project_id,p_new_party,'buyer'
    WHERE NOT EXISTS(SELECT 1 FROM party_project_links WHERE tenant_id=p_tenant AND project_id=case_row.project_id AND party_id=p_new_party AND relationship_type='buyer' AND valid_to IS NULL);
    INSERT INTO unit_interests(tenant_id,project_id,unit_id,party_id,status,first_interest_at,last_interest_at)
    VALUES(p_tenant,case_row.project_id,case_row.unit_id,p_new_party,'converted',now(),now())
    ON CONFLICT(tenant_id,unit_id,party_id) DO UPDATE SET status='converted',last_interest_at=EXCLUDED.last_interest_at
    RETURNING id INTO interest_id;
    INSERT INTO interest_events(tenant_id,project_id,unit_interest_id,sales_case_id,event_type,outcome,note,occurred_at,recorded_by_membership_id)
    VALUES(p_tenant,case_row.project_id,interest_id,p_case,'converted_to_sales_case','Změna kupujícího',reason_text,now(),p_actor_membership);
  END IF;
  INSERT INTO audit_log(id,tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data,metadata)
  VALUES(event_id,p_tenant,actor,'sales_case.buyer_changed','sales_case',p_case,
    jsonb_build_object('buyers',previous_buyers),jsonb_build_object('partyId',p_new_party),
    jsonb_build_object('projectId',case_row.project_id,'unitId',case_row.unit_id,'reason',reason_text));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'sales_case',p_case,'sales_case.buyer_changed.v1',jsonb_build_object('salesCaseId',p_case,'unitId',case_row.unit_id,'newPartyId',p_new_party));
  RETURN event_id;
END $$;

CREATE OR REPLACE FUNCTION app.add_party_activity(
  p_tenant uuid,p_party uuid,p_activity_type text,p_note text,p_actor_membership uuid
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE actor uuid;activity_id uuid:=gen_random_uuid();activity_type text:=lower(NULLIF(btrim(p_activity_type),''));
BEGIN
  SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF actor IS NULL OR activity_type NOT IN ('note','call','email','meeting','other') OR length(btrim(p_note))<2 THEN RAISE EXCEPTION 'valid activity type, note and active actor are required';END IF;
  IF NOT app.can_manage_party(p_tenant,p_actor_membership,p_party) THEN RAISE EXCEPTION 'clients.update permission and party scope required';END IF;
  INSERT INTO audit_log(id,tenant_id,actor_user_id,action,entity_type,entity_id,after_data)
  VALUES(activity_id,p_tenant,actor,'party.activity_added','party',p_party,jsonb_build_object('activityType',activity_type,'note',btrim(p_note)));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'party',p_party,'party.activity_added.v1',jsonb_build_object('partyId',p_party,'activityId',activity_id,'activityType',activity_type));
  RETURN activity_id;
END $$;

CREATE OR REPLACE FUNCTION app.list_party_activities(p_tenant uuid,p_membership uuid)
RETURNS TABLE(id uuid,party_id uuid,activity_type text,note text,occurred_at timestamptz,author text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,app AS $$
  SELECT audit.id,audit.entity_id,(audit.after_data->>'activityType')::text,(audit.after_data->>'note')::text,
    audit.occurred_at,COALESCE(actor.display_name,'Systém')
  FROM audit_log audit
  LEFT JOIN users actor ON actor.id=audit.actor_user_id
  WHERE audit.tenant_id=p_tenant AND audit.action='party.activity_added' AND audit.entity_type='party'
    AND app.can_access_party(p_tenant,p_membership,audit.entity_id,false)
  ORDER BY audit.occurred_at DESC,audit.id DESC
$$;

GRANT EXECUTE ON FUNCTION app.synchronize_signed_contract(uuid,uuid,uuid,text) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.rollback_ended_rs(uuid,uuid,uuid,text) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.transition_contract_status(uuid,uuid,text,text,uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.sign_contract_externally(uuid,uuid,uuid,timestamptz,uuid,text) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.record_contract_party_signature(uuid,uuid,uuid,uuid,text) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.change_sales_case_buyer(uuid,uuid,uuid,uuid,text) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.add_party_activity(uuid,uuid,text,text,uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.list_party_activities(uuid,uuid) TO develocrm_app;

COMMIT;

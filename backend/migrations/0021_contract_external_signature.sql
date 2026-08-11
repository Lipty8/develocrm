BEGIN;

CREATE OR REPLACE FUNCTION app.sign_contract_externally(
  p_tenant uuid,
  p_contract uuid,
  p_version uuid,
  p_signed_at timestamptz,
  p_actor_membership uuid,
  p_note text DEFAULT NULL
) RETURNS TABLE(completed boolean, already_signed boolean, version_id uuid) LANGUAGE plpgsql AS $$
DECLARE
  contract_row contracts%ROWTYPE;
  actor uuid;
  current_version contract_versions%ROWTYPE;
  signature_time timestamptz:=COALESCE(p_signed_at,now());
  note_text text:=COALESCE(NULLIF(btrim(p_note),''),'Podpis smlouvy zaznamenán');
  stage_target text;
  status_target text;
  status_command text;
BEGIN
  SELECT * INTO contract_row
  FROM contracts
  WHERE tenant_id=p_tenant AND id=p_contract
  FOR UPDATE;

  SELECT user_id INTO actor
  FROM tenant_memberships
  WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';

  IF contract_row.id IS NULL THEN RAISE EXCEPTION 'contract not found'; END IF;
  IF actor IS NULL OR NOT app.has_project_permission(p_tenant,p_actor_membership,contract_row.project_id,'contract.sign') THEN
    RAISE EXCEPTION 'contract.sign permission required';
  END IF;

  SELECT * INTO current_version
  FROM contract_versions
  WHERE tenant_id=p_tenant AND contract_id=p_contract
  ORDER BY version_number DESC,id DESC
  LIMIT 1
  FOR UPDATE;

  IF current_version.id IS NULL THEN RAISE EXCEPTION 'contract requires a logical version'; END IF;
  IF p_version IS NULL OR p_version<>current_version.id THEN RAISE EXCEPTION 'current contract version is required'; END IF;

  IF contract_row.current_status='signed' THEN
    IF current_version.version_status<>'signed' THEN RAISE EXCEPTION 'signed contract version is inconsistent'; END IF;
    RETURN QUERY SELECT true,true,current_version.id;
    RETURN;
  END IF;

  IF contract_row.current_status NOT IN ('approved','signing') THEN
    RAISE EXCEPTION 'contract must be approved or in signing workflow';
  END IF;
  IF current_version.version_status<>'approved_for_signing' THEN
    RAISE EXCEPTION 'approved contract version is required';
  END IF;
  IF signature_time>now()+interval '5 minutes' THEN RAISE EXCEPTION 'signature date cannot be in the future'; END IF;
  IF NOT EXISTS(
    SELECT 1 FROM contract_parties
    WHERE tenant_id=p_tenant AND contract_id=p_contract AND signing_required
  ) THEN RAISE EXCEPTION 'contract requires a signing party'; END IF;

  IF contract_row.current_status='approved' THEN
    PERFORM set_config('app.contract_status_command','on',true);
    UPDATE contracts SET current_status='signing' WHERE tenant_id=p_tenant AND id=p_contract;
    INSERT INTO contract_status_events(tenant_id,project_id,contract_id,from_status,to_status,command,reason,recorded_by_membership_id,source)
    VALUES(p_tenant,contract_row.project_id,p_contract,'approved','signing','startExternalSigning',note_text,p_actor_membership,'signature');
  END IF;

  UPDATE contract_parties
  SET signature_status='signed',signed_at=signature_time,signed_version_id=current_version.id
  WHERE tenant_id=p_tenant AND contract_id=p_contract AND signing_required AND signature_status<>'signed';

  UPDATE contract_versions
  SET version_status='signed',signed_at=signature_time,locked_at=now()
  WHERE tenant_id=p_tenant AND id=current_version.id;

  PERFORM set_config('app.contract_status_command','on',true);
  UPDATE contracts SET current_status='signed',signed_at=signature_time
  WHERE tenant_id=p_tenant AND id=p_contract;

  INSERT INTO contract_status_events(tenant_id,project_id,contract_id,from_status,to_status,command,reason,recorded_by_membership_id,source)
  VALUES(p_tenant,contract_row.project_id,p_contract,'signing','signed','recordExternalSignature',note_text,p_actor_membership,'signature');

  IF contract_row.contract_type IN ('rs','sbk','ks') THEN
    stage_target:=contract_row.contract_type;
    PERFORM app.record_sales_stage(p_tenant,contract_row.sales_case_id,stage_target,'contractSigned',note_text,p_actor_membership);
  END IF;
  IF contract_row.contract_type='sbk' THEN status_target:='contracted';status_command:='activateFuturePurchaseContract'; END IF;
  IF contract_row.contract_type='ks' THEN status_target:='sold';status_command:='confirmFinalContractEffective'; END IF;
  IF status_target IS NOT NULL THEN
    PERFORM app.transition_unit_commercial_status(p_tenant,contract_row.unit_id,status_target,status_command,note_text,p_actor_membership);
  END IF;

  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data,metadata)
  VALUES(p_tenant,actor,'contract.signed','contract',p_contract,
    jsonb_build_object('versionId',current_version.id,'type',contract_row.contract_type,'signedAt',signature_time,'method','external'),
    jsonb_build_object('projectId',contract_row.project_id,'unitId',contract_row.unit_id,'note',NULLIF(btrim(p_note),'')));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'contract',p_contract,'contract.signed.v1',
    jsonb_build_object('contractId',p_contract,'versionId',current_version.id,'type',contract_row.contract_type,'unitId',contract_row.unit_id,'signedAt',signature_time,'method','external'));

  RETURN QUERY SELECT true,false,current_version.id;
END $$;

GRANT EXECUTE ON FUNCTION app.sign_contract_externally(uuid,uuid,uuid,timestamptz,uuid,text) TO develocrm_app;

COMMIT;

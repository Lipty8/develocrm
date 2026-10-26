BEGIN;

-- A new editable version cannot retain the previous document's approval.
-- This is the same reapproval invariant used after document regeneration,
-- applied early enough for signing dates, appendices and terms preparation.
CREATE OR REPLACE FUNCTION app.create_contract_version(
  p_tenant uuid,p_contract uuid,p_display_name text,p_source_type text,p_actor_membership uuid,
  p_based_on uuid DEFAULT NULL,p_generation_payload jsonb DEFAULT '{}'::jsonb
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE project uuid; actor uuid; current_state text; version_id uuid:=gen_random_uuid(); next_number integer;
BEGIN
  IF p_tenant IS DISTINCT FROM app.current_tenant_id() THEN RAISE EXCEPTION 'tenant context required'; END IF;
  PERFORM app.lock_workflow_unit(p_tenant,(SELECT unit_id FROM contracts WHERE tenant_id=p_tenant AND id=p_contract));
  SELECT project_id,current_status INTO project,current_state FROM contracts WHERE tenant_id=p_tenant AND id=p_contract FOR UPDATE;
  SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership
    AND user_id=app.current_user_id() AND status='active';
  IF project IS NULL OR actor IS NULL OR current_state IN ('signed','cancelled','terminated') OR NOT app.has_project_permission(p_tenant,p_actor_membership,project,'contract.manage') THEN RAISE EXCEPTION 'contract is not versionable or permission is missing'; END IF;
  IF p_based_on IS NOT NULL AND NOT EXISTS(SELECT 1 FROM contract_versions WHERE tenant_id=p_tenant AND contract_id=p_contract AND id=p_based_on) THEN RAISE EXCEPTION 'based-on version must belong to the contract'; END IF;
  IF EXISTS(SELECT 1 FROM contract_parties WHERE tenant_id=p_tenant AND contract_id=p_contract AND signature_status='signed') THEN
    RAISE EXCEPTION 'SIGNED_DOCUMENT_IMMUTABLE';
  END IF;
  SELECT COALESCE(max(version_number),0)+1 INTO next_number FROM contract_versions WHERE tenant_id=p_tenant AND contract_id=p_contract;
  UPDATE contract_versions SET version_status='superseded' WHERE tenant_id=p_tenant AND contract_id=p_contract AND version_status IN ('working','approved_for_signing');
  INSERT INTO contract_versions(id,tenant_id,project_id,contract_id,version_number,based_on_version_id,source_type,display_name,generation_payload,created_by_membership_id)
  VALUES(version_id,p_tenant,project,p_contract,next_number,p_based_on,p_source_type,p_display_name,COALESCE(p_generation_payload,'{}'::jsonb),p_actor_membership);
  IF current_state<>'draft' THEN
    PERFORM set_config('app.contract_status_command','on',true);
    UPDATE contracts SET current_status='draft' WHERE tenant_id=p_tenant AND id=p_contract;
    PERFORM set_config('app.contract_status_command','off',true);
    INSERT INTO contract_status_events(tenant_id,project_id,contract_id,from_status,to_status,command,reason,recorded_by_membership_id,source)
      VALUES(p_tenant,project,p_contract,current_state,'draft','newContractVersion','Nová verze vyžaduje kontrolu a schválení',p_actor_membership,'automation');
  END IF;
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data)
  VALUES(p_tenant,actor,'contract.version_created','contract_version',version_id,jsonb_build_object('contractId',p_contract,'versionNumber',next_number,'basedOnVersionId',p_based_on,'previousStatus',current_state,'currentStatus','draft'));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'contract',p_contract,'contract.version_created.v1',jsonb_build_object('contractId',p_contract,'versionId',version_id,'versionNumber',next_number,'previousStatus',current_state,'currentStatus','draft'));
  RETURN version_id;
END $$;

COMMIT;

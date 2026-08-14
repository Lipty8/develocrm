BEGIN;

CREATE OR REPLACE FUNCTION app.party_archive_impact(p_tenant uuid,p_party uuid,p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE result jsonb;can_delete boolean;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM party_project_links link WHERE link.tenant_id=p_tenant AND link.party_id=p_party AND link.valid_to IS NULL)
    OR EXISTS(SELECT 1 FROM party_project_links link WHERE link.tenant_id=p_tenant AND link.party_id=p_party AND link.valid_to IS NULL AND NOT app.has_project_permission(p_tenant,p_actor,link.project_id,'clients.archive'))
 THEN RAISE EXCEPTION 'clients.archive permission required for every active project'; END IF;
 WITH related_units AS (
   SELECT unit_id FROM unit_interests WHERE tenant_id=p_tenant AND party_id=p_party
   UNION SELECT sales_case.unit_id FROM sales_case_parties participant JOIN sales_cases sales_case ON sales_case.tenant_id=participant.tenant_id AND sales_case.id=participant.sales_case_id WHERE participant.tenant_id=p_tenant AND participant.party_id=p_party
 ), related_contracts AS (
   SELECT contract_id FROM contract_parties WHERE tenant_id=p_tenant AND party_id=p_party
   UNION SELECT contract.id FROM contracts contract JOIN sales_case_parties participant ON participant.tenant_id=contract.tenant_id AND participant.sales_case_id=contract.sales_case_id WHERE contract.tenant_id=p_tenant AND participant.party_id=p_party
 ), counts AS (
   SELECT
    (SELECT count(DISTINCT unit_id) FROM related_units)::int units,
    (SELECT count(*) FROM unit_interests WHERE tenant_id=p_tenant AND party_id=p_party)::int interests,
    (SELECT count(DISTINCT sales_case_id) FROM sales_case_parties WHERE tenant_id=p_tenant AND party_id=p_party)::int sales_cases,
    (SELECT count(*) FROM related_contracts)::int contracts,
    (SELECT count(*) FROM payment_obligations WHERE tenant_id=p_tenant AND party_id=p_party)::int payments,
    (SELECT count(*) FROM tasks WHERE tenant_id=p_tenant AND party_id=p_party)::int tasks,
    (SELECT count(*) FROM unit_handovers WHERE tenant_id=p_tenant AND unit_id IN(SELECT unit_id FROM related_units))::int handovers,
    (SELECT count(*) FROM party_documents WHERE tenant_id=p_tenant AND party_id=p_party)::int documents,
    (SELECT count(*) FROM client_changes WHERE tenant_id=p_tenant AND party_id=p_party)::int client_changes
 )
 SELECT jsonb_build_object('units',units,'interests',interests,'salesCases',sales_cases,'contracts',contracts,'payments',payments,'tasks',tasks,'handovers',handovers,'documents',documents,'clientChanges',client_changes),
        units+interests+sales_cases+contracts+payments+tasks+handovers+documents+client_changes=0
 INTO result,can_delete FROM counts;
 can_delete:=can_delete
   AND NOT EXISTS(SELECT 1 FROM parties WHERE tenant_id=p_tenant AND merged_into_party_id=p_party)
   AND NOT EXISTS(SELECT 1 FROM tenant_memberships WHERE tenant_id=p_tenant AND partner_party_id=p_party)
   AND NOT EXISTS(SELECT 1 FROM parties WHERE tenant_id=p_tenant AND source_partner_party_id=p_party);
 RETURN result||jsonb_build_object('removalMode',CASE WHEN can_delete THEN 'delete' ELSE 'archive' END);
END $$;

CREATE OR REPLACE FUNCTION app.guard_party_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,app AS $$
DECLARE tenant uuid;party uuid;membership uuid;creation_party uuid;
BEGIN
  IF TG_OP='DELETE' THEN tenant:=OLD.tenant_id;IF TG_TABLE_NAME='parties' THEN party:=OLD.id;ELSE party:=OLD.party_id;END IF;
  ELSE tenant:=NEW.tenant_id;IF TG_TABLE_NAME='parties' THEN party:=NEW.id;ELSE party:=NEW.party_id;END IF;END IF;
  IF current_setting('app.party_removal_command',true)='on' THEN IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;END IF;
  IF app.current_user_id() IS NULL THEN IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;END IF;
  SELECT id INTO membership FROM tenant_memberships WHERE tenant_id=tenant AND user_id=app.current_user_id() AND status='active' ORDER BY accepted_at DESC NULLS LAST LIMIT 1;
  creation_party:=NULLIF(current_setting('app.party_creation_id',true),'')::uuid;
  IF TG_OP='INSERT' AND creation_party=party AND EXISTS(SELECT 1 FROM parties created JOIN party_project_links link ON link.tenant_id=created.tenant_id AND link.party_id=created.id AND link.valid_to IS NULL WHERE created.tenant_id=tenant AND created.id=party AND created.owner_membership_id=membership AND app.has_project_permission(tenant,membership,link.project_id,'clients.create')) THEN RETURN NEW;END IF;
  IF membership IS NULL OR NOT app.can_manage_party(tenant,membership,party) THEN RAISE EXCEPTION 'clients.update permission and party scope required';END IF;
  IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;
END $$;

CREATE OR REPLACE FUNCTION app.remove_or_archive_party(p_tenant uuid,p_party uuid,p_actor uuid,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE impact jsonb;mode text;actor_user uuid;before_row jsonb;after_row jsonb;
BEGIN
 IF length(btrim(p_reason))<3 THEN RAISE EXCEPTION 'removal reason is required'; END IF;
 impact:=app.party_archive_impact(p_tenant,p_party,p_actor);
 mode:=impact->>'removalMode';
 SELECT user_id INTO actor_user FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor AND status='active';
 SELECT to_jsonb(party) INTO before_row FROM parties party WHERE tenant_id=p_tenant AND id=p_party FOR UPDATE;
 IF before_row IS NULL THEN RAISE EXCEPTION 'party not found'; END IF;
 IF (before_row->>'lifecycle_status')='archived' THEN RETURN jsonb_build_object('mode','archive','impact',impact); END IF;
 PERFORM set_config('app.party_removal_command','on',true);
 IF mode='delete' THEN
   INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,before_data,metadata)
   VALUES(p_tenant,actor_user,'party.deleted','party',p_party,before_row,jsonb_build_object('reason',btrim(p_reason),'impact',impact));
   INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
   VALUES(p_tenant,'party',p_party,'party.deleted.v1',jsonb_build_object('reason',btrim(p_reason)));
   DELETE FROM party_external_identifiers WHERE tenant_id=p_tenant AND party_id=p_party;
   DELETE FROM party_private_identifiers WHERE tenant_id=p_tenant AND party_id=p_party;
   DELETE FROM party_addresses WHERE tenant_id=p_tenant AND party_id=p_party;
   DELETE FROM party_contacts WHERE tenant_id=p_tenant AND party_id=p_party;
   DELETE FROM party_individual_details WHERE tenant_id=p_tenant AND party_id=p_party;
   DELETE FROM party_organization_details WHERE tenant_id=p_tenant AND party_id=p_party;
   DELETE FROM party_project_links WHERE tenant_id=p_tenant AND party_id=p_party;
   DELETE FROM parties WHERE tenant_id=p_tenant AND id=p_party;
 ELSE
   UPDATE parties SET lifecycle_status='archived',archived_at=now(),updated_at=now() WHERE tenant_id=p_tenant AND id=p_party RETURNING to_jsonb(parties) INTO after_row;
   INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data,metadata)
   VALUES(p_tenant,actor_user,'party.archived','party',p_party,before_row,after_row,jsonb_build_object('reason',btrim(p_reason),'impact',impact));
   INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
   VALUES(p_tenant,'party',p_party,'party.archived.v1',jsonb_build_object('reason',btrim(p_reason),'impact',impact));
 END IF;
 RETURN jsonb_build_object('mode',mode,'impact',impact);
END $$;

GRANT EXECUTE ON FUNCTION app.party_archive_impact(uuid,uuid,uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.remove_or_archive_party(uuid,uuid,uuid,text) TO develocrm_app;

COMMIT;

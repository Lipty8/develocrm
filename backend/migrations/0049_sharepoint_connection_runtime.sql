BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS sharepoint_connections_one_active_per_tenant_uq
  ON sharepoint_connections(tenant_id)
  WHERE archived_at IS NULL;

CREATE OR REPLACE FUNCTION app.configure_sharepoint_connection(
  p_tenant uuid,
  p_name text,
  p_entra_tenant_id uuid,
  p_site_id text,
  p_drive_id text,
  p_credential_reference text,
  p_actor_membership uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,app
AS $$
DECLARE
  actor_user uuid;
  connection_id uuid;
  before_row jsonb;
  after_row jsonb;
BEGIN
  SELECT membership.user_id INTO actor_user
  FROM public.tenant_memberships membership
  WHERE membership.tenant_id=p_tenant
    AND membership.id=p_actor_membership
    AND membership.status='active';

  IF p_tenant IS DISTINCT FROM app.current_tenant_id()
    OR actor_user IS NULL
    OR actor_user IS DISTINCT FROM app.current_user_id()
    OR NOT app.current_user_has_permission('integrations.manage') THEN
    RAISE EXCEPTION 'integrations.manage permission required';
  END IF;
  IF length(btrim(p_name))<2 OR length(btrim(p_site_id))<3 OR length(btrim(p_drive_id))<3 THEN
    RAISE EXCEPTION 'invalid SharePoint connection configuration';
  END IF;
  IF p_credential_reference !~ '^managed-identity://[0-9a-fA-F-]{36}$' THEN
    RAISE EXCEPTION 'managed identity reference required';
  END IF;

  SELECT connection.id,to_jsonb(connection) INTO connection_id,before_row
  FROM public.sharepoint_connections connection
  WHERE connection.tenant_id=p_tenant AND connection.archived_at IS NULL
  FOR UPDATE;

  IF connection_id IS NULL THEN
    INSERT INTO public.sharepoint_connections(
      tenant_id,name,entra_tenant_id,site_id,drive_id,authentication_mode,
      credential_reference,connection_status,sync_status,created_by_membership_id
    ) VALUES(
      p_tenant,btrim(p_name),p_entra_tenant_id,btrim(p_site_id),btrim(p_drive_id),'managed_identity',
      p_credential_reference,'not_configured','idle',p_actor_membership
    ) RETURNING id,to_jsonb(sharepoint_connections) INTO connection_id,after_row;
  ELSE
    UPDATE public.sharepoint_connections
    SET name=btrim(p_name),entra_tenant_id=p_entra_tenant_id,site_id=btrim(p_site_id),drive_id=btrim(p_drive_id),
        authentication_mode='managed_identity',credential_reference=p_credential_reference,
        connection_status='not_configured',sync_status='idle',last_successful_sync_at=NULL,last_sync_error=NULL
    WHERE tenant_id=p_tenant AND id=connection_id
    RETURNING to_jsonb(sharepoint_connections) INTO after_row;
  END IF;

  INSERT INTO public.audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data)
  VALUES(p_tenant,actor_user,'sharepoint.connection_configured','sharepoint_connection',connection_id,before_row,after_row);
  INSERT INTO public.outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'sharepoint_connection',connection_id,'sharepoint.connection_configured.v1',
    jsonb_build_object('connectionId',connection_id,'siteId',btrim(p_site_id),'driveId',btrim(p_drive_id)));
  RETURN connection_id;
END $$;

CREATE OR REPLACE FUNCTION app.record_sharepoint_connection_validation(
  p_tenant uuid,
  p_connection uuid,
  p_status text,
  p_error_code text,
  p_actor_membership uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,app
AS $$
DECLARE
  actor_user uuid;
  before_row jsonb;
  after_row jsonb;
BEGIN
  SELECT membership.user_id INTO actor_user
  FROM public.tenant_memberships membership
  WHERE membership.tenant_id=p_tenant
    AND membership.id=p_actor_membership
    AND membership.status='active';
  IF p_tenant IS DISTINCT FROM app.current_tenant_id()
    OR actor_user IS NULL
    OR actor_user IS DISTINCT FROM app.current_user_id()
    OR NOT app.current_user_has_permission('integrations.manage') THEN
    RAISE EXCEPTION 'integrations.manage permission required';
  END IF;
  IF p_status NOT IN ('connected','error') THEN RAISE EXCEPTION 'invalid SharePoint validation status'; END IF;

  SELECT to_jsonb(connection) INTO before_row
  FROM public.sharepoint_connections connection
  WHERE connection.tenant_id=p_tenant AND connection.id=p_connection AND connection.archived_at IS NULL
  FOR UPDATE;
  IF before_row IS NULL THEN RAISE EXCEPTION 'SharePoint connection not found'; END IF;

  UPDATE public.sharepoint_connections
  SET connection_status=p_status,
      sync_status=CASE WHEN p_status='connected' THEN 'idle' ELSE 'error' END,
      last_successful_sync_at=CASE WHEN p_status='connected' THEN now() ELSE last_successful_sync_at END,
      last_sync_error=CASE WHEN p_status='error' THEN left(COALESCE(NULLIF(btrim(p_error_code),''),'validation_failed'),120) ELSE NULL END
  WHERE tenant_id=p_tenant AND id=p_connection
  RETURNING to_jsonb(sharepoint_connections) INTO after_row;

  INSERT INTO public.audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data)
  VALUES(p_tenant,actor_user,'sharepoint.connection_validated','sharepoint_connection',p_connection,before_row,after_row);
  INSERT INTO public.outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'sharepoint_connection',p_connection,'sharepoint.connection_validated.v1',
    jsonb_build_object('connectionId',p_connection,'status',p_status,'errorCode',p_error_code));
  RETURN p_connection;
END $$;

REVOKE ALL ON FUNCTION app.configure_sharepoint_connection(uuid,text,uuid,text,text,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.record_sharepoint_connection_validation(uuid,uuid,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.configure_sharepoint_connection(uuid,text,uuid,text,text,text,uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.record_sharepoint_connection_validation(uuid,uuid,text,text,uuid) TO develocrm_app;

COMMIT;

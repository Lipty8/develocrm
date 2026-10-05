BEGIN;

-- Resolve only an exact Entra identity from the workspace's primary provider.
-- The function deliberately returns just the internal user id and avoids
-- broadening the users SELECT policy to identities without a membership.
CREATE OR REPLACE FUNCTION app.find_entra_identity_for_onboarding(
  p_tenant_id uuid,
  p_entra_subject text
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT user_account.id
  FROM tenant_identity_providers provider
  JOIN users user_account ON user_account.entra_issuer = provider.issuer
  WHERE provider.tenant_id = p_tenant_id
    AND provider.status = 'active'
    AND provider.is_primary = true
    AND user_account.entra_subject = p_entra_subject
    AND p_tenant_id = app.current_tenant_id()
    AND app.current_user_has_permission('users.manage')
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION app.find_entra_identity_for_onboarding(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.find_entra_identity_for_onboarding(uuid, text) TO develocrm_app;

COMMIT;

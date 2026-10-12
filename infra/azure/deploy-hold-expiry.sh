#!/usr/bin/env sh
set -eu

# Reuse the deployed API digest, runtime database secret and managed identity.
: "${API_IMAGE:?Matching immutable API image digest is required}"
: "${HOLD_EXPIRY_CONTEXTS:?Explicit authorized tenant/membership contexts are required}"
RG=rg-develocrm-pilot
JOB=job-develocrm-hold-expiry
IDENTITY=/subscriptions/9ed8af89-11a4-4aaf-bbb8-322b95789aaa/resourcegroups/rg-develocrm-pilot/providers/Microsoft.ManagedIdentity/userAssignedIdentities/id-develocrm-api-pilot
if az containerapp job show -g "$RG" -n "$JOB" --query name -o tsv >/dev/null 2>&1; then
  az containerapp job update -g "$RG" -n "$JOB" --image "$API_IMAGE" \
    --cron-expression '*/1 * * * *' --replica-timeout 600 --replica-retry-limit 1 \
    --parallelism 1 --replica-completion-count 1 --command node --args backend/dist/sales/run-hold-expiry.js \
    --set-env-vars "HOLD_EXPIRY_CONTEXTS=$HOLD_EXPIRY_CONTEXTS" -o none
else
  az containerapp job create -g "$RG" -n "$JOB" --environment cae-develocrm-pilot \
    --trigger-type Schedule --cron-expression '*/1 * * * *' \
    --replica-timeout 600 --replica-retry-limit 1 --parallelism 1 --replica-completion-count 1 \
    --cpu 0.25 --memory 0.5Gi --image "$API_IMAGE" \
    --mi-user-assigned "$IDENTITY" --registry-server acrdevelocrmpilot9a4c6e.azurecr.io --registry-identity "$IDENTITY" \
    --secrets "database-url=keyvaultref:https://kv-develocrm-pilot-2008.vault.azure.net/secrets/database-url/1b444981625a4649a4f77b0e4c596425,identityref:$IDENTITY" \
    --env-vars 'DATABASE_URL=secretref:database-url' "HOLD_EXPIRY_CONTEXTS=$HOLD_EXPIRY_CONTEXTS" \
    --command node --args backend/dist/sales/run-hold-expiry.js -o none
fi

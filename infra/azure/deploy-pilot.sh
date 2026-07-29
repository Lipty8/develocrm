#!/usr/bin/env sh
set -eu

# PŘÍPRAVA POUZE: skript není spouštěn automaticky. Citlivé hodnoty nepředávejte
# na příkazové řádce; secrets nejdříve vložte do Key Vaultu bezpečným kanálem.
: "${AZURE_SUBSCRIPTION_ID:?}"
: "${ENTRA_TENANT_ID:?}"
: "${API_CLIENT_ID:?}"
: "${FRONTEND_ORIGIN:?}"
: "${WORKSPACE_ID:?}"

RG=rg-develocrm-pilot
LOCATION=northeurope
ACR=acrdevelocrmpilot
IDENTITY=id-develocrm-pilot
ENVIRONMENT=cae-develocrm-pilot
APP=ca-develocrm-api-pilot
MIGRATION_JOB=caj-develocrm-migrations-pilot
KEYVAULT=kv-develocrm-pilot-2008
IMAGE_TAG="${IMAGE_TAG:?Použijte immutable tag, např. v41-pilot-rc1-<git-sha>}"

az account set --subscription "$AZURE_SUBSCRIPTION_ID"
az provider register --namespace Microsoft.App --wait
az provider register --namespace Microsoft.ContainerRegistry --wait
az provider register --namespace Microsoft.ManagedIdentity --wait
az provider register --namespace Microsoft.KeyVault --wait
az provider register --namespace Microsoft.OperationalInsights --wait
az provider register --namespace Microsoft.Insights --wait

az acr create -g "$RG" -n "$ACR" -l "$LOCATION" --sku Basic
az identity create -g "$RG" -n "$IDENTITY" -l "$LOCATION"
IDENTITY_ID=$(az identity show -g "$RG" -n "$IDENTITY" --query id -o tsv)
PRINCIPAL_ID=$(az identity show -g "$RG" -n "$IDENTITY" --query principalId -o tsv)
ACR_ID=$(az acr show -g "$RG" -n "$ACR" --query id -o tsv)
KV_ID=$(az keyvault show -g "$RG" -n "$KEYVAULT" --query id -o tsv)
az role assignment create --assignee-object-id "$PRINCIPAL_ID" --assignee-principal-type ServicePrincipal --role AcrPull --scope "$ACR_ID"
az role assignment create --assignee-object-id "$PRINCIPAL_ID" --assignee-principal-type ServicePrincipal --role "Key Vault Secrets User" --scope "$KV_ID"

az acr build -r "$ACR" -t "develocrm-api:$IMAGE_TAG" -f backend/Dockerfile .
az acr build -r "$ACR" -t "develocrm-migrations:$IMAGE_TAG" -f backend/Dockerfile.migrations .
ACR_SERVER=$(az acr show -g "$RG" -n "$ACR" --query loginServer -o tsv)
az containerapp env create -g "$RG" -n "$ENVIRONMENT" -l "$LOCATION"
az containerapp job create -g "$RG" -n "$MIGRATION_JOB" --environment "$ENVIRONMENT" \
  --trigger-type Manual --replica-timeout 1800 --replica-retry-limit 0 \
  --image "$ACR_SERVER/develocrm-migrations:$IMAGE_TAG" --mi-user-assigned "$IDENTITY_ID" \
  --registry-server "$ACR_SERVER" --registry-identity "$IDENTITY_ID" \
  --secrets "database-url=keyvaultref:https://$KEYVAULT.vault.azure.net/secrets/database-url,identityref:$IDENTITY_ID" \
  --env-vars "DATABASE_URL=secretref:database-url"

# Job spusťte a ověřte před vytvořením/aktualizací runtime aplikace:
# az containerapp job start -g "$RG" -n "$MIGRATION_JOB"
# az containerapp job execution list -g "$RG" -n "$MIGRATION_JOB" -o table

az containerapp create -g "$RG" -n "$APP" --environment "$ENVIRONMENT" \
  --image "$ACR_SERVER/develocrm-api:$IMAGE_TAG" --target-port 3001 --ingress external \
  --min-replicas 1 --max-replicas 3 --user-assigned "$IDENTITY_ID" \
  --registry-server "$ACR_SERVER" --registry-identity "$IDENTITY_ID" \
  --secrets "database-url=keyvaultref:https://$KEYVAULT.vault.azure.net/secrets/database-url,identityref:$IDENTITY_ID" \
  --env-vars "DATABASE_URL=secretref:database-url" "DEVELOCRM_ENV=pilot" "ENTRA_CLIENT_ID=$API_CLIENT_ID" \
    "ENTRA_ALLOWED_TENANT_IDS=$ENTRA_TENANT_ID" "ENTRA_REQUIRED_SCOPE=access_as_user" \
    "CORS_ALLOWED_ORIGINS=$FRONTEND_ORIGIN" "DEVELOCRM_SEED_PROFILE=none" "PORT=3001"

echo "Připraveno. Workspace $WORKSPACE_ID se bootstrapuje až explicitním pilot:bootstrap."

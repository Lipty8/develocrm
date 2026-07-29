export type BackendConfig = {
  databaseUrl: string;
  entraClientId: string;
  entraAllowedTenantIds: Set<string>;
  entraRequiredScope:string;
  environment:"development"|"pilot"|"production"|"test";
  corsAllowedOrigins:Set<string>;
  port: number;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BackendConfig {
  const databaseUrl = required(env, "DATABASE_URL");
  const entraClientId = required(env, "ENTRA_CLIENT_ID");
  const entraAllowedTenantIds = new Set(
    (env.ENTRA_ALLOWED_TENANT_IDS ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
  const port = Number(env.PORT ?? 3001);
  const entraRequiredScope=env.ENTRA_REQUIRED_SCOPE?.trim()||"access_as_user";
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT musí být číslo od 1 do 65535");
  }
  const environment=(env.DEVELOCRM_ENV??"development") as BackendConfig["environment"];
  if(!["development","pilot","production","test"].includes(environment))throw new Error("DEVELOCRM_ENV má neplatnou hodnotu");
  const corsAllowedOrigins=new Set((env.CORS_ALLOWED_ORIGINS??"").split(",").map(value=>value.trim()).filter(Boolean));
  if((environment==="pilot"||environment==="production")&&!corsAllowedOrigins.size)throw new Error("Pilot a produkce vyžadují CORS_ALLOWED_ORIGINS");
  if((environment==="pilot"||environment==="production")&&!entraAllowedTenantIds.size)throw new Error("Pilot a produkce vyžadují ENTRA_ALLOWED_TENANT_IDS");
  return { databaseUrl, entraClientId, entraAllowedTenantIds, entraRequiredScope, environment, corsAllowedOrigins, port };
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`Chybí povinná proměnná ${key}`);
  return value;
}

export type BackendConfig = {
  databaseUrl: string;
  entraClientId: string;
  entraAllowedTenantIds: Set<string>;
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
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT musí být číslo od 1 do 65535");
  }
  return { databaseUrl, entraClientId, entraAllowedTenantIds, port };
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`Chybí povinná proměnná ${key}`);
  return value;
}

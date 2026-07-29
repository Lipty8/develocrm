import { buildApp } from "./app.js";
import { EntraTokenVerifier } from "./auth/entra.js";
import { loadConfig } from "./config.js";
import { Database } from "./database.js";

const config = loadConfig();
const database = new Database(config.databaseUrl);
const verifier = new EntraTokenVerifier(config.entraClientId, config.entraAllowedTenantIds);
const app = buildApp({ database, verifier, corsAllowedOrigins:config.corsAllowedOrigins });

const shutdown = async () => {
  await app.close();
  await database.close();
};
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);

await app.listen({ host: "0.0.0.0", port: config.port });

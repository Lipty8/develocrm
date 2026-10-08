import { buildApp } from "./app.js";
import { EntraTokenVerifier } from "./auth/entra.js";
import { loadConfig } from "./config.js";
import { Database } from "./database.js";
import { EntraMicrosoftGraphAdapter } from "./documents/graph-adapter.js";
import { ManagedIdentityGraphTokenProvider } from "./documents/managed-identity-token-provider.js";

const config = loadConfig();
const database = new Database(config.databaseUrl);
const verifier = new EntraTokenVerifier(config.entraClientId, config.entraAllowedTenantIds,config.entraRequiredScope);
const microsoftGraphAdapter=config.sharepointManagedIdentityClientId
  ?new EntraMicrosoftGraphAdapter(new ManagedIdentityGraphTokenProvider(config.sharepointManagedIdentityClientId))
  :undefined;
const app = buildApp({ database, verifier, corsAllowedOrigins:config.corsAllowedOrigins,microsoftGraphAdapter,sharepointManagedIdentityClientId:config.sharepointManagedIdentityClientId??undefined });

const shutdown = async () => {
  await app.close();
  await database.close();
};
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);

await app.listen({ host: "0.0.0.0", port: config.port });

import { serverDataMode } from "../../../lib/data-mode";

export async function GET(request: Request) {
  const mode = serverDataMode();
  if (mode === "browser") return Response.json({ mode });
  const clientId = process.env.DEVELOCRM_ENTRA_CLIENT_ID?.trim();
  const tenantId = process.env.DEVELOCRM_ENTRA_TENANT_ID?.trim();
  const authority = process.env.DEVELOCRM_ENTRA_AUTHORITY?.trim();
  const apiScope = process.env.DEVELOCRM_API_SCOPE?.trim();
  const requestUrl = new URL(request.url);
  const origin = process.env.DEVELOCRM_FRONTEND_ORIGIN?.trim() || requestUrl.origin;
  const redirectUri = process.env.DEVELOCRM_ENTRA_REDIRECT_URI?.trim() || `${origin}/dashboard`;
  const postLogoutRedirectUri = process.env.DEVELOCRM_ENTRA_POST_LOGOUT_REDIRECT_URI?.trim() || origin;
  const missing = [
    ["DEVELOCRM_ENTRA_CLIENT_ID", clientId],
    ["DEVELOCRM_ENTRA_TENANT_ID", tenantId],
    ["DEVELOCRM_ENTRA_AUTHORITY", authority],
    ["DEVELOCRM_API_SCOPE", apiScope],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) {
    return Response.json({ error: `Chybí konfigurace Entra: ${missing.join(", ")}` }, { status: 503 });
  }
  return Response.json({
    mode,
    clientId,
    tenantId,
    authority,
    apiScope,
    redirectUri,
    postLogoutRedirectUri,
  }, { headers: { "cache-control": "no-store" } });
}

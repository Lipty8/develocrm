import type { GraphTokenProvider } from "./graph-adapter.js";

type ManagedIdentityTokenResponse = {
  access_token?: unknown;
  expires_on?: unknown;
  expires_in?: unknown;
};

/** Uses the Container Apps identity endpoint; no Graph credential is stored in the app. */
export class ManagedIdentityGraphTokenProvider implements GraphTokenProvider {
  private cached: { token: string; expiresAt: number } | null = null;

  constructor(
    private readonly clientId: string,
    private readonly environment: NodeJS.ProcessEnv = process.env,
    private readonly request: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {
    if (!clientId.trim()) throw new Error("Chybí client ID spravované identity pro Microsoft Graph");
  }

  async getAccessToken(): Promise<string> {
    if (this.cached && this.cached.expiresAt - this.now() > 60_000) return this.cached.token;
    const endpoint = this.environment.IDENTITY_ENDPOINT;
    const header = this.environment.IDENTITY_HEADER;
    if (!endpoint || !header) throw new Error("Azure spravovaná identita není dostupná");

    const url = new URL(endpoint);
    url.searchParams.set("api-version", "2019-08-01");
    url.searchParams.set("resource", "https://graph.microsoft.com");
    url.searchParams.set("client_id", this.clientId);
    const response = await this.request(url, { headers: { "x-identity-header": header }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`Azure spravovaná identita odmítla Graph token (${response.status})`);

    const payload = await response.json() as ManagedIdentityTokenResponse;
    if (typeof payload.access_token !== "string" || !payload.access_token) throw new Error("Azure spravovaná identita nevrátila platný Graph token");
    const expiresAt = expiryTime(payload, this.now());
    this.cached = { token: payload.access_token, expiresAt };
    return payload.access_token;
  }
}

function expiryTime(payload: ManagedIdentityTokenResponse, now: number): number {
  const absolute = Number(payload.expires_on);
  if (Number.isFinite(absolute) && absolute > now / 1000) return absolute * 1000;
  const relative = Number(payload.expires_in);
  if (Number.isFinite(relative) && relative > 0) return now + relative * 1000;
  return now;
}

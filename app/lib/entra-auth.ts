"use client";

import {
  InteractionRequiredAuthError,
  PublicClientApplication,
  type AccountInfo,
  type AuthenticationResult,
  type Configuration,
  type RedirectRequest,
  type SilentRequest,
} from "@azure/msal-browser";
import { rememberClientDataMode } from "./data-mode";

export type EntraFrontendConfig = {
  mode: "api" | "browser";
  clientId?: string;
  tenantId?: string;
  authority?: string;
  apiScope?: string;
  redirectUri?: string;
  postLogoutRedirectUri?: string;
  buildVersion?: string;
};

type MsalClient = {
  initialize(): Promise<void>;
  handleRedirectPromise(): Promise<AuthenticationResult | null>;
  getActiveAccount(): AccountInfo | null;
  setActiveAccount(account: AccountInfo | null): void;
  getAllAccounts(): AccountInfo[];
  loginRedirect(request: RedirectRequest): Promise<void>;
  acquireTokenSilent(request: SilentRequest): Promise<AuthenticationResult>;
  acquireTokenRedirect(request: RedirectRequest): Promise<void>;
  logoutRedirect(request: { account?: AccountInfo; postLogoutRedirectUri?: string }): Promise<void>;
};

export type EntraAuthSnapshot = {
  mode: "api" | "browser";
  authenticated: boolean;
  account: AccountInfo | null;
  buildVersion?: string;
};

export type EntraAuthDependencies = {
  loadConfig?: () => Promise<EntraFrontendConfig>;
  createClient?: (configuration: Configuration) => MsalClient;
};

export class EntraAuthController {
  private client: MsalClient | null = null;
  private config: EntraFrontendConfig | null = null;
  private initialization: Promise<EntraAuthSnapshot> | null = null;
  private readonly cachedTokens = new Map<string,AuthenticationResult>();
  private readonly tokenRequests = new Map<string,Promise<AuthenticationResult>>();

  constructor(private readonly dependencies: EntraAuthDependencies = {}) {}

  initialize(): Promise<EntraAuthSnapshot> {
    if (!this.initialization) this.initialization = this.initializeOnce();
    return this.initialization;
  }

  private async initializeOnce(): Promise<EntraAuthSnapshot> {
    this.config = await (this.dependencies.loadConfig ?? loadFrontendConfig)();
    if (this.config.mode === "browser") {
      rememberClientDataMode("prototype-fallback");
      return { mode: "browser", authenticated: true, account: null, buildVersion: this.config.buildVersion };
    }
    rememberClientDataMode("production-api");
    validateConfig(this.config);
    const configuration: Configuration = {
      auth: {
        clientId: this.config.clientId as string,
        authority: this.config.authority as string,
        redirectUri: this.config.redirectUri as string,
        postLogoutRedirectUri: this.config.postLogoutRedirectUri as string,
        navigateToLoginRequestUrl: true,
      },
      cache: { cacheLocation: "sessionStorage" },
      system: { allowPlatformBroker: false },
    };
    this.client = (this.dependencies.createClient ?? ((value) => new PublicClientApplication(value)))(configuration);
    await this.client.initialize();
    const redirectResult = await this.client.handleRedirectPromise();
    const account = redirectResult?.account ?? this.client.getActiveAccount() ?? this.client.getAllAccounts()[0] ?? null;
    if (account) this.client.setActiveAccount(account);
    return { mode: "api", authenticated: Boolean(account), account, buildVersion: this.config.buildVersion };
  }

  async login(): Promise<void> {
    const snapshot = await this.initialize();
    if (snapshot.mode === "browser") return;
    await this.requireClient().loginRedirect({ scopes: [this.requireScope()], prompt: "select_account" });
  }

  async getAccessToken(): Promise<string | null> {
    await this.initialize();
    return this.acquireAccessToken(this.requireScope(),false);
  }

  async refreshAccessToken(): Promise<string | null> {
    await this.initialize();
    const scope=this.requireScope();
    this.cachedTokens.delete(scope);
    return this.acquireAccessToken(scope,true);
  }

  async getDirectoryAccessToken():Promise<string|null>{
    return this.acquireAccessToken("https://graph.microsoft.com/User.ReadBasic.All",false);
  }

  private async acquireAccessToken(scope:string,forceRefreshRequested: boolean): Promise<string | null> {
    const snapshot = await this.initialize();
    if (snapshot.mode === "browser") return null;
    const client = this.requireClient();
    const account = client.getActiveAccount() ?? client.getAllAccounts()[0] ?? null;
    if (!account) throw new Error("AUTHENTICATION_REQUIRED");
    client.setActiveAccount(account);
    const cachedToken=this.cachedTokens.get(scope);
    if (cachedToken?.accessToken && tokenIsFresh(cachedToken)) return cachedToken.accessToken;
    const forceRefresh = forceRefreshRequested || Boolean(
      cachedToken?.expiresOn && cachedToken.expiresOn.getTime() - Date.now() <= 5 * 60_000,
    );
    try {
      let tokenRequest=this.tokenRequests.get(scope);
      if(!tokenRequest){
        tokenRequest=client.acquireTokenSilent({account,scopes:[scope],forceRefresh}).finally(()=>{this.tokenRequests.delete(scope);});
        this.tokenRequests.set(scope,tokenRequest);
      }
      const token=await tokenRequest;
      this.cachedTokens.set(scope,token);
      if (!token.accessToken) throw new Error("Přístupový token nebyl vydán");
      return token.accessToken;
    } catch (error) {
      if (error instanceof InteractionRequiredAuthError || isInteractionRequired(error)) {
        await client.acquireTokenRedirect({ account, scopes: [scope] });
        throw new Error("AUTHENTICATION_REDIRECT");
      }
      throw error;
    }
  }

  async logout(): Promise<void> {
    const snapshot = await this.initialize();
    if (snapshot.mode === "browser") return;
    const client = this.requireClient();
    await client.logoutRedirect({
      account: client.getActiveAccount() ?? undefined,
      postLogoutRedirectUri: this.config?.postLogoutRedirectUri,
    });
  }

  resetForRetry(): void {
    this.initialization = null;
    this.client = null;
    this.config = null;
    this.cachedTokens.clear();
    this.tokenRequests.clear();
  }

  private requireClient(): MsalClient {
    if (!this.client) throw new Error("MSAL není inicializován");
    return this.client;
  }

  private requireScope(): string {
    if (!this.config?.apiScope) throw new Error("Chybí DEVELOCRM_API_SCOPE");
    return this.config.apiScope;
  }
}

function tokenIsFresh(result: AuthenticationResult): boolean {
  return !result.expiresOn || result.expiresOn.getTime() - Date.now() > 5 * 60_000;
}

async function loadFrontendConfig(): Promise<EntraFrontendConfig> {
  const response = await fetch("/api/auth/config", { cache: "no-store" });
  const payload = await response.json().catch(() => ({})) as EntraFrontendConfig & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Konfiguraci přihlášení se nepodařilo načíst");
  return payload;
}

function validateConfig(config: EntraFrontendConfig): void {
  const missing = [
    ["DEVELOCRM_ENTRA_CLIENT_ID", config.clientId],
    ["DEVELOCRM_ENTRA_TENANT_ID", config.tenantId],
    ["DEVELOCRM_ENTRA_AUTHORITY", config.authority],
    ["DEVELOCRM_API_SCOPE", config.apiScope],
    ["redirect URI", config.redirectUri],
    ["post logout redirect URI", config.postLogoutRedirectUri],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) throw new Error(`Chybí konfigurace přihlášení: ${missing.join(", ")}`);
}

function isInteractionRequired(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "errorCode" in error &&
    ["interaction_required", "login_required", "consent_required", "timed_out"].includes(String(error.errorCode)));
}

export const entraAuth = new EntraAuthController();

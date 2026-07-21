import { createRemoteJWKSet, decodeJwt, jwtVerify } from "jose";

export type EntraIdentity = {
  issuer: string;
  subject: string;
  entraTenantId: string;
  email: string;
  displayName: string;
};

const tenantIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class EntraTokenVerifier {
  private readonly jwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

  constructor(
    private readonly audience: string,
    private readonly allowedTenantIds: Set<string>,
  ) {}

  async verify(authorizationHeader?: string): Promise<EntraIdentity> {
    const token = bearerToken(authorizationHeader);
    const unverified = decodeJwt(token);
    const entraTenantId = typeof unverified.tid === "string" ? unverified.tid.toLowerCase() : "";
    if (!tenantIdPattern.test(entraTenantId)) throw new Error("Token neobsahuje platné tid");
    if (this.allowedTenantIds.size > 0 && !this.allowedTenantIds.has(entraTenantId)) {
      throw new Error("Entra tenant není povolen");
    }

    const authority = `https://login.microsoftonline.com/${entraTenantId}`;
    const issuer = `${authority}/v2.0`;
    let jwks = this.jwks.get(entraTenantId);
    if (!jwks) {
      jwks = createRemoteJWKSet(new URL(`${authority}/discovery/v2.0/keys`));
      this.jwks.set(entraTenantId, jwks);
    }
    const { payload } = await jwtVerify(token, jwks, { audience: this.audience, issuer });
    const subject = typeof payload.oid === "string" ? payload.oid : payload.sub;
    if (!subject) throw new Error("Token neobsahuje stabilní identifikátor uživatele");
    const email = firstString(payload.preferred_username, payload.email, payload.upn);
    if (!email) throw new Error("Token neobsahuje e-mail uživatele");
    const displayName = firstString(payload.name, email) as string;
    return { issuer, subject, entraTenantId, email, displayName };
  }
}

function bearerToken(header?: string): string {
  const match = header?.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new Error("Chybí Bearer token");
  return match[1];
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.length > 0);
}

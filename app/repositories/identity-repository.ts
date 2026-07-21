export type IdentitySession = {
  user: { id: string; email: string; displayName: string };
  workspace: {
    tenantId: string;
    tenantName: string;
    roles: string[];
    permissions: string[];
  };
  source: "production-api" | "prototype-fallback";
};

const prototypeSession: IdentitySession = {
  user: { id: "prototype-iva", email: "iva@develo.example", displayName: "Iva Novotná" },
  workspace: {
    tenantId: "prototype-develo-group",
    tenantName: "Develo Group",
    roles: ["back_office"],
    permissions: ["tenant.read", "membership.read", "role.read"],
  },
  source: "prototype-fallback",
};

export interface IdentityRepository {
  getSession(signal?: AbortSignal): Promise<IdentitySession>;
}

export class ApiIdentityRepository implements IdentityRepository {
  async getSession(signal?: AbortSignal): Promise<IdentitySession> {
    const response = await fetch("/api/identity/session", { signal, cache: "no-store" });
    if (!response.ok) throw new Error("Identitu se nepodařilo načíst");
    return response.json() as Promise<IdentitySession>;
  }
}

export const identityRepository: IdentityRepository = new ApiIdentityRepository();
export { prototypeSession };

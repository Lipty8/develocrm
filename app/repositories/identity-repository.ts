export type IdentitySession = {
  user: { id: string; email: string; displayName: string };
  workspace: {
    tenantId: string;
    tenantName: string;
    roles: string[];
    permissions: string[];
    projectScopes?: Array<{ projectId: string; projectName: string; roles: string[] }>;
  };
  source: "production-api" | "prototype-fallback";
};

const prototypeSession: IdentitySession = {
  user: { id: "prototype-iva", email: "iva@develo.example", displayName: "Iva Novotná" },
  workspace: {
    tenantId: "prototype-develo-group",
    tenantName: "Develo Group",
    roles: ["admin"],
    permissions: ["tenant.read","membership.read","membership.manage","role.read","role.manage","users.manage","project.read","project.manage","projects.change_manager","projects.change_status","unit.read","unit.manage","accessory.read","accessory.manage","clients.read","clients.manage","clients.export","interests.manage","sales_case.read","sales_case.manage","holds.manage","holds.cancel","price.read","price.manage","prices.change","prices.approve","contract.read","contract.manage","contract.approve","contract.sign","documents.view","documents.upload","documents.edit_metadata","documents.archive","documents.manage","documents.view_sensitive"],
    projectScopes: [],
  },
  source: "prototype-fallback",
};

export interface IdentityRepository {
  getSession(signal?: AbortSignal): Promise<IdentitySession>;
  listWorkspaces(signal?: AbortSignal): Promise<Array<{tenantId:string;tenantName:string;tenantSlug:string}>>;
}

export class ApiIdentityRepository implements IdentityRepository {
  async getSession(signal?: AbortSignal): Promise<IdentitySession> {
    const response = await fetch("/api/identity/session", { signal, cache: "no-store" });
    if (!response.ok) throw new Error("Identitu se nepodařilo načíst");
    return response.json() as Promise<IdentitySession>;
  }
  async listWorkspaces(signal?:AbortSignal){const response=await fetch("/api/identity/workspaces",{signal,cache:"no-store"});if(!response.ok)return[{tenantId:prototypeSession.workspace.tenantId,tenantName:prototypeSession.workspace.tenantName,tenantSlug:"develo-group"}];const payload=await response.json() as {workspaces:Array<{tenantId:string;tenantName:string;tenantSlug:string}>};return payload.workspaces;}
}

export const identityRepository: IdentityRepository = new ApiIdentityRepository();
export { prototypeSession };

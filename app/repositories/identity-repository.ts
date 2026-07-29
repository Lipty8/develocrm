import { rememberClientDataMode } from "../lib/data-mode";

export type IdentitySession = {
  user: { id: string; email: string; displayName: string;jobTitle?:string;phone?:string;initials?:string;avatarUrl?:string;language?:"cs"|"en";timezone?:string;notifications?:{email:boolean;inApp:boolean} };
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
    permissions: ["projects.read","projects.create","projects.update","units.read","units.update","accessories.read","accessories.update","clients.read_all","clients.read_contact_details","clients.create","clients.update","interests.manage","sales_cases.read","sales_cases.manage","holds.create","holds.cancel","holds.confirm","prices.read","prices.propose","contracts.read","contracts.create","contracts.update","contracts.mark_ready","contracts.record_signature","documents.read","documents.create","documents.update","documents.review","documents.archive","payments.read","payments.manage","handovers.read","handovers.manage","complaints.read","complaints.manage","tasks.read","tasks.manage","users.manage","roles.manage","system.manage","integrations.manage","exports.run","audit.read"],
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
    if (!response.ok){const payload=await response.json().catch(()=>({})) as {error?:string;correlationId?:string};throw new Error(`${payload.error||"Identitu se nepodařilo načíst"}${payload.correlationId?` · ID chyby ${payload.correlationId}`:""}`);}
    const session=await response.json() as IdentitySession;
    rememberClientDataMode(session.source);
    return session;
  }
  async listWorkspaces(signal?:AbortSignal){const response=await fetch("/api/identity/workspaces",{signal,cache:"no-store"});if(!response.ok)return[{tenantId:prototypeSession.workspace.tenantId,tenantName:prototypeSession.workspace.tenantName,tenantSlug:"develo-group"}];const payload=await response.json() as {workspaces:Array<{tenantId:string;tenantName:string;tenantSlug:string}>};return payload.workspaces;}
}

export const identityRepository: IdentityRepository = new ApiIdentityRepository();
export { prototypeSession };

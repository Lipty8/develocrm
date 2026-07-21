import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import type { EntraIdentity } from "./auth/entra.js";
import { EntraTokenVerifier } from "./auth/entra.js";
import type { Database } from "./database.js";
import { IamRepository } from "./iam/repository.js";
import { InventoryRepository } from "./inventory/repository.js";
import { CommercialStatusService } from "./inventory/commercial-status-service.js";

export function buildApp(dependencies: { database: Database; verifier: EntraTokenVerifier }): FastifyInstance {
  const app = Fastify({ logger: true });
  const repository = new IamRepository(dependencies.database);
  const inventory = new InventoryRepository(dependencies.database);
  const commercialStatus = new CommercialStatusService(dependencies.database);

  app.get("/health", async () => ({ status: "ok", block: "B" }));

  app.get("/v1/session/workspaces", async (request, reply) => {
    try {
      const identity = await authenticate(request, dependencies.verifier);
      const user = await repository.resolveUser(identity);
      return { user, workspaces: await repository.listWorkspaces(user) };
    } catch {
      return reply.code(401).send({ error: "Neplatné přihlášení" });
    }
  });

  app.get("/v1/session", async (request, reply) => {
    try {
      const identity = await authenticate(request, dependencies.verifier);
      const tenantId = headerValue(request.headers["x-tenant-id"]);
      if (!tenantId) return reply.code(400).send({ error: "Chybí x-tenant-id" });
      const user = await repository.resolveUser(identity);
      const session = await repository.getSession(user, identity, tenantId);
      if (!session) return reply.code(403).send({ error: "Workspace není uživateli přístupný" });
      return session;
    } catch {
      return reply.code(401).send({ error: "Neplatné přihlášení" });
    }
  });

  app.get("/v1/roles", async (request, reply) => {
    try {
      const identity = await authenticate(request, dependencies.verifier);
      const tenantId = headerValue(request.headers["x-tenant-id"]);
      if (!tenantId) return reply.code(400).send({ error: "Chybí x-tenant-id" });
      const user = await repository.resolveUser(identity);
      const session = await repository.getSession(user, identity, tenantId);
      if (!session?.workspace.permissions.includes("role.read")) return reply.code(403).send({ error: "Chybí oprávnění role.read" });
      const roles = await dependencies.database.withContext({ tenantId, userId: user.id }, async (client) => {
        const result = await client.query("SELECT id, code, name, description, is_system FROM roles WHERE status = 'active' ORDER BY name");
        return result.rows;
      });
      return { roles };
    } catch {
      return reply.code(401).send({ error: "Neplatné přihlášení" });
    }
  });

  app.get("/v1/catalog", async (request, reply) => {
    try {
      const identity = await authenticate(request, dependencies.verifier);
      const tenantId = headerValue(request.headers["x-tenant-id"]);
      if (!tenantId) return reply.code(400).send({ error: "Chybí x-tenant-id" });
      const user = await repository.resolveUser(identity);
      const session = await repository.getSession(user, identity, tenantId);
      if (!session) return reply.code(403).send({ error: "Workspace není uživateli přístupný" });
      return inventory.getCatalog({ tenantId, userId: user.id, membershipId: session.workspace.membershipId });
    } catch {
      return reply.code(401).send({ error: "Neplatné přihlášení" });
    }
  });

  app.post<{ Params: { unitId: string }; Body: { reason?: string } }>("/v1/units/:unitId/block", async (request, reply) => {
    try {
      const identity = await authenticate(request, dependencies.verifier);
      const tenantId = headerValue(request.headers["x-tenant-id"]);
      if (!tenantId) return reply.code(400).send({ error: "Chybí x-tenant-id" });
      const user = await repository.resolveUser(identity);
      const session = await repository.getSession(user, identity, tenantId);
      if (!session || !await inventory.hasUnitPermission({ tenantId, userId: user.id,
        membershipId: session.workspace.membershipId, unitId: request.params.unitId, permission: "commercial_status.manage" }))
        return reply.code(403).send({ error: "Chybí oprávnění" });
      const eventId = await commercialStatus.block({ tenantId, unitId: request.params.unitId,
        actorMembershipId: session.workspace.membershipId, actorUserId: user.id, reason: request.body.reason ?? "" });
      return reply.code(201).send({ eventId });
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : "Přechod se nezdařil" });
    }
  });

  app.post<{ Params: { unitId: string }; Body: { reason?: string } }>("/v1/units/:unitId/unblock", async (request, reply) => {
    try {
      const identity = await authenticate(request, dependencies.verifier);
      const tenantId = headerValue(request.headers["x-tenant-id"]);
      if (!tenantId) return reply.code(400).send({ error: "Chybí x-tenant-id" });
      const user = await repository.resolveUser(identity);
      const session = await repository.getSession(user, identity, tenantId);
      if (!session || !await inventory.hasUnitPermission({ tenantId, userId: user.id,
        membershipId: session.workspace.membershipId, unitId: request.params.unitId, permission: "commercial_status.manage" }))
        return reply.code(403).send({ error: "Chybí oprávnění" });
      const eventId = await commercialStatus.unblock({ tenantId, unitId: request.params.unitId,
        actorMembershipId: session.workspace.membershipId, actorUserId: user.id, reason: request.body.reason ?? "" });
      return reply.code(201).send({ eventId });
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : "Přechod se nezdařil" });
    }
  });

  return app;
}

async function authenticate(request: FastifyRequest, verifier: EntraTokenVerifier): Promise<EntraIdentity> {
  return verifier.verify(request.headers.authorization);
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

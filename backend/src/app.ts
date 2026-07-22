import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import type { EntraIdentity } from "./auth/entra.js";
import { EntraTokenVerifier } from "./auth/entra.js";
import type { Database } from "./database.js";
import { IamRepository } from "./iam/repository.js";
import { InventoryRepository } from "./inventory/repository.js";
import { CommercialStatusService } from "./inventory/commercial-status-service.js";
import { SalesRepository } from "./sales/repository.js";
import { HoldService } from "./sales/hold-service.js";
import { CommercialRepository } from "./commercial/repository.js";
import { CommercialService } from "./commercial/service.js";

export function buildApp(dependencies: { database: Database; verifier: EntraTokenVerifier }): FastifyInstance {
  const app = Fastify({ logger: true });
  const repository = new IamRepository(dependencies.database);
  const inventory = new InventoryRepository(dependencies.database);
  const commercialStatus = new CommercialStatusService(dependencies.database);
  const sales = new SalesRepository(dependencies.database);
  const holds = new HoldService(dependencies.database);
  const commercial = new CommercialRepository(dependencies.database);
  const commercialCommands = new CommercialService(dependencies.database);

  app.get("/health", async () => ({ status: "ok", block: "D" }));

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

  app.patch<{Params:{projectId:string};Body:{name:string;location?:string|null;lifecycleStatus:string;managerMembershipId?:string|null;plannedHandoverFrom?:string|null;plannedHandoverTo?:string|null}}>("/v1/projects/:projectId",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.send(await inventory.updateProject({...context,projectId:request.params.projectId,...request.body}));}catch(error){return reply.code(409).send({error:error instanceof Error?error.message:"Projekt nelze upravit"});}
  });
  app.patch<{Params:{unitId:string};Body:{layout?:string|null;floorLabel?:string|null;floorNumber?:number|null;areaM2:number;usableAreaM2?:number|null;orientation?:string|null;balconyM2?:number|null;terraceM2?:number|null;gardenM2?:number|null}}>("/v1/units/:unitId",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.send(await inventory.updateUnit({...context,unitId:request.params.unitId,...request.body}));}catch(error){return reply.code(409).send({error:error instanceof Error?error.message:"Jednotku nelze upravit"});}
  });
  app.post<{Params:{unitId:string};Body:{accessoryId:string;validFrom?:string}}>("/v1/units/:unitId/accessories",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.code(201).send(await inventory.assignAccessory({...context,unitId:request.params.unitId,...request.body}));}catch(error){return reply.code(409).send({error:error instanceof Error?error.message:"Příslušenství nelze přiřadit"});}
  });
  app.delete<{Params:{assignmentId:string};Querystring:{validTo?:string}}>("/v1/accessory-assignments/:assignmentId",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.send(await inventory.removeAccessory({...context,assignmentId:request.params.assignmentId,validTo:request.query.validTo}));}catch(error){return reply.code(409).send({error:error instanceof Error?error.message:"Příslušenství nelze odebrat"});}
  });
  app.patch<{Params:{partyId:string};Body:{displayName:string}}>("/v1/parties/:partyId",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.send(await sales.updateParty({...context,partyId:request.params.partyId,...request.body}));}catch(error){return reply.code(409).send({error:error instanceof Error?error.message:"Klienta nelze upravit"});}
  });
  app.post<{Params:{partyId:string};Body:{contactType:string;value:string;label?:string|null;isPrimary?:boolean}}>("/v1/parties/:partyId/contacts",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.code(201).send(await sales.upsertContact({...context,partyId:request.params.partyId,...request.body}));}catch(error){return reply.code(409).send({error:error instanceof Error?error.message:"Kontakt nelze uložit"});}
  });

  app.get("/v1/clients", async (request, reply) => {
    try {
      const identity = await authenticate(request,dependencies.verifier);
      const tenantId = headerValue(request.headers["x-tenant-id"]);
      if (!tenantId) return reply.code(400).send({ error:"Chybí x-tenant-id" });
      const user = await repository.resolveUser(identity);
      const session = await repository.getSession(user,identity,tenantId);
      if (!session) return reply.code(403).send({ error:"Workspace není uživateli přístupný" });
      return sales.getDirectory({ tenantId,userId:user.id,membershipId:session.workspace.membershipId });
    } catch { return reply.code(401).send({ error:"Neplatné přihlášení" }); }
  });

  app.get("/v1/commercial", async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return commercial.getSnapshot(context);}
    catch{return reply.code(401).send({error:"Neplatné přihlášení"});}
  });

  app.post<{Params:{unitId:string};Body:{priceType:string;amount:number;currency?:string;validFrom:string;reason:string;approverMembershipId?:string}}>("/v1/units/:unitId/prices",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.code(201).send(await commercialCommands.recordPrice({...context,unitId:request.params.unitId,...request.body,currency:request.body.currency??"CZK"}));}
    catch(error){return reply.code(409).send({error:error instanceof Error?error.message:"Cenu nelze zaznamenat"});}
  });

  app.post<{Body:{salesCaseId:string;type:string;reference:string;title:string;parentContractId?:string}}>("/v1/contracts",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.code(201).send(await commercialCommands.createContract({...context,...request.body}));}
    catch(error){return reply.code(409).send({error:error instanceof Error?error.message:"Smlouvu nelze vytvořit"});}
  });
  app.post<{Params:{contractId:string};Body:{name:string;source?:string;basedOnVersionId?:string;generationPayload?:unknown}}>("/v1/contracts/:contractId/versions",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.code(201).send(await commercialCommands.createVersion({...context,contractId:request.params.contractId,...request.body,source:request.body.source??"manual"}));}
    catch(error){return reply.code(409).send({error:error instanceof Error?error.message:"Verzi nelze vytvořit"});}
  });
  app.post<{Params:{contractId:string};Body:{to:string;reason:string}}>("/v1/contracts/:contractId/status",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return await commercialCommands.transition({...context,contractId:request.params.contractId,...request.body});}
    catch(error){return reply.code(409).send({error:error instanceof Error?error.message:"Stav smlouvy nelze změnit"});}
  });
  app.post<{Params:{contractPartyId:string};Body:{versionId:string;reason:string}}>("/v1/contract-parties/:contractPartyId/sign",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return await commercialCommands.sign({...context,contractPartyId:request.params.contractPartyId,...request.body});}
    catch(error){return reply.code(409).send({error:error instanceof Error?error.message:"Podpis nelze zaznamenat"});}
  });

  app.post<{ Body:{ partyIds?:string[];format?:"json"|"bcc"|"csv"} }>("/v1/clients/export", async (request,reply) => {
    try {
      const identity = await authenticate(request,dependencies.verifier);
      const tenantId = headerValue(request.headers["x-tenant-id"]);
      if (!tenantId) return reply.code(400).send({ error:"Chybí x-tenant-id" });
      const user = await repository.resolveUser(identity);
      const session = await repository.getSession(user,identity,tenantId);
      if (!session) return reply.code(403).send({ error:"Workspace není uživateli přístupný" });
      const clients = await sales.exportContacts({ tenantId,userId:user.id,membershipId:session.workspace.membershipId,partyIds:request.body.partyIds });
      if (request.body.format==="bcc") return { value:clients.map((item) => item.email).filter(Boolean).join("; "),count:clients.length };
      if (request.body.format==="csv") {
        const rows = [["Jméno / název","E-mail","Telefon","Projekt","Jednotka","Stav klienta"],...clients.map((item) => [item.name,item.email,item.phone,item.projects,item.units.join(", "),item.state])];
        return { value:"\ufeff"+rows.map((row) => row.map(csvCell).join(";")).join("\n"),count:clients.length };
      }
      return { clients,count:clients.length };
    } catch { return reply.code(403).send({ error:"Export není v tomto rozsahu povolen" }); }
  });

  app.post<{ Params:{ unitId:string }; Body:{ type:"pre_reservation"|"reservation";partyIds:string[];expiresAt:string;interestId?:string;idempotencyKey:string;reason:string } }>("/v1/units/:unitId/holds", async (request,reply) => {
    try {
      const identity=await authenticate(request,dependencies.verifier); const tenantId=headerValue(request.headers["x-tenant-id"]);
      if (!tenantId) return reply.code(400).send({error:"Chybí x-tenant-id"}); const user=await repository.resolveUser(identity); const session=await repository.getSession(user,identity,tenantId);
      if (!session || !await inventory.hasUnitPermission({tenantId,userId:user.id,membershipId:session.workspace.membershipId,unitId:request.params.unitId,permission:"holds.manage"})) return reply.code(403).send({error:"Chybí oprávnění holds.manage"});
      return reply.code(201).send(await holds.create({tenantId,userId:user.id,unitId:request.params.unitId,membershipId:session.workspace.membershipId,...request.body}));
    } catch(error) { return reply.code(409).send({error:error instanceof Error?error.message:"Rezervaci nelze vytvořit"}); }
  });

  app.post<{ Params:{ holdId:string }; Body:{ expiresAt:string;idempotencyKey:string;reason:string } }>("/v1/holds/:holdId/convert", async (request,reply) => {
    try { const identity=await authenticate(request,dependencies.verifier); const tenantId=headerValue(request.headers["x-tenant-id"]); if(!tenantId)return reply.code(400).send({error:"Chybí x-tenant-id"}); const user=await repository.resolveUser(identity); const session=await repository.getSession(user,identity,tenantId);
      if(!session||!await sales.hasHoldPermission({tenantId,userId:user.id,membershipId:session.workspace.membershipId,holdId:request.params.holdId,permission:"holds.manage"}))return reply.code(403).send({error:"Chybí oprávnění holds.manage"});
      return reply.send(await holds.convert({tenantId,userId:user.id,holdId:request.params.holdId,membershipId:session.workspace.membershipId,...request.body}));
    } catch(error){return reply.code(409).send({error:error instanceof Error?error.message:"Převod rezervace se nezdařil"});}
  });

  app.post<{ Params:{ holdId:string }; Body:{ reason:string } }>("/v1/holds/:holdId/cancel", async (request,reply) => {
    try { const identity=await authenticate(request,dependencies.verifier); const tenantId=headerValue(request.headers["x-tenant-id"]); if(!tenantId)return reply.code(400).send({error:"Chybí x-tenant-id"}); const user=await repository.resolveUser(identity); const session=await repository.getSession(user,identity,tenantId);
      if(!session||!await sales.hasHoldPermission({tenantId,userId:user.id,membershipId:session.workspace.membershipId,holdId:request.params.holdId,permission:"holds.manage"}))return reply.code(403).send({error:"Chybí oprávnění holds.manage"});
      return reply.send(await holds.cancel({tenantId,userId:user.id,holdId:request.params.holdId,membershipId:session.workspace.membershipId,reason:request.body.reason}));
    } catch(error){return reply.code(409).send({error:error instanceof Error?error.message:"Zrušení rezervace se nezdařilo"});}
  });

  app.post<{ Params:{ holdId:string } }>("/v1/holds/:holdId/expire", async (request,reply) => {
    try { const identity=await authenticate(request,dependencies.verifier); const tenantId=headerValue(request.headers["x-tenant-id"]); if(!tenantId)return reply.code(400).send({error:"Chybí x-tenant-id"}); const user=await repository.resolveUser(identity); const session=await repository.getSession(user,identity,tenantId);
      if(!session||!await sales.hasHoldPermission({tenantId,userId:user.id,membershipId:session.workspace.membershipId,holdId:request.params.holdId,permission:"holds.manage"}))return reply.code(403).send({error:"Chybí oprávnění holds.manage"});
      return reply.send(await holds.expire({tenantId,userId:user.id,holdId:request.params.holdId,membershipId:session.workspace.membershipId}));
    } catch(error){return reply.code(409).send({error:error instanceof Error?error.message:"Expirace rezervace se nezdařila"});}
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

function csvCell(value:string):string { return `"${value.replaceAll('"','""')}"`; }

async function sessionContext(request:FastifyRequest,verifier:EntraTokenVerifier,repository:IamRepository){
  const identity=await authenticate(request,verifier);const tenantId=headerValue(request.headers["x-tenant-id"]);if(!tenantId)return null;
  const user=await repository.resolveUser(identity);const session=await repository.getSession(user,identity,tenantId);if(!session)return null;
  return {tenantId,userId:user.id,membershipId:session.workspace.membershipId};
}

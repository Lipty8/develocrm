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
import { ActivityRepository } from "./activity/repository.js";
import { TaskRepository } from "./tasks/repository.js";
import { DocumentRepository } from "./documents/repository.js";
import { HandoverRepository } from "./handovers/repository.js";
import { PaymentRepository } from "./payments/repository.js";
import { PaymentService } from "./payments/service.js";
import { ClientChangeRepository } from "./client-changes/repository.js";

const verifiedIdentities = new WeakMap<FastifyRequest, EntraIdentity>();

export function buildApp(dependencies: { database: Database; verifier: EntraTokenVerifier; corsAllowedOrigins?:Set<string> }): FastifyInstance {
  const app = Fastify({ logger: true,trustProxy:true });
  const repository = new IamRepository(dependencies.database);
  const inventory = new InventoryRepository(dependencies.database);
  const commercialStatus = new CommercialStatusService(dependencies.database);
  const sales = new SalesRepository(dependencies.database);
  const holds = new HoldService(dependencies.database);
  const commercial = new CommercialRepository(dependencies.database);
  const commercialCommands = new CommercialService(dependencies.database);
  const activities = new ActivityRepository(dependencies.database);
  const taskRepository = new TaskRepository(dependencies.database);
  const documentRepository = new DocumentRepository(dependencies.database);
  const handoverRepository = new HandoverRepository(dependencies.database);
  const paymentRepository = new PaymentRepository(dependencies.database);
  const paymentService = new PaymentService(dependencies.database);
  const clientChangeRepository = new ClientChangeRepository(dependencies.database);

  const rateWindows=new Map<string,{startedAt:number;count:number}>();
  app.addHook("onRequest",async(request,reply)=>{
    reply.header("x-correlation-id",request.id);
    const origin=headerValue(request.headers.origin);
    if(origin){
      if(!dependencies.corsAllowedOrigins?.has(origin))return reply.code(403).send({error:"Nepovolený původ požadavku",correlationId:request.id});
      reply.header("access-control-allow-origin",origin).header("vary","Origin");
    }
    const now=Date.now();const current=rateWindows.get(request.ip);
    if(!current||now-current.startedAt>=60_000)rateWindows.set(request.ip,{startedAt:now,count:1});
    else if(++current.count>300)return reply.code(429).send({error:"Příliš mnoho požadavků",correlationId:request.id});
  });
  app.options("*",async(request,reply)=>reply.header("access-control-allow-methods","GET,POST,PATCH,DELETE,OPTIONS").header("access-control-allow-headers","authorization,content-type,x-tenant-id,x-correlation-id").code(204).send());
  app.addHook("preHandler",async(request,reply)=>{
    if(!request.url.startsWith("/v1/"))return;
    try{
      verifiedIdentities.set(request,await dependencies.verifier.verify(request.headers.authorization));
    }catch(error){
      return reply.code(401).send({
        error:error instanceof Error?error.message:"Neplatné přihlášení",
        correlationId:request.id,
      });
    }
  });
  app.get("/health", async () => ({ status: "ok", service: "develocrm-api" }));
  app.get("/ready", async (_request,reply) => {
    try {
      await dependencies.database.ping();
      return { status:"ready", database:"reachable" };
    } catch {
      return reply.code(503).send({status:"not_ready",database:"unreachable"});
    }
  });

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

  app.patch<{Body:{displayName:string;jobTitle:string;phone:string;initials:string;language:"cs"|"en";timezone:string;notifications:{email:boolean;inApp:boolean}}}>("/v1/profile",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není přístupný"});return{user:await repository.updateOwnProfile({...context,...request.body})};}
    catch(error){return reply.code(409).send({error:error instanceof Error?error.message:"Profil nelze uložit"});}
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

  app.get("/v1/admin", async(request,reply)=>{
    try{
      const identity=await authenticate(request,dependencies.verifier);const tenantId=headerValue(request.headers["x-tenant-id"]);
      if(!tenantId)return reply.code(400).send({error:"Chybí x-tenant-id"});
      const user=await repository.resolveUser(identity);const session=await repository.getSession(user,identity,tenantId);
      if(!session?.workspace.permissions.includes("users.manage"))return reply.code(403).send({error:"Chybí oprávnění users.manage"});
      return repository.adminSnapshot({tenantId,userId:user.id});
    }catch(error){return reply.code(403).send({error:error instanceof Error?error.message:"Administraci nelze načíst"});}
  });
  app.post<{Body:{name:string;email:string;jobTitle?:string;workPhone?:string;status:"invited";roleIds:string[];projectIds:string[]}}>("/v1/admin/users",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není přístupný"});return reply.code(201).send(await repository.inviteMember({...context,...request.body}));}
    catch(error){return reply.code(permissionError(error)?403:409).send({error:error instanceof Error?error.message:"Pozvánku nelze vytvořit"});}
  });
  app.patch<{Params:{membershipId:string};Body:{name:string;email:string;jobTitle?:string;workPhone?:string;status:string;roleIds:string[];projectIds:string[]}}>("/v1/admin/users/:membershipId",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není přístupný"});return repository.updateMember({...context,targetMembershipId:request.params.membershipId,...request.body});}
    catch(error){return reply.code(permissionError(error)?403:409).send({error:error instanceof Error?error.message:"Uživatele nelze upravit"});}
  });
  app.patch<{Params:{roleId:string};Body:{permissionCodes:string[]}}>("/v1/admin/roles/:roleId",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není přístupný"});return repository.setRolePermissions({...context,roleId:request.params.roleId,permissionCodes:request.body.permissionCodes});}
    catch(error){return reply.code(permissionError(error)?403:409).send({error:error instanceof Error?error.message:"Oprávnění role nelze upravit"});}
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

  app.post<{Body:{
    name:string;code:string;slug:string;location?:string|null;address?:string|null;
    description?:string|null;constructionStatus:string;plannedHandoverFrom?:string|null;
    managerMembershipId?:string|null;projectCompany?:string|null;defaultCurrency:string;
    plannedUnitCount?:number|null;note?:string|null;
  }}>("/v1/projects",async(request,reply)=>{
    try{
      const context=await sessionContext(request,dependencies.verifier,repository);
      if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});
      return reply.code(201).send(await inventory.createProject({...context,...request.body}));
    }catch(error){
      return reply.code(permissionError(error)?403:409).send({
        error:error instanceof Error?error.message:"Projekt nelze založit",
        correlationId:request.id,
      });
    }
  });

  app.get<{Params:{unitId:string}}>("/v1/units/:unitId/timeline",async(request,reply)=>{try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return{events:await activities.unitTimeline({...context,unitId:request.params.unitId})};}catch(error){return reply.code(403).send({error:error instanceof Error?error.message:"Historii nelze načíst"});}});
  app.get<{Params:{projectId:string}}>("/v1/projects/:projectId/timeline",async(request,reply)=>{try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return{events:await activities.projectTimeline({...context,projectId:request.params.projectId})};}catch(error){return reply.code(403).send({error:error instanceof Error?error.message:"Historii projektu nelze načíst"});}});
  app.get<{Querystring:{projectId?:string;unitId?:string}}>("/v1/client-changes",async(request,reply)=>{try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return{clientChanges:await clientChangeRepository.list({...context,...request.query})};}catch(error){return reply.code(permissionError(error)?403:409).send({error:error instanceof Error?error.message:"Klientské změny nelze načíst"});}});
  app.post<{Body:{projectId:string;unitId:string;partyId:string;title:string;description?:string;sourceType:"individual"|"catalog";catalogItemCode?:string;category:string;surchargeAmount?:number|null;currency?:string;requestedAt:string;dueAt?:string|null}}>("/v1/client-changes",async(request,reply)=>{try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.code(201).send(await clientChangeRepository.create({...context,...request.body}));}catch(error){return reply.code(permissionError(error)?403:409).send({error:error instanceof Error?error.message:"Klientskou změnu nelze vytvořit",correlationId:request.id});}});
  app.patch<{Params:{changeId:string};Body:{reason:string}}>("/v1/client-changes/:changeId/archive",async(request,reply)=>{try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.send(await clientChangeRepository.archive({...context,changeId:request.params.changeId,reason:request.body.reason}));}catch(error){return reply.code(permissionError(error)?403:409).send({error:error instanceof Error?error.message:"Klientskou změnu nelze archivovat",correlationId:request.id});}});
  app.get<{Querystring:{scope?:"mine"|"all"|"completed"}}>("/v1/tasks",async(request,reply)=>{try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return{tasks:await taskRepository.list({...context,scope:request.query.scope??"mine"})};}catch(error){return reply.code(403).send({error:error instanceof Error?error.message:"Úkoly nelze načíst"});}});
  app.get<{Querystring:{projectId?:string;status?:string;ownerId?:string;query?:string;sort?:string;direction?:"asc"|"desc"}}>("/v1/handovers",async(request,reply)=>{try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return handoverRepository.list({...context,...request.query});}catch(error){return reply.code(403).send({error:error instanceof Error?error.message:"Předání nelze načíst"});}});
  app.post<{Body:{unitId:string;scheduledAt:string;responsibleMembershipId:string}}>("/v1/handovers",async(request,reply)=>{try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.code(201).send(await handoverRepository.schedule({...context,...request.body}));}catch(error){return reply.code(permissionError(error)?403:409).send({error:error instanceof Error?error.message:"Předání nelze naplánovat"});}});
  app.patch<{Params:{handoverId:string};Body:{scheduledAt:string;responsibleMembershipId:string;status:string;readiness:number;attention?:string|null}}>("/v1/handovers/:handoverId",async(request,reply)=>{try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.send(await handoverRepository.update({...context,handoverId:request.params.handoverId,...request.body}));}catch(error){return reply.code(permissionError(error)?403:409).send({error:error instanceof Error?error.message:"Předání nelze upravit"});}});
  app.get<{Querystring:{projectId?:string;unitId?:string;partyId?:string;contractId?:string;salesCaseId?:string;status?:string;query?:string;sort?:string;direction?:"asc"|"desc"}}>("/v1/payments",async(request,reply)=>{try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return paymentRepository.list({...context,...request.query});}catch(error){return reply.code(403).send({error:error instanceof Error?error.message:"Platby nelze načíst"});}});
  app.post<{Body:{projectId:string;unitId:string;partyId:string;salesCaseId:string;contractId:string;type:string;label:string;amount:number;dueAt:string;variableSymbol?:string;idempotencyKey:string}}>("/v1/payment-obligations",async(request,reply)=>{try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.code(201).send(await paymentService.createObligation({...context,...request.body}));}catch(error){return reply.code(permissionError(error)?403:409).send({error:error instanceof Error?error.message:"Předpis nelze vytvořit"});}});
  app.post<{Params:{obligationId:string};Body:{amount:number;paidAt:string;variableSymbol?:string;counterpartyAccount?:string;bankTransactionId?:string;note?:string}}>("/v1/payment-obligations/:obligationId/payments",async(request,reply)=>{try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.code(201).send(await paymentService.record({...context,obligationId:request.params.obligationId,...request.body}));}catch(error){return reply.code(permissionError(error)?403:409).send({error:error instanceof Error?error.message:"Úhradu nelze zaznamenat"});}});
  app.post<{Params:{transactionId:string};Body:{reason:string}}>("/v1/payment-transactions/:transactionId/reversal",async(request,reply)=>{try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.code(201).send(await paymentService.reverse({...context,transactionId:request.params.transactionId,...request.body}));}catch(error){return reply.code(permissionError(error)?403:409).send({error:error instanceof Error?error.message:"Reverzaci nelze provést"});}});
  app.get<{Params:{unitId:string}}>("/v1/units/:unitId/reservation-payment-status",async(request,reply)=>{try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return dependencies.database.withContext({tenantId:context.tenantId,userId:context.userId},async client=>(await client.query("SELECT app.reservation_payment_condition($1,$2,$3) status",[context.tenantId,request.params.unitId,context.membershipId])).rows[0]);}catch(error){return reply.code(403).send({error:error instanceof Error?error.message:"Stav rezervačního poplatku není přístupný"});}});
  app.post<{Body:{projectId?:string;unitId?:string;partyId?:string;contractId?:string;title:string;description?:string;priority:string;dueAt?:string;assigneeMembershipId:string}}>("/v1/tasks",async(request,reply)=>{try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.code(201).send(await taskRepository.create({...context,...request.body}));}catch(error){return reply.code(permissionError(error)?403:409).send({error:error instanceof Error?error.message:"Úkol nelze vytvořit"});}});
  app.patch<{Params:{taskId:string};Body:{completed:boolean}}>("/v1/tasks/:taskId/completion",async(request,reply)=>{try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return taskRepository.complete({...context,taskId:request.params.taskId,completed:request.body.completed});}catch(error){return reply.code(permissionError(error)?403:409).send({error:error instanceof Error?error.message:"Úkol nelze aktualizovat"});}});
  app.patch<{Params:{taskId:string}}>("/v1/tasks/:taskId/archive",async(request,reply)=>{try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return taskRepository.archive({...context,taskId:request.params.taskId});}catch(error){return reply.code(permissionError(error)?403:409).send({error:error instanceof Error?error.message:"Úkol nelze archivovat"});}});
  app.post<{Params:{projectId:string};Body:{url:string;mimeType:string;source?:string;externalId?:string}}>("/v1/projects/:projectId/cover",async(request,reply)=>{try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.send(await dependencies.database.withContext({tenantId:context.tenantId,userId:context.userId},async client=>(await client.query("SELECT app.set_project_cover($1,$2,$3,$4,$5,$6,$7) id",[context.tenantId,request.params.projectId,request.body.url,request.body.mimeType,request.body.source??"crm",request.body.externalId??null,context.membershipId])).rows[0]));}catch(error){return reply.code(permissionError(error)?403:409).send({error:error instanceof Error?error.message:"Titulní obrázek nelze uložit"});}});
  app.post<{Params:{unitId:string};Body:{url:string;mimeType:string;source?:string;externalId?:string}}>("/v1/units/:unitId/floorplan",async(request,reply)=>{try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.send(await dependencies.database.withContext({tenantId:context.tenantId,userId:context.userId},async client=>(await client.query("SELECT app.set_unit_floorplan($1,$2,$3,$4,$5,$6,$7) id",[context.tenantId,request.params.unitId,request.body.url,request.body.mimeType,request.body.source??"crm",request.body.externalId??null,context.membershipId])).rows[0]));}catch(error){return reply.code(permissionError(error)?403:409).send({error:error instanceof Error?error.message:"Půdorys nelze uložit"});}});
  app.get<{Params:{projectId:string}}>("/v1/projects/:projectId/media",async(request,reply)=>{try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return dependencies.database.withContext({tenantId:context.tenantId,userId:context.userId},async client=>{const row=(await client.query<{id:string;cover_image_url:string|null;cover_image_mime_type:string|null}>("SELECT id,cover_image_url,cover_image_mime_type FROM projects WHERE tenant_id=$1 AND id=$2 AND app.has_project_permission(tenant_id,$3,id,'project.read')",[context.tenantId,request.params.projectId,context.membershipId])).rows[0];return{media:row?.cover_image_url?[{id:row.id,entityType:'project',entityId:row.id,kind:'cover',fileName:'Titulní obrázek',mimeType:row.cover_image_mime_type,url:row.cover_image_url}]:[]};});}catch(error){return reply.code(403).send({error:error instanceof Error?error.message:"Média nelze načíst"});}});
  app.get<{Params:{unitId:string}}>("/v1/units/:unitId/media",async(request,reply)=>{try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return dependencies.database.withContext({tenantId:context.tenantId,userId:context.userId},async client=>{const row=(await client.query<{id:string;floorplan_image_url:string|null;floorplan_image_mime_type:string|null}>("SELECT unit.id,unit.floorplan_image_url,unit.floorplan_image_mime_type FROM units unit WHERE unit.tenant_id=$1 AND unit.id=$2 AND app.has_project_permission(unit.tenant_id,$3,unit.project_id,'unit.read')",[context.tenantId,request.params.unitId,context.membershipId])).rows[0];return{media:row?.floorplan_image_url?[{id:row.id,entityType:'unit',entityId:row.id,kind:'floorplan',fileName:'Půdorys',mimeType:row.floorplan_image_mime_type,url:row.floorplan_image_url}]:[]};});}catch(error){return reply.code(403).send({error:error instanceof Error?error.message:"Média nelze načíst"});}});

  app.patch<{Params:{projectId:string};Body:{name:string;location?:string|null;lifecycleStatus:string;managerMembershipId?:string|null;plannedHandoverFrom?:string|null;plannedHandoverTo?:string|null}}>("/v1/projects/:projectId",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.send(await inventory.updateProject({...context,projectId:request.params.projectId,...request.body}));}catch(error){return reply.code(permissionError(error)?403:409).send({error:error instanceof Error?error.message:"Projekt nelze upravit"});}
  });
  app.post<{Params:{projectId:string};Body:{statusCode:string;note:string}}>("/v1/projects/:projectId/construction-status",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.code(201).send(await inventory.recordProjectConstructionStatus({...context,projectId:request.params.projectId,...request.body,effectiveAt:new Date().toISOString()}));}catch(error){return reply.code(permissionError(error)?403:409).send({error:error instanceof Error?error.message:"Fázi projektu nelze změnit"});}
  });
  app.patch<{Params:{unitId:string};Body:{structureId?:string|null;layout?:string|null;floorLabel?:string|null;floorNumber?:number|null;areaM2:number;usableAreaM2?:number|null;orientation?:string|null;balconyM2?:number|null;terraceM2?:number|null;gardenM2?:number|null}}>("/v1/units/:unitId",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.send(await inventory.updateUnit({...context,unitId:request.params.unitId,...request.body}));}catch(error){return reply.code(permissionError(error)?403:409).send({error:error instanceof Error?error.message:"Jednotku nelze upravit"});}
  });
  app.post<{Params:{unitId:string};Body:{accessoryId:string;validFrom?:string}}>("/v1/units/:unitId/accessories",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.code(201).send(await inventory.assignAccessory({...context,unitId:request.params.unitId,...request.body}));}catch(error){return reply.code(permissionError(error)?403:409).send({error:error instanceof Error?error.message:"Příslušenství nelze přiřadit"});}
  });
  app.delete<{Params:{assignmentId:string};Querystring:{validTo?:string}}>("/v1/accessory-assignments/:assignmentId",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.send(await inventory.removeAccessory({...context,assignmentId:request.params.assignmentId,validTo:request.query.validTo}));}catch(error){return reply.code(permissionError(error)?403:409).send({error:error instanceof Error?error.message:"Příslušenství nelze odebrat"});}
  });
  app.patch<{Params:{partyId:string};Body:{displayName:string}}>("/v1/parties/:partyId",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.send(await sales.updateParty({...context,partyId:request.params.partyId,...request.body}));}catch(error){return reply.code(409).send({error:error instanceof Error?error.message:"Klienta nelze upravit"});}
  });
  app.post<{Params:{partyId:string};Body:{contactType:string;value:string;label?:string|null;isPrimary?:boolean}}>("/v1/parties/:partyId/contacts",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.code(201).send(await sales.upsertContact({...context,partyId:request.params.partyId,...request.body}));}catch(error){return reply.code(409).send({error:error instanceof Error?error.message:"Kontakt nelze uložit"});}
  });
  app.patch<{Params:{partyId:string};Body:{firstName?:string;lastName?:string;legalName?:string;registrationNumber?:string;vatNumber?:string;contactPerson?:string}}>("/v1/parties/:partyId/profile",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.send(await sales.updateProfile({...context,partyId:request.params.partyId,...request.body}));}catch(error){return reply.code(permissionError(error)?403:409).send({error:error instanceof Error?error.message:"Profil klienta nelze uložit"});}
  });
  app.post<{Params:{partyId:string};Body:{addressType:string;line1:string;line2?:string;city:string;postalCode?:string;countryCode:string}}>("/v1/parties/:partyId/addresses",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.code(201).send(await sales.upsertAddress({...context,partyId:request.params.partyId,...request.body}));}catch(error){return reply.code(permissionError(error)?403:409).send({error:error instanceof Error?error.message:"Adresu klienta nelze uložit"});}
  });
  app.post<{Params:{unitId:string};Body:{partyId:string;eventType:string;note:string}}>("/v1/units/:unitId/interests",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.code(201).send(await sales.addInterest({...context,unitId:request.params.unitId,...request.body}));}catch(error){return reply.code(permissionError(error)?403:409).send({error:error instanceof Error?error.message:"Zájem nelze uložit"});}
  });

  app.get<{Querystring:{page?:string;pageSize?:string;q?:string;quickProject?:string;types?:string;projects?:string;unit?:string;relations?:string;contracts?:string;phone?:string;email?:string;sort?:string;direction?:"asc"|"desc"}}>("/v1/clients", async (request, reply) => {
    try {
      const identity = await authenticate(request,dependencies.verifier);
      const tenantId = headerValue(request.headers["x-tenant-id"]);
      if (!tenantId) return reply.code(400).send({ error:"Chybí x-tenant-id" });
      const user = await repository.resolveUser(identity);
      const session = await repository.getSession(user,identity,tenantId);
      if (!session) return reply.code(403).send({ error:"Workspace není uživateli přístupný" });
      if(request.query.page)return sales.getPage({tenantId,userId:user.id,membershipId:session.workspace.membershipId,page:Number(request.query.page)||1,pageSize:Math.min(100,Math.max(1,Number(request.query.pageSize)||25)),query:request.query.q,quickProject:request.query.quickProject,types:request.query.types?.split(",").filter(Boolean),projects:request.query.projects?.split(",").filter(Boolean),unit:request.query.unit,relations:request.query.relations?.split(",").filter(Boolean),contracts:request.query.contracts?.split(",").filter(Boolean),phone:request.query.phone,email:request.query.email,sort:request.query.sort,direction:request.query.direction});
      return sales.getDirectory({ tenantId,userId:user.id,membershipId:session.workspace.membershipId });
    } catch { return reply.code(401).send({ error:"Neplatné přihlášení" }); }
  });
  app.post<{Body:{projectId:string;kind:"individual"|"organization";salutation?:string;firstName?:string;lastName?:string;legalName?:string;registrationNumber?:string;email?:string;phone?:string}}>("/v1/parties",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.code(201).send(await sales.createParty({...context,...request.body}));}catch(error){request.log.warn({err:error,correlationId:request.id},"party creation failed");return reply.code(permissionError(error)?403:409).send({error:partyCreationError(error),correlationId:request.id});}
  });

  app.get("/v1/commercial", async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return commercial.getSnapshot(context);}
    catch{return reply.code(401).send({error:"Neplatné přihlášení"});}
  });

  app.post<{Params:{unitId:string};Body:{priceType:string;amount:number;currency?:string;validFrom:string;reason:string;approverMembershipId?:string}}>("/v1/units/:unitId/prices",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.code(201).send(await commercialCommands.recordPrice({...context,unitId:request.params.unitId,...request.body,currency:request.body.currency??"CZK"}));}
    catch(error){return reply.code(permissionError(error)?403:409).send({error:error instanceof Error?error.message:"Cenu nelze zaznamenat"});}
  });
  app.post<{Params:{proposalId:string};Body:{decision:"approved"|"rejected";reason:string}}>("/v1/price-proposals/:proposalId/decision",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.send(await commercialCommands.decidePrice({...context,proposalId:request.params.proposalId,...request.body}));}
    catch(error){return reply.code(permissionError(error)?403:409).send({error:error instanceof Error?error.message:"Návrh ceny nelze rozhodnout"});}
  });

  app.post<{Body:{salesCaseId:string;type:string;reference:string;title:string;parentContractId?:string;idempotencyKey:string;paymentCalculationType?:"percentage"|"fixed";paymentInputValue?:number;paymentDueAt?:string}}>("/v1/contracts",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.code(201).send(await commercialCommands.createContract({...context,...request.body}));}
    catch(error){return reply.code(409).send({error:error instanceof Error?error.message:"Smlouvu nelze vytvořit"});}
  });
  app.get<{Params:{unitId:string}}>("/v1/units/:unitId/next-contract-action",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return commercialCommands.nextContractAction({...context,unitId:request.params.unitId});}
    catch(error){return reply.code(permissionError(error)?403:409).send({error:error instanceof Error?error.message:"Další smluvní krok nelze určit"});}
  });
  app.post<{Params:{unitId:string};Body:{idempotencyKey:string;paymentCalculationType?:"percentage"|"fixed";paymentInputValue?:number;paymentDueAt?:string}}>("/v1/units/:unitId/next-contract",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.code(201).send(await commercialCommands.createNextContract({...context,unitId:request.params.unitId,...request.body}));}
    catch(error){const message=error instanceof Error?error.message:"Smlouvu nelze vytvořit";const friendly=message.includes("active sales case")?"Jednotka nemá aktivní obchodní proces s přiřazeným klientem.":message.includes("payment terms")?"Doplňte výši a splatnost platby.":message.includes("permission")?"Nemáte oprávnění vytvořit smlouvu.":message;return reply.code(message.includes("permission")?403:409).send({error:friendly});}
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
  app.post<{Params:{contractId:string};Body:{versionId:string;signedAt:string;note?:string}}>("/v1/contracts/:contractId/sign",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return await commercialCommands.signContract({...context,contractId:request.params.contractId,...request.body});}
    catch(error){const message=error instanceof Error?error.message:"Podpis nelze zaznamenat";const friendly=message.includes("logical version")||message.includes("contract version")?"Smlouvu nelze podepsat, protože nemá platnou aktuální verzi.":message.includes("approved or in signing")?"Smlouvu lze označit jako podepsanou až po jejím schválení.":message.includes("signing party")?"Smlouvu nelze podepsat, protože nemá evidovaného účastníka podpisu.":message.includes("permission")?"K zaznamenání podpisu nemáte oprávnění.":message.includes("future")?"Datum podpisu nesmí být v budoucnosti.":"Podpis smlouvy se nepodařilo zaznamenat.";return reply.code(message.includes("permission")?403:409).send({error:friendly});}
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

  app.post<{ Params:{ unitId:string }; Body:{ type:"pre_reservation"|"reservation";partyIds?:string[];newParty?:{kind:"individual"|"organization";salutation?:string;firstName?:string;lastName?:string;legalName?:string;registrationNumber?:string;email?:string;phone?:string};expiresAt:string;interestId?:string;idempotencyKey:string;reason:string } }>("/v1/units/:unitId/holds", async (request,reply) => {
    try {
      const identity=await authenticate(request,dependencies.verifier); const tenantId=headerValue(request.headers["x-tenant-id"]);
      if (!tenantId) return reply.code(400).send({error:"Chybí x-tenant-id"}); const user=await repository.resolveUser(identity); const session=await repository.getSession(user,identity,tenantId);
      const permission=request.body.type==="reservation"?"holds.confirm":"holds.create";
      if (!session || !await inventory.hasUnitPermission({tenantId,userId:user.id,membershipId:session.workspace.membershipId,unitId:request.params.unitId,permission})) return reply.code(403).send({error:`Chybí oprávnění ${permission}`});
      if(request.body.newParty)return reply.code(201).send(await holds.createWithParty({tenantId,userId:user.id,unitId:request.params.unitId,membershipId:session.workspace.membershipId,type:request.body.type,expiresAt:request.body.expiresAt,idempotencyKey:request.body.idempotencyKey,reason:request.body.reason,newParty:request.body.newParty}));
      if(!request.body.partyIds?.length)return reply.code(400).send({error:"Vyberte klienta nebo založte nového.",correlationId:request.id});
      return reply.code(201).send(await holds.create({tenantId,userId:user.id,unitId:request.params.unitId,membershipId:session.workspace.membershipId,type:request.body.type,partyIds:request.body.partyIds,expiresAt:request.body.expiresAt,interestId:request.body.interestId,idempotencyKey:request.body.idempotencyKey,reason:request.body.reason}));
    } catch(error) { request.log.warn({err:error,correlationId:request.id},"hold creation failed");return reply.code(permissionError(error)?403:409).send({error:partyCreationError(error),correlationId:request.id}); }
  });

  app.post<{ Params:{ holdId:string }; Body:{ expiresAt:string;idempotencyKey:string;reason:string } }>("/v1/holds/:holdId/convert", async (request,reply) => {
    try { const identity=await authenticate(request,dependencies.verifier); const tenantId=headerValue(request.headers["x-tenant-id"]); if(!tenantId)return reply.code(400).send({error:"Chybí x-tenant-id"}); const user=await repository.resolveUser(identity); const session=await repository.getSession(user,identity,tenantId);
      if(!session||!await sales.hasHoldPermission({tenantId,userId:user.id,membershipId:session.workspace.membershipId,holdId:request.params.holdId,permission:"holds.confirm"}))return reply.code(403).send({error:"Chybí oprávnění holds.confirm"});
      return reply.send(await holds.convert({tenantId,userId:user.id,holdId:request.params.holdId,membershipId:session.workspace.membershipId,...request.body}));
    } catch(error){return reply.code(409).send({error:error instanceof Error?error.message:"Převod rezervace se nezdařil"});}
  });

  app.post<{ Params:{ holdId:string }; Body:{ reason:string } }>("/v1/holds/:holdId/cancel", async (request,reply) => {
    try { const identity=await authenticate(request,dependencies.verifier); const tenantId=headerValue(request.headers["x-tenant-id"]); if(!tenantId)return reply.code(400).send({error:"Chybí x-tenant-id"}); const user=await repository.resolveUser(identity); const session=await repository.getSession(user,identity,tenantId);
      if(!session||!await sales.hasHoldPermission({tenantId,userId:user.id,membershipId:session.workspace.membershipId,holdId:request.params.holdId,permission:"holds.cancel"}))return reply.code(403).send({error:"Chybí oprávnění holds.cancel"});
      return reply.send(await holds.cancel({tenantId,userId:user.id,holdId:request.params.holdId,membershipId:session.workspace.membershipId,reason:request.body.reason}));
    } catch(error){return reply.code(409).send({error:error instanceof Error?error.message:"Zrušení rezervace se nezdařilo"});}
  });

  app.post<{ Params:{ holdId:string } }>("/v1/holds/:holdId/expire", async (request,reply) => {
    try { const identity=await authenticate(request,dependencies.verifier); const tenantId=headerValue(request.headers["x-tenant-id"]); if(!tenantId)return reply.code(400).send({error:"Chybí x-tenant-id"}); const user=await repository.resolveUser(identity); const session=await repository.getSession(user,identity,tenantId);
      if(!session||!await sales.hasHoldPermission({tenantId,userId:user.id,membershipId:session.workspace.membershipId,holdId:request.params.holdId,permission:"holds.confirm"}))return reply.code(403).send({error:"Chybí oprávnění holds.confirm"});
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

  app.get<{Params:{projectId:string};Querystring:{category?:string;unitId?:string;partyId?:string}}>("/v1/projects/:projectId/documents",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return{documents:await documentRepository.listProject({...context,projectId:request.params.projectId,...request.query}),connection:await documentRepository.connectionStatus(context)};}
    catch(error){return reply.code(403).send({error:error instanceof Error?error.message:"Dokumenty nelze načíst"});}
  });
  app.get<{Params:{unitId:string};Querystring:{category?:string}}>("/v1/units/:unitId/documents",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return{documents:await documentRepository.listUnit({...context,unitId:request.params.unitId,...request.query}),connection:await documentRepository.connectionStatus(context)};}
    catch(error){return reply.code(403).send({error:error instanceof Error?error.message:"Dokumenty jednotky nelze načíst"});}
  });
  app.get<{Querystring:{query?:string;typeCode?:string;status?:string;projectId?:string;partyId?:string;unitId?:string;contractId?:string}}>("/v1/documents",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return{documents:await documentRepository.listAll({...context,...request.query}),connection:await documentRepository.connectionStatus(context)};}
    catch(error){return reply.code(403).send({error:error instanceof Error?error.message:"Dokumenty nelze načíst"});}
  });
  app.get<{Params:{partyId:string}}>("/v1/parties/:partyId/documents",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return{documents:await documentRepository.listParty({...context,partyId:request.params.partyId}),connection:await documentRepository.connectionStatus(context)};}
    catch(error){return reply.code(403).send({error:error instanceof Error?error.message:"Dokumenty klienta nelze načíst"});}
  });
  app.get<{Params:{contractId:string}}>("/v1/contracts/:contractId/documents",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return{documents:await documentRepository.listContract({...context,contractId:request.params.contractId}),connection:await documentRepository.connectionStatus(context)};}
    catch(error){return reply.code(403).send({error:error instanceof Error?error.message:"Dokumenty smlouvy nelze načíst"});}
  });
  app.get<{Params:{documentId:string}}>("/v1/documents/:documentId",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});const document=await documentRepository.getById({...context,documentId:request.params.documentId});return document?{document}:reply.code(404).send({error:"Dokument nebyl nalezen"});}
    catch(error){return reply.code(403).send({error:error instanceof Error?error.message:"Dokument nelze načíst"});}
  });
  app.get("/v1/document-connections/sharepoint",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return{connection:await documentRepository.connectionStatus(context)};}
    catch(error){return reply.code(403).send({error:error instanceof Error?error.message:"Stav připojení nelze načíst"});}
  });
  app.post<{Body:{projectId:string;typeCode:string;name:string;mimeType?:string;status?:string;note?:string;storageProvider?:"external"}}>("/v1/documents",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.code(201).send(await documentRepository.createRecord({...context,...request.body}));}
    catch(error){return reply.code(permissionError(error)?403:409).send({error:error instanceof Error?error.message:"Metadata dokumentu nelze vytvořit"});}
  });
  app.patch<{Params:{documentId:string};Body:{name:string;typeCode:string;status:string;note?:string}}>("/v1/documents/:documentId",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return documentRepository.updateRecord({...context,documentId:request.params.documentId,...request.body});}
    catch(error){return reply.code(permissionError(error)?403:409).send({error:error instanceof Error?error.message:"Metadata dokumentu nelze upravit"});}
  });
  app.post<{Params:{documentId:string};Body:{versionIdentifier:string;versionLabel:string;status:string;note?:string;fileSize?:number;contentHash?:string}}>("/v1/documents/:documentId/versions",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.code(201).send(await documentRepository.createVersionV2({...context,documentId:request.params.documentId,...request.body}));}
    catch(error){return reply.code(permissionError(error)?403:409).send({error:error instanceof Error?error.message:"Verzi dokumentu nelze vytvořit"});}
  });
  app.post<{Params:{documentId:string};Body:{reason:string}}>("/v1/documents/:documentId/archive",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return documentRepository.archive({...context,documentId:request.params.documentId,reason:request.body.reason});}
    catch(error){return reply.code(permissionError(error)?403:409).send({error:error instanceof Error?error.message:"Dokument nelze archivovat"});}
  });
  app.post<{Params:{documentId:string};Body:{projectId:string}}>("/v1/documents/:documentId/project-links",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.code(201).send(await documentRepository.linkProject({...context,documentId:request.params.documentId,projectId:request.body.projectId}));}
    catch(error){return reply.code(permissionError(error)?403:409).send({error:error instanceof Error?error.message:"Vazbu projektu nelze vytvořit"});}
  });
  app.post<{Params:{documentId:string};Body:{unitId:string}}>("/v1/documents/:documentId/unit-links",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.code(201).send(await documentRepository.linkUnit({...context,documentId:request.params.documentId,unitId:request.body.unitId}));}
    catch(error){return reply.code(permissionError(error)?403:409).send({error:error instanceof Error?error.message:"Vazbu jednotky nelze vytvořit"});}
  });
  app.post<{Params:{documentId:string};Body:{partyId:string}}>("/v1/documents/:documentId/party-links",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.code(201).send(await documentRepository.linkParty({...context,documentId:request.params.documentId,partyId:request.body.partyId}));}
    catch(error){return reply.code(permissionError(error)?403:409).send({error:error instanceof Error?error.message:"Vazbu klienta nelze vytvořit"});}
  });
  app.post<{Params:{documentId:string};Body:{contractId:string;contractVersionId?:string;documentVersionId?:string}}>("/v1/documents/:documentId/contract-links",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.code(201).send(await documentRepository.linkContract({...context,documentId:request.params.documentId,...request.body}));}
    catch(error){return reply.code(permissionError(error)?403:409).send({error:error instanceof Error?error.message:"Vazbu smlouvy nelze vytvořit"});}
  });
  app.post<{Params:{documentId:string};Body:{salesCaseId:string}}>("/v1/documents/:documentId/sales-case-links",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.code(201).send(await documentRepository.linkSalesCase({...context,documentId:request.params.documentId,salesCaseId:request.body.salesCaseId}));}
    catch(error){return reply.code(permissionError(error)?403:409).send({error:error instanceof Error?error.message:"Vazbu obchodního případu nelze vytvořit"});}
  });

  return app;
}

async function authenticate(request: FastifyRequest, verifier: EntraTokenVerifier): Promise<EntraIdentity> {
  return verifiedIdentities.get(request) ?? verifier.verify(request.headers.authorization);
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
function permissionError(error:unknown){return error instanceof Error&&/permission|required|oprávnění/i.test(error.message);}
function partyCreationError(error:unknown){const message=error instanceof Error?error.message:"";if(/clients\.create|clients\.update|party scope|permission/i.test(message))return "Nemáte oprávnění založit klienta.";if(/first name and last name|required|party name/i.test(message))return "Doplňte jméno a příjmení klienta.";if(/registration number already exists/i.test(message))return "Klient se stejným IČO už existuje.";return message||"Klienta nebo předrezervaci nelze vytvořit.";}

function csvCell(value:string):string { return `"${value.replaceAll('"','""')}"`; }

async function sessionContext(request:FastifyRequest,verifier:EntraTokenVerifier,repository:IamRepository){
  const identity=await authenticate(request,verifier);const tenantId=headerValue(request.headers["x-tenant-id"]);if(!tenantId)return null;
  const user=await repository.resolveUser(identity);const session=await repository.getSession(user,identity,tenantId);if(!session)return null;
  return {tenantId,userId:user.id,membershipId:session.workspace.membershipId};
}

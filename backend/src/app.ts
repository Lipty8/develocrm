import Fastify, { type FastifyError, type FastifyInstance, type FastifyRequest } from "fastify";
import type { EntraIdentity } from "./auth/entra.js";
import { EntraTokenVerifier } from "./auth/entra.js";
import type { Database } from "./database.js";
import { IamRepository } from "./iam/repository.js";
import { InventoryRepository } from "./inventory/repository.js";
import { InventoryImportService, type InventoryEntityType, type InventoryImportRow } from "./inventory/import-service.js";
import { CommercialStatusService } from "./inventory/commercial-status-service.js";
import { PartyDuplicateError, SalesRepository } from "./sales/repository.js";
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
import { ComplaintRepository } from "./complaints/repository.js";
import { MediaAccessError, MediaRepository, type MediaEntityType, type MediaKind } from "./media/repository.js";
import { mapApiError } from "./http/api-error.js";

const verifiedIdentities = new WeakMap<FastifyRequest, EntraIdentity>();

export function buildApp(dependencies: { database: Database; verifier: EntraTokenVerifier; corsAllowedOrigins?:Set<string> }): FastifyInstance {
  const app = Fastify({
    logger: {
      redact: { paths:["req.headers.authorization","req.headers.cookie","request.headers.authorization","request.headers.cookie"], censor:"[REDACTED]" },
      serializers:{
        req:(value:FastifyRequest)=>({method:value.method,path:value.url.split("?",1)[0]}),
        err:(value:FastifyError)=>({type:value.name,message:"[REDACTED]",stack:"[REDACTED]"}),
      },
    },
    trustProxy:true,
  });
  const repository = new IamRepository(dependencies.database);
  const inventory = new InventoryRepository(dependencies.database);
  const inventoryImports = new InventoryImportService(dependencies.database);
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
  const complaintRepository = new ComplaintRepository(dependencies.database);
  const mediaRepository = new MediaRepository(dependencies.database);

  app.setErrorHandler((error,request,reply)=>{
    const normalized=error instanceof Error?error:new Error("Unknown request failure");
    const reportedStatus=!!error&&typeof error==="object"&&"statusCode" in error&&typeof error.statusCode==="number"?error.statusCode:500;
    request.log.error({event:"http.unhandled_error",correlationId:request.id,errorName:normalized.name,statusCode:reportedStatus},"request failed");
    const statusCode=reportedStatus>=400?reportedStatus:500;
    return reply.code(statusCode).send(mapApiError(normalized,statusCode,request.id));
  });
  app.addHook("preSerialization",async(request,reply,payload)=>{
    if(reply.statusCode<400||request.url.startsWith("/ready"))return payload;
    return mapApiError(payload,reply.statusCode,request.id);
  });
  app.addHook("onResponse",async(request,reply)=>{
    request.log.info({event:"http.request.complete",correlationId:request.id,method:request.method,route:request.routeOptions.url,statusCode:reply.statusCode,responseTimeMs:reply.elapsedTime},"request complete");
  });

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
      request.log.warn({event:"auth.rejected",correlationId:request.id,errorName:error instanceof Error?error.name:"Error"},"authentication rejected");
      return reply.code(401).send(mapApiError(new Error("authentication rejected"),401,request.id));
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
    catch(error){request.log.error({err:error,correlationId:request.id,operation:"profile.update"},"profile update failed");const message=error instanceof Error&&/Jméno|časové pásmo|profil nebyl nalezen/i.test(error.message)?error.message:"Profil se nepodařilo uložit. Zkuste to prosím znovu.";return reply.code(409).send({error:message,correlationId:request.id});}
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

  app.get<{Querystring:{projectId?:string}}>("/v1/catalog", async (request, reply) => {
    try {
      const identity = await authenticate(request, dependencies.verifier);
      const tenantId = headerValue(request.headers["x-tenant-id"]);
      if (!tenantId) return reply.code(400).send({ error: "Chybí x-tenant-id" });
      const user = await repository.resolveUser(identity);
      const session = await repository.getSession(user, identity, tenantId);
      if (!session) return reply.code(403).send({ error: "Workspace není uživateli přístupný" });
      return inventory.getCatalog({ tenantId, userId: user.id, membershipId: session.workspace.membershipId,projectId:request.query.projectId });
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
  app.post<{Body:{projectId:string;unitId:string;partyId:string;title:string;description?:string;sourceType:"individual"|"catalog";catalogItemCode?:string;category:string;surchargeAmount?:number|null;currency?:string;requestedAt:string;dueAt?:string|null;assigneeMembershipId?:string|null}}>("/v1/client-changes",async(request,reply)=>{try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.code(201).send(await clientChangeRepository.create({...context,...request.body}));}catch(error){return reply.code(permissionError(error)?403:409).send({error:error instanceof Error?error.message:"Klientskou změnu nelze vytvořit",correlationId:request.id});}});
  app.patch<{Params:{changeId:string};Body:{reason:string}}>("/v1/client-changes/:changeId/archive",async(request,reply)=>{try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.send(await clientChangeRepository.archive({...context,changeId:request.params.changeId,reason:request.body.reason}));}catch(error){return reply.code(permissionError(error)?403:409).send({error:error instanceof Error?error.message:"Klientskou změnu nelze archivovat",correlationId:request.id});}});
  app.patch<{Params:{changeId:string};Body:{status:string;note?:string;assigneeMembershipId?:string|null;idempotencyKey:string}}>("/v1/client-changes/:changeId/status",async(request,reply)=>{try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.send(await clientChangeRepository.transitionV2({...context,changeId:request.params.changeId,status:request.body.status,note:request.body.note,assigneeMembershipId:request.body.assigneeMembershipId,idempotencyKey:request.body.idempotencyKey}));}catch(error){return reply.code(permissionError(error)?403:409).send({error:error instanceof Error?error.message:"Stav klientské změny nelze změnit",correlationId:request.id});}});
  app.get<{Querystring:{projectId?:string;unitId?:string}}>("/v1/complaints",async(request,reply)=>{try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return{complaints:await complaintRepository.list({...context,...request.query})};}catch(error){request.log.error({correlationId:request.id,errorName:error instanceof Error?error.name:"Error"},"complaints list failed");return reply.code(permissionError(error)?403:409).send({error:"Reklamace nelze načíst",correlationId:request.id});}});
  app.post<{Body:{projectId:string;unitId:string;partyId:string;title:string;description:string;assigneeMembershipId?:string|null;dueAt?:string|null;idempotencyKey:string}}>("/v1/complaints",async(request,reply)=>{try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.code(201).send(await complaintRepository.create({...context,...request.body}));}catch(error){request.log.error({correlationId:request.id,errorName:error instanceof Error?error.name:"Error"},"complaint create failed");return reply.code(permissionError(error)?403:409).send({error:permissionError(error)?"Nemáte oprávnění založit reklamaci.":"Reklamaci se nepodařilo založit.",correlationId:request.id});}});
  app.patch<{Params:{complaintId:string};Body:{status:string;note?:string;assigneeMembershipId?:string|null;dueAt?:string|null;idempotencyKey:string}}>("/v1/complaints/:complaintId",async(request,reply)=>{try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.send(await complaintRepository.transition({...context,complaintId:request.params.complaintId,...request.body}));}catch(error){request.log.error({correlationId:request.id,errorName:error instanceof Error?error.name:"Error"},"complaint transition failed");return reply.code(permissionError(error)?403:409).send({error:permissionError(error)?"Nemáte oprávnění upravit reklamaci.":"Reklamaci se nepodařilo upravit.",correlationId:request.id});}});
  app.get<{Querystring:{scope?:"mine"|"all"|"completed"}}>("/v1/tasks",async(request,reply)=>{try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return{tasks:await taskRepository.list({...context,scope:request.query.scope??"mine"})};}catch(error){return reply.code(403).send({error:error instanceof Error?error.message:"Úkoly nelze načíst"});}});
  app.get<{Querystring:{projectId?:string;unitId?:string;status?:string;ownerId?:string;query?:string;sort?:string;direction?:"asc"|"desc"}}>("/v1/handovers",async(request,reply)=>{try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return handoverRepository.list({...context,...request.query});}catch{return reply.code(403).send({error:"Předání nelze načíst",correlationId:request.id});}});
  app.post<{Body:{unitId:string;scheduledAt:string;responsibleMembershipId:string;place?:string|null;note?:string|null;idempotencyKey:string}}>("/v1/handovers",async(request,reply)=>{try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.code(201).send(await handoverRepository.schedule({...context,...request.body}));}catch(error){request.log.error({err:error,correlationId:request.id},"handover scheduling failed");return reply.code(permissionError(error)?403:409).send({error:handoverError(error,"schedule"),correlationId:request.id});}});
  app.patch<{Params:{handoverId:string};Body:{scheduledAt:string;responsibleMembershipId:string;status:string;readiness:number;attention?:string|null;place?:string|null;note?:string|null;completedAt?:string|null}}>("/v1/handovers/:handoverId",async(request,reply)=>{try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.send(await handoverRepository.update({...context,handoverId:request.params.handoverId,...request.body}));}catch(error){request.log.error({err:error,correlationId:request.id},"handover update failed");return reply.code(permissionError(error)?403:409).send({error:handoverError(error,"update"),correlationId:request.id});}});
  app.get<{Querystring:{projectId?:string;unitId?:string;partyId?:string;contractId?:string;salesCaseId?:string;status?:string;query?:string;sort?:string;direction?:"asc"|"desc"}}>("/v1/payments",async(request,reply)=>{try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return paymentRepository.list({...context,...request.query});}catch(error){return reply.code(403).send({error:error instanceof Error?error.message:"Platby nelze načíst"});}});
  app.post<{Body:{projectId:string;unitId:string;partyId:string;salesCaseId:string;contractId:string;type:string;label:string;amount:number;dueAt:string;variableSymbol?:string;idempotencyKey:string}}>("/v1/payment-obligations",async(request,reply)=>{try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.code(201).send(await paymentService.createObligation({...context,...request.body}));}catch(error){return reply.code(permissionError(error)?403:409).send({error:error instanceof Error?error.message:"Předpis nelze vytvořit"});}});
  app.post<{Params:{obligationId:string};Body:{amount:number;paidAt:string;variableSymbol?:string;counterpartyAccount?:string;bankTransactionId?:string;note?:string;idempotencyKey?:string}}>("/v1/payment-obligations/:obligationId/payments",async(request,reply)=>{try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.code(201).send(await paymentService.record({...context,obligationId:request.params.obligationId,...request.body}));}catch(error){request.log.warn({err:error,correlationId:request.id,obligationId:request.params.obligationId},"payment recording failed");const message=error instanceof Error?error.message:"";const friendly=message.includes("exceeds remaining")?"Částka úhrady nesmí být vyšší než zbývající částka.":message.includes("already paid")?"Platební povinnost je již plně uhrazená.":message.includes("cancelled")?"Stornovanou platební povinnost nelze uhradit.":message.includes("permission")?"Nemáte oprávnění zaznamenat úhradu.":"Úhradu se nepodařilo zaznamenat. Zkuste to prosím znovu.";return reply.code(permissionError(error)?403:409).send({error:friendly,correlationId:request.id});}});
  app.patch<{Params:{obligationId:string};Body:{dueAt:string;reason:string;idempotencyKey:string}}>("/v1/payment-obligations/:obligationId/due-date",async(request,reply)=>{try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.send(await paymentService.changeDueDate({...context,obligationId:request.params.obligationId,...request.body}));}catch(error){request.log.warn({err:error,correlationId:request.id,obligationId:request.params.obligationId},"payment due date change failed");return reply.code(permissionError(error)?403:409).send({error:permissionError(error)?"Nemáte oprávnění změnit splatnost.":"Splatnost se nepodařilo změnit.",correlationId:request.id});}});
  app.post<{Params:{transactionId:string};Body:{reason:string}}>("/v1/payment-transactions/:transactionId/reversal",async(request,reply)=>{try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.code(201).send(await paymentService.reverse({...context,transactionId:request.params.transactionId,...request.body}));}catch(error){return reply.code(permissionError(error)?403:409).send({error:error instanceof Error?error.message:"Reverzaci nelze provést"});}});
  app.post<{Params:{obligationId:string};Body:{sourceTransactionId:string;amount:number;refundedAt:string;reason?:string;idempotencyKey:string}}>("/v1/payments/:obligationId/refunds",async(request,reply)=>{try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.code(201).send(await paymentService.refund({...context,obligationId:request.params.obligationId,...request.body}));}catch(error){request.log.warn({err:error,correlationId:request.id,obligationId:request.params.obligationId},"payment refund failed");const message=error instanceof Error?error.message:"Vratku nelze vytvořit";const friendly=message.includes("explicit refund decision")?"O částce vratky zatím nebylo rozhodnuto.":message.includes("ended contract")?"Vratku lze vytvořit pouze k platbě u ukončené smlouvy.":message.includes("exceeds")?"Částka vratky je vyšší než schválená zbývající částka k vrácení.":message.includes("permission")?"Nemáte oprávnění vytvořit vratku.":"Vratku se nepodařilo vytvořit.";return reply.code(permissionError(error)?403:409).send({error:friendly,correlationId:request.id});}});
  app.get<{Params:{unitId:string}}>("/v1/units/:unitId/reservation-payment-status",async(request,reply)=>{try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return dependencies.database.withContext({tenantId:context.tenantId,userId:context.userId},async client=>(await client.query("SELECT app.reservation_payment_condition($1,$2,$3) status",[context.tenantId,request.params.unitId,context.membershipId])).rows[0]);}catch(error){return reply.code(403).send({error:error instanceof Error?error.message:"Stav rezervačního poplatku není přístupný"});}});
  app.post<{Body:{projectId?:string;unitId?:string;partyId?:string;contractId?:string;title:string;description?:string;priority:string;dueAt?:string;assigneeMembershipId:string}}>("/v1/tasks",async(request,reply)=>{try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.code(201).send(await taskRepository.create({...context,...request.body}));}catch(error){return reply.code(permissionError(error)?403:409).send({error:error instanceof Error?error.message:"Úkol nelze vytvořit"});}});
  app.patch<{Params:{taskId:string};Body:{projectId:string;unitId?:string;partyId?:string;contractId?:string;title:string;description?:string;priority:string;dueAt?:string;assigneeMembershipId:string;status:"open"|"completed"}}>("/v1/tasks/:taskId",async(request,reply)=>{try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.send(await taskRepository.update({...context,taskId:request.params.taskId,...request.body}));}catch(error){request.log.warn({err:error,correlationId:request.id,taskId:request.params.taskId},"task update failed");return reply.code(permissionError(error)?403:409).send({error:permissionError(error)?"Nemáte oprávnění upravit tento úkol.":"Úkol se nepodařilo upravit.",correlationId:request.id});}});
  app.patch<{Params:{taskId:string};Body:{completed:boolean}}>("/v1/tasks/:taskId/completion",async(request,reply)=>{try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return taskRepository.complete({...context,taskId:request.params.taskId,completed:request.body.completed});}catch(error){return reply.code(permissionError(error)?403:409).send({error:error instanceof Error?error.message:"Úkol nelze aktualizovat"});}});
  app.patch<{Params:{taskId:string}}>("/v1/tasks/:taskId/archive",async(request,reply)=>{try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return taskRepository.archive({...context,taskId:request.params.taskId});}catch(error){return reply.code(permissionError(error)?403:409).send({error:error instanceof Error?error.message:"Úkol nelze archivovat"});}});
  app.post<{Body:{entityType:MediaEntityType;entityId:string;kind:MediaKind}}>("/v1/media/uploads/authorize",async(request,reply)=>{try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return mediaRepository.authorizeUpload({...context,...request.body});}catch(error){return reply.code(mediaStatus(error)).send({error:"Médium nelze nahrát"});}});
  app.get<{Querystring:{key:string}}>("/v1/media/access",async(request,reply)=>{try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});if(!request.query.key)return reply.code(400).send({error:"Chybí identifikace souboru"});return{media:await mediaRepository.getByStorageKey({...context,storageKey:request.query.key})};}catch(error){return reply.code(mediaStatus(error)).send({error:"Médium není dostupné"});}});
  app.post<{Params:{projectId:string};Body:{url:string;mimeType:string;storageKey:string;fileName:string}}>("/v1/projects/:projectId/cover",async(request,reply)=>{try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return{media:await mediaRepository.register({...context,entityType:"project",entityId:request.params.projectId,kind:"cover",...request.body})};}catch(error){return reply.code(mediaStatus(error)).send({error:"Titulní obrázek nelze uložit"});}});
  app.post<{Params:{unitId:string};Body:{url:string;mimeType:string;storageKey:string;fileName:string}}>("/v1/units/:unitId/floorplan",async(request,reply)=>{try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return{media:await mediaRepository.register({...context,entityType:"unit",entityId:request.params.unitId,kind:"floorplan",...request.body})};}catch(error){return reply.code(mediaStatus(error)).send({error:"Půdorys nelze uložit"});}});
  app.get<{Params:{projectId:string}}>("/v1/projects/:projectId/media",async(request,reply)=>{try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});const media=await mediaRepository.getForEntity({...context,entityType:"project",entityId:request.params.projectId,kind:"cover"});return{media:media?[mediaDto(media)]:[]};}catch(error){return reply.code(mediaStatus(error)).send({error:"Média nelze načíst"});}});
  app.get<{Params:{unitId:string}}>("/v1/units/:unitId/media",async(request,reply)=>{try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});const media=await mediaRepository.getForEntity({...context,entityType:"unit",entityId:request.params.unitId,kind:"floorplan"});return{media:media?[mediaDto(media)]:[]};}catch(error){return reply.code(mediaStatus(error)).send({error:"Média nelze načíst"});}});

  app.patch<{Params:{projectId:string};Body:{name:string;location?:string|null;lifecycleStatus:string;managerMembershipId?:string|null;plannedHandoverFrom?:string|null;plannedHandoverTo?:string|null}}>("/v1/projects/:projectId",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.send(await inventory.updateProject({...context,projectId:request.params.projectId,...request.body}));}catch(error){return reply.code(permissionError(error)?403:409).send({error:error instanceof Error?error.message:"Projekt nelze upravit"});}
  });
  app.post<{Params:{projectId:string};Body:{statusCode:string;note:string}}>("/v1/projects/:projectId/construction-status",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.code(201).send(await inventory.recordProjectConstructionStatus({...context,projectId:request.params.projectId,...request.body,effectiveAt:new Date().toISOString()}));}catch(error){return reply.code(permissionError(error)?403:409).send({error:error instanceof Error?error.message:"Fázi projektu nelze změnit"});}
  });
  app.patch<{Params:{unitId:string};Body:{structureId?:string|null;layout?:string|null;floorLabel?:string|null;floorNumber?:number|null;areaM2:number;usableAreaM2?:number|null;orientation?:string|null;balconyM2?:number|null;terraceM2?:number|null;gardenM2?:number|null}}>("/v1/units/:unitId",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.send(await inventory.updateUnit({...context,unitId:request.params.unitId,...request.body}));}catch(error){return reply.code(permissionError(error)?403:409).send({error:error instanceof Error?error.message:"Jednotku nelze upravit"});}
  });
  app.post<{Params:{projectId:string};Body:InventoryImportRow}>("/v1/projects/:projectId/units",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.code(201).send(await inventoryImports.createUnit({...context,projectId:request.params.projectId,row:{...request.body,rowNumber:request.body.rowNumber??1}}));}catch(error){request.log.warn({err:error,correlationId:request.id,projectId:request.params.projectId},"unit creation failed");return reply.code(permissionError(error)?403:409).send({error:error instanceof Error?error.message:"Jednotku nelze vytvořit",correlationId:request.id});}
  });
  app.post<{Params:{projectId:string};Body:{entityType:InventoryEntityType;rows:InventoryImportRow[];strategy?:"update"|"skip"}}>("/v1/projects/:projectId/inventory-imports/preview",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.send(await inventoryImports.preview({...context,projectId:request.params.projectId,...request.body}));}catch(error){request.log.warn({err:error,correlationId:request.id,projectId:request.params.projectId},"inventory import preview failed");return reply.code(permissionError(error)?403:409).send({error:error instanceof Error?error.message:"Import nelze zkontrolovat",correlationId:request.id});}
  });
  app.post<{Params:{projectId:string};Body:{entityType:InventoryEntityType;rows:InventoryImportRow[];strategy:"update"|"skip";idempotencyKey:string;fileName?:string}}>("/v1/projects/:projectId/inventory-imports",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.code(201).send(await inventoryImports.confirm({...context,projectId:request.params.projectId,...request.body}));}catch(error){request.log.warn({err:error,correlationId:request.id,projectId:request.params.projectId},"inventory import failed");return reply.code(permissionError(error)?403:409).send({error:error instanceof Error?error.message:"Import nelze dokončit",correlationId:request.id});}
  });
  app.post<{Params:{unitId:string};Body:{accessoryId:string;validFrom?:string}}>("/v1/units/:unitId/accessories",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.code(201).send(await inventory.assignAccessory({...context,unitId:request.params.unitId,...request.body}));}catch(error){return reply.code(permissionError(error)?403:409).send({error:error instanceof Error?error.message:"Příslušenství nelze přiřadit"});}
  });
  app.delete<{Params:{assignmentId:string};Querystring:{validTo?:string}}>("/v1/accessory-assignments/:assignmentId",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.send(await inventory.removeAccessory({...context,assignmentId:request.params.assignmentId,validTo:request.query.validTo}));}catch(error){request.log.warn({err:error,correlationId:request.id,assignmentId:request.params.assignmentId},"accessory release failed");const message=error instanceof Error?error.message:"Příslušenství nelze odebrat";const friendly=message.includes("permission")?"Nemáte oprávnění uvolnit příslušenství.":message.includes("range")?"Příslušenství nelze uvolnit k vybranému času.":"Příslušenství se nepodařilo uvolnit.";return reply.code(permissionError(error)?403:409).send({error:friendly,correlationId:request.id});}
  });
  app.post<{Params:{projectId:string};Body:{category:"parking"|"cellar"|"wallbox";code:string;areaM2?:number|null;amount:number;amountNet?:number|null;relatedAccessoryId?:string|null}}>("/v1/projects/:projectId/accessories",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.code(201).send(await inventory.createAccessory({...context,projectId:request.params.projectId,...request.body}));}catch(error){request.log.warn({err:error,correlationId:request.id,projectId:request.params.projectId},"accessory creation failed");const message=error instanceof Error?error.message:"Příslušenství nelze vytvořit";const friendly=message.includes("accessories_code_uq")||message.includes("duplicate key")?"Příslušenství s tímto označením už v projektu existuje.":message.includes("permission")?"Nemáte oprávnění spravovat příslušenství.":message.includes("wallbox relation")?"Wallbox lze navázat pouze na parkovací stání stejného projektu.":"Příslušenství se nepodařilo vytvořit.";return reply.code(message.includes("permission")?403:409).send({error:friendly,correlationId:request.id});}
  });
  app.patch<{Params:{accessoryId:string};Body:{code:string;areaM2?:number|null;amount:number;amountNet?:number|null;reason?:string}}>("/v1/accessories/:accessoryId",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.send(await inventory.updateAccessory({...context,accessoryId:request.params.accessoryId,...request.body}));}catch(error){request.log.warn({err:error,correlationId:request.id,accessoryId:request.params.accessoryId},"accessory update failed");const message=error instanceof Error?error.message:"Příslušenství nelze upravit";return reply.code(permissionError(error)?403:409).send({error:message.includes("permission")?"Nemáte oprávnění upravit příslušenství.":message.includes("duplicate key")?"Příslušenství s tímto označením už existuje.":"Příslušenství se nepodařilo upravit.",correlationId:request.id});}
  });
  app.delete<{Params:{accessoryId:string};Body:{reason?:string}}>("/v1/accessories/:accessoryId",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.send({outcome:await inventory.removeOrArchiveAccessory({...context,accessoryId:request.params.accessoryId,reason:request.body?.reason??"Odstraněno uživatelem"})});}catch(error){request.log.warn({err:error,correlationId:request.id,accessoryId:request.params.accessoryId},"accessory removal failed");const message=error instanceof Error?error.message:"Příslušenství nelze odstranit";const friendly=message.includes("currently assigned")?"Příslušenství je aktuálně přiřazené. Nejprve ho uvolněte z jednotky.":message.includes("permission")?"Nemáte oprávnění odstranit příslušenství.":"Příslušenství se nepodařilo odstranit. Zkuste to prosím znovu.";return reply.code(permissionError(error)?403:409).send({error:friendly,correlationId:request.id});}
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

  app.get<{Querystring:{page?:string;pageSize?:string;projectId?:string;q?:string;quickProject?:string;types?:string;projects?:string;unit?:string;relations?:string;contracts?:string;phone?:string;email?:string;sort?:string;direction?:"asc"|"desc";includeArchived?:string}}>("/v1/clients", async (request, reply) => {
    try {
      const identity = await authenticate(request,dependencies.verifier);
      const tenantId = headerValue(request.headers["x-tenant-id"]);
      if (!tenantId) return reply.code(400).send({ error:"Chybí x-tenant-id" });
      const user = await repository.resolveUser(identity);
      const session = await repository.getSession(user,identity,tenantId);
      if (!session) return reply.code(403).send({ error:"Workspace není uživateli přístupný" });
      const includeArchived=request.query.includeArchived==="true";
      if(request.query.page)return sales.getPage({tenantId,userId:user.id,membershipId:session.workspace.membershipId,page:Number(request.query.page)||1,pageSize:Math.min(100,Math.max(1,Number(request.query.pageSize)||25)),projectId:request.query.projectId,query:request.query.q,quickProject:request.query.quickProject,types:request.query.types?.split(",").filter(Boolean),projects:request.query.projects?.split(",").filter(Boolean),unit:request.query.unit,relations:request.query.relations?.split(",").filter(Boolean),contracts:request.query.contracts?.split(",").filter(Boolean),phone:request.query.phone,email:request.query.email,sort:request.query.sort,direction:request.query.direction,includeArchived});
      return sales.getDirectory({ tenantId,userId:user.id,membershipId:session.workspace.membershipId,includeArchived });
    } catch { return reply.code(401).send({ error:"Neplatné přihlášení" }); }
  });
  app.post<{Body:{projectId:string;kind:"individual"|"organization";salutation?:string;firstName?:string;lastName?:string;legalName?:string;registrationNumber?:string;email?:string;phone?:string;duplicateOverride?:boolean}}>("/v1/parties",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.code(201).send(await sales.createParty({...context,...request.body}));}catch(error){request.log.warn({err:error,correlationId:request.id},"party creation failed");if(error instanceof PartyDuplicateError)return reply.code(409).send({error:"Klient s těmito údaji už pravděpodobně existuje.",code:"party_duplicate",matches:error.matches,correlationId:request.id});return reply.code(permissionError(error)?403:409).send({error:partyCreationError(error),correlationId:request.id});}
  });
  app.post<{Body:{projectId:string;kind:"individual"|"organization";firstName?:string;lastName?:string;legalName?:string;registrationNumber?:string;email?:string;phone?:string}}>("/v1/parties/duplicates",async(request,reply)=>{try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný",correlationId:request.id});if(!request.body.projectId)return reply.code(400).send({error:"Vyberte projekt",correlationId:request.id});return{matches:await sales.findDuplicates({...context,...request.body})};}catch(error){request.log.warn({err:error,correlationId:request.id,endpoint:"/v1/parties/duplicates"},"party duplicate check failed");return reply.code(permissionError(error)?403:409).send({error:"Kontrolu duplicit se nepodařilo provést. Zkuste to prosím znovu.",correlationId:request.id});}});
  app.post<{Params:{partyId:string};Body:{projectId:string}}>("/v1/parties/:partyId/projects",async(request,reply)=>{try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.code(201).send(await sales.linkPartyToProject({...context,partyId:request.params.partyId,projectId:request.body.projectId}));}catch(error){return reply.code(permissionError(error)?403:409).send({error:error instanceof Error?error.message:"Klienta nelze propojit s projektem"});}});
  app.get<{Params:{partyId:string}}>("/v1/parties/:partyId/archive-impact",async(request,reply)=>{try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return{impact:await sales.archiveImpact({...context,partyId:request.params.partyId})};}catch(error){return reply.code(permissionError(error)?403:409).send({error:"Vazby klienta nelze ověřit"});}});
  app.post<{Params:{partyId:string};Body:{reason:string}}>("/v1/parties/:partyId/archive",async(request,reply)=>{try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return{outcome:await sales.archiveParty({...context,partyId:request.params.partyId,reason:request.body.reason})};}catch(error){request.log.warn({err:error,correlationId:request.id,partyId:request.params.partyId},"party removal failed");return reply.code(permissionError(error)?403:409).send({error:permissionError(error)?"Nemáte oprávnění klienta odstranit.":"Klienta se nepodařilo odstranit. Zkuste to prosím znovu.",correlationId:request.id});}});
  app.post<{Params:{partyId:string};Body:{activityType:string;note:string}}>("/v1/parties/:partyId/activities",async(request,reply)=>{try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.code(201).send(await sales.addActivity({...context,partyId:request.params.partyId,...request.body}));}catch(error){request.log.warn({err:error,correlationId:request.id,partyId:request.params.partyId},"party activity creation failed");return reply.code(permissionError(error)?403:409).send({error:permissionError(error)?"Nemáte oprávnění přidat aktivitu klienta.":"Aktivitu klienta se nepodařilo uložit.",correlationId:request.id});}});

  app.get<{Querystring:{projectId?:string}}>("/v1/commercial", async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return commercial.getSnapshot({...context,projectId:request.query.projectId});}
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
    catch(error){request.log.warn({err:error,correlationId:request.id},"contract creation failed");const message=error instanceof Error?error.message:"Smlouvu nelze vytvořit";const friendly=message.includes("active contract of this type")?"Pro tuto jednotku již existuje aktivní smlouva daného typu.":message.includes("permission")?"Nemáte oprávnění vytvořit smlouvu.":message.includes("duplicate key")||message.includes("contracts_reference_uq")?"Interní označení smlouvy se nepodařilo přidělit. Zkuste akci znovu.":"Smlouvu se nepodařilo vytvořit.";return reply.code(message.includes("permission")?403:409).send({error:friendly,correlationId:request.id});}
  });
  app.post<{Params:{contractId:string};Body:{title?:string;idempotencyKey:string}}>("/v1/contracts/:contractId/addenda",async(request,reply)=>{try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.code(201).send(await commercialCommands.createAddendum({...context,baseContractId:request.params.contractId,...request.body}));}catch(error){request.log.warn({err:error,correlationId:request.id,contractId:request.params.contractId},"contract addendum creation failed");const message=error instanceof Error?error.message:"Dodatek nelze vytvořit";return reply.code(permissionError(error)?403:409).send({error:message.includes("signed base")?"Dodatek lze vytvořit pouze k podepsané základní smlouvě.":message.includes("permission")?"Nemáte oprávnění vytvořit dodatek.":"Dodatek se nepodařilo vytvořit.",correlationId:request.id});}});
  app.post<{Params:{contractId:string};Body:{text:string}}>("/v1/contracts/:contractId/notes",async(request,reply)=>{try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.code(201).send(await commercialCommands.addNote({...context,contractId:request.params.contractId,text:request.body.text}));}catch(error){return reply.code(permissionError(error)?403:409).send({error:permissionError(error)?"Nemáte oprávnění přidat poznámku.":"Poznámku se nepodařilo uložit.",correlationId:request.id});}});
  app.post<{Params:{noteId:string};Body:{reason:string}}>("/v1/contract-notes/:noteId/archive",async(request,reply)=>{try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.send(await commercialCommands.archiveNote({...context,noteId:request.params.noteId,reason:request.body.reason}));}catch(error){return reply.code(permissionError(error)?403:409).send({error:permissionError(error)?"Nemáte oprávnění poznámku archivovat.":"Poznámku se nepodařilo archivovat.",correlationId:request.id});}});
  app.get<{Params:{unitId:string}}>("/v1/units/:unitId/next-contract-action",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return commercialCommands.nextContractAction({...context,unitId:request.params.unitId});}
    catch(error){return reply.code(permissionError(error)?403:409).send({error:error instanceof Error?error.message:"Další smluvní krok nelze určit"});}
  });
  app.post<{Params:{unitId:string};Body:{type:"rs"|"sbk"|"ks";idempotencyKey:string;paymentCalculationType?:"percentage"|"fixed";paymentInputValue?:number;paymentDueAt?:string}}>("/v1/units/:unitId/next-contract",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.code(201).send(await commercialCommands.createNextContract({...context,unitId:request.params.unitId,...request.body}));}
    catch(error){request.log.warn({err:error,correlationId:request.id,unitId:request.params.unitId},"next contract creation failed");const message=error instanceof Error?error.message:"Smlouvu nelze vytvořit";const friendly=message.includes("active contract of this type")?"Pro tuto jednotku již existuje aktivní smlouva daného typu.":message.includes("active sales case")?"Jednotka nemá aktivní obchodní proces s přiřazeným klientem.":message.includes("payment terms")?"Doplňte výši a splatnost platby.":message.includes("permission")?"Nemáte oprávnění vytvořit smlouvu.":message.includes("duplicate key")||message.includes("contracts_reference_uq")?"Interní označení smlouvy se nepodařilo přidělit. Zkuste akci znovu.":"Smlouvu se nepodařilo vytvořit.";return reply.code(message.includes("permission")?403:409).send({error:friendly,correlationId:request.id});}
  });
  app.post<{Params:{unitId:string};Body:{buyers?:Array<{partyId:string;role:"buyer"|"co_buyer";isPrimary:boolean;share?:number|null}>;newParty?:{kind:"individual"|"organization";salutation?:string;firstName?:string;lastName?:string;legalName?:string;registrationNumber?:string;email?:string;phone?:string;duplicateOverride?:boolean};effectiveAt:string;note?:string;idempotencyKey:string}}>("/v1/units/:unitId/contract-assignment",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.code(201).send(await commercialCommands.createContractAssignment({...context,unitId:request.params.unitId,...request.body}));}
    catch(error){request.log.warn({err:error,correlationId:request.id,unitId:request.params.unitId},"contract assignment creation failed");const message=error instanceof Error?error.message:"Postoupení nelze vytvořit";const friendly=message.includes("signed RS or SBK")?"Postoupení lze vytvořit pouze k podepsané RS nebo SBK.":message.includes("unfinished assignment")?"Pro tuto smlouvu již existuje rozpracované postoupení.":message.includes("assignee must differ")?"Nový kupující musí být odlišný od současného kupujícího.":message.includes("permission")?"Nemáte oprávnění vytvořit postoupení smlouvy.":"Postoupení smlouvy se nepodařilo vytvořit.";return reply.code(message.includes("permission")?403:409).send({error:friendly,correlationId:request.id});}
  });
  app.post<{Params:{contractId:string};Body:{name:string;source?:string;basedOnVersionId?:string;generationPayload?:unknown}}>("/v1/contracts/:contractId/versions",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.code(201).send(await commercialCommands.createVersion({...context,contractId:request.params.contractId,...request.body,source:request.body.source??"manual"}));}
    catch(error){return reply.code(409).send({error:error instanceof Error?error.message:"Verzi nelze vytvořit"});}
  });
  app.post<{Params:{contractId:string};Body:{to:string;reason:string;refundDecisions?:Array<{obligationId:string;decision:"none"|"partial"|"full";amount?:number}>;idempotencyKey?:string}}>("/v1/contracts/:contractId/status",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return await commercialCommands.transition({...context,contractId:request.params.contractId,...request.body});}
    catch(error){request.log.warn({err:error,correlationId:request.id,contractId:request.params.contractId},"contract transition failed");const message=error instanceof Error?error.message:"";const friendly=message.includes("explicit refund decision")?"U každé přijaté platby rozhodněte, zda a kolik se má vrátit.":message.includes("partial refund amount")?"Částečná vratka musí být vyšší než nula a nižší než přijatá částka.":permissionError(error)?"Nemáte oprávnění změnit stav smlouvy.":"Stav smlouvy se nepodařilo změnit.";return reply.code(permissionError(error)?403:409).send({error:friendly,correlationId:request.id});}
  });
  app.post<{Params:{contractPartyId:string};Body:{versionId:string;reason:string}}>("/v1/contract-parties/:contractPartyId/sign",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return await commercialCommands.sign({...context,contractPartyId:request.params.contractPartyId,...request.body});}
    catch(error){return reply.code(409).send({error:error instanceof Error?error.message:"Podpis nelze zaznamenat"});}
  });
  app.post<{Params:{contractId:string};Body:{versionId:string;signedAt:string;note?:string}}>("/v1/contracts/:contractId/sign",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return await commercialCommands.signContract({...context,contractId:request.params.contractId,...request.body});}
    catch(error){const message=error instanceof Error?error.message:"Podpis nelze zaznamenat";const friendly=message.includes("logical version")||message.includes("contract version")?"Smlouvu nelze podepsat, protože nemá platnou aktuální verzi.":message.includes("must be approved")||message.includes("approved or in signing")?"Smlouvu lze označit jako podepsanou až po jejím schválení.":message.includes("signing party")?"Smlouvu nelze podepsat, protože nemá evidovaného účastníka podpisu.":message.includes("permission")?"K zaznamenání podpisu nemáte oprávnění.":message.includes("future")?"Datum podpisu nesmí být v budoucnosti.":"Podpis smlouvy se nepodařilo zaznamenat.";return reply.code(message.includes("permission")?403:409).send({error:friendly});}
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

  app.post<{ Params:{ unitId:string }; Body:{ type:"pre_reservation"|"reservation";partyIds?:string[];newParty?:{kind:"individual"|"organization";salutation?:string;firstName?:string;lastName?:string;legalName?:string;registrationNumber?:string;email?:string;phone?:string;duplicateOverride?:boolean};expiresAt:string;interestId?:string;idempotencyKey:string;reason:string } }>("/v1/units/:unitId/holds", async (request,reply) => {
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
  app.get<{Querystring:{query?:string;typeCode?:string;status?:string;projectId?:string;partyId?:string;unitId?:string;contractId?:string;clientChangeId?:string;complaintId?:string;handoverId?:string}}>("/v1/documents",async(request,reply)=>{
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
  app.get<{Params:{clientChangeId:string}}>("/v1/client-changes/:clientChangeId/documents",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return{documents:await documentRepository.listClientChange({...context,clientChangeId:request.params.clientChangeId}),connection:await documentRepository.connectionStatus(context)};}
    catch(error){return reply.code(403).send({error:error instanceof Error?error.message:"Dokumenty klientské změny nelze načíst"});}
  });
  app.get<{Params:{complaintId:string}}>("/v1/complaints/:complaintId/documents",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return{documents:await documentRepository.listComplaint({...context,complaintId:request.params.complaintId}),connection:await documentRepository.connectionStatus(context)};}
    catch(error){return reply.code(403).send({error:error instanceof Error?error.message:"Dokumenty reklamace nelze načíst"});}
  });
  app.get<{Params:{handoverId:string}}>("/v1/handovers/:handoverId/documents",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return{documents:await documentRepository.listHandover({...context,handoverId:request.params.handoverId}),connection:await documentRepository.connectionStatus(context)};}
    catch(error){return reply.code(403).send({error:error instanceof Error?error.message:"Dokumenty předání nelze načíst"});}
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
  app.post<{Params:{documentId:string};Body:{clientChangeId:string}}>("/v1/documents/:documentId/client-change-links",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.code(201).send(await documentRepository.linkClientChange({...context,documentId:request.params.documentId,clientChangeId:request.body.clientChangeId}));}
    catch(error){return reply.code(permissionError(error)?403:409).send({error:error instanceof Error?error.message:"Vazbu klientské změny nelze vytvořit"});}
  });
  app.post<{Params:{documentId:string};Body:{complaintId:string}}>("/v1/documents/:documentId/complaint-links",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.code(201).send(await documentRepository.linkComplaint({...context,documentId:request.params.documentId,complaintId:request.body.complaintId}));}
    catch(error){return reply.code(permissionError(error)?403:409).send({error:error instanceof Error?error.message:"Vazbu reklamace nelze vytvořit"});}
  });
  app.post<{Params:{documentId:string};Body:{handoverId:string}}>("/v1/documents/:documentId/handover-links",async(request,reply)=>{
    try{const context=await sessionContext(request,dependencies.verifier,repository);if(!context)return reply.code(403).send({error:"Workspace není uživateli přístupný"});return reply.code(201).send(await documentRepository.linkHandover({...context,documentId:request.params.documentId,handoverId:request.body.handoverId}));}
    catch(error){return reply.code(permissionError(error)?403:409).send({error:error instanceof Error?error.message:"Vazbu předání nelze vytvořit"});}
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
function mediaStatus(error:unknown){if(error instanceof MediaAccessError)return error.reason==="forbidden"?403:error.reason==="invalid"?400:404;if(permissionError(error))return 403;return error instanceof Error&&/duplicate|constraint|conflict/i.test(error.message)?409:500;}
function mediaDto(media:{id:string;entityType:MediaEntityType;entityId:string;kind:MediaKind;fileName:string;mimeType:string;storageKey:string;uploadedAt:string;uploadedByUserId:string|null}){
  return{id:media.id,entityType:media.entityType,entityId:media.entityId,kind:media.kind,fileName:media.fileName,mimeType:media.mimeType,url:`/api/media/file/${encodeURIComponent(media.storageKey)}`,uploadedAt:media.uploadedAt,uploadedBy:media.uploadedByUserId??undefined};
}
function handoverError(error:unknown,operation:"schedule"|"update"){
  const message=error instanceof Error?error.message:"";
  if(/already has an active handover|duplicate key.*unit_handovers_one_open/i.test(message))return "Pro tuto jednotku již existuje naplánované předání.";
  if(/future/i.test(message))return "Vyberte budoucí datum a čas předání.";
  if(/requires a new date/i.test(message))return "Pro přesunutí vyberte nový termín předání.";
  if(/sold unit/i.test(message))return "Předání lze dokončit až po dokončení kupní smlouvy.";
  if(/permission/i.test(message))return "Nemáte oprávnění spravovat předání v tomto projektu.";
  if(/unit not found/i.test(message))return "Jednotka nebyla nalezena nebo nepatří do tohoto projektu.";
  if(/responsible membership/i.test(message))return "Vyberte aktivní odpovědnou osobu.";
  return operation==="schedule"?"Předání se nepodařilo naplánovat.":"Předání se nepodařilo upravit.";
}
function partyCreationError(error:unknown){const message=error instanceof Error?error.message:"";if(/party duplicate confirmation required/i.test(message))return "Klient s těmito údaji už pravděpodobně existuje. Použijte existujícího klienta nebo potvrďte vytvoření nového.";if(/clients\.create|clients\.update|party scope|permission/i.test(message))return "Nemáte oprávnění založit klienta.";if(/first name and last name|required|party name/i.test(message))return "Doplňte jméno a příjmení klienta.";if(/registration number already exists/i.test(message))return "Klient se stejným IČO už existuje.";return message||"Klienta nebo stav V jednání nelze vytvořit.";}

function csvCell(value:string):string { return `"${value.replaceAll('"','""')}"`; }

async function sessionContext(request:FastifyRequest,verifier:EntraTokenVerifier,repository:IamRepository){
  const identity=await authenticate(request,verifier);const tenantId=headerValue(request.headers["x-tenant-id"]);if(!tenantId)return null;
  const user=await repository.resolveUser(identity);const session=await repository.getSession(user,identity,tenantId);if(!session)return null;
  return {tenantId,userId:user.id,membershipId:session.workspace.membershipId,identityEmail:user.email};
}

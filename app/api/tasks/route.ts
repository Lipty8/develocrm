import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { tasks, tenants, users } from "../../../db/schema";
import { getChatGPTUser } from "../../chatgpt-auth";
import { addPragueCalendarDaysKey, systemClock } from "../../lib/date-time";

const DEMO_TENANT_ID = "develocrm-demo";
const FALLBACK_USER_ID = "iva-novotna";

async function actor() {
  const user = await getChatGPTUser();
  return { id: user ? `chatgpt-${user.email.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 70)}` : FALLBACK_USER_ID, email: user?.email || "iva@develo.example", displayName: user?.displayName || "Iva Novotná" };
}

export async function GET(request: Request) {
  try {
    const current = await actor();
    const scope = new URL(request.url).searchParams.get("scope") || "mine";
    const db = getDb();
    const predicate = scope === "completed" ? and(eq(tasks.tenantId, DEMO_TENANT_ID), eq(tasks.state, "completed")) : scope === "all" ? eq(tasks.tenantId, DEMO_TENANT_ID) : and(eq(tasks.tenantId, DEMO_TENANT_ID), eq(tasks.assignedToUserId, current.id), eq(tasks.state, "open"));
    const rows = await db.select().from(tasks).where(predicate)
      .orderBy(desc(tasks.createdAt))
      .limit(50);
    const assigneeIds=[...new Set(rows.map(row=>row.assignedToUserId).filter((id):id is string=>Boolean(id)))];
    const assignees=assigneeIds.length?await db.select({id:users.id,displayName:users.displayName}).from(users).where(and(eq(users.tenantId,DEMO_TENANT_ID),inArray(users.id,assigneeIds))):[];
    const names=new Map(assignees.map(item=>[item.id,item.displayName]));
    return Response.json({ tasks: rows.map(row=>({...row,assigneeName:row.assignedToUserId?names.get(row.assignedToUserId):undefined})) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Úkoly se nepodařilo načíst";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      title?: string;
      description?: string;
      objectType?: string;
      objectId?: string;
      assignedToUserId?: string;
      assigneeName?: string;
      priority?: string;
      dueAt?: string;
    };
    const title = payload.title?.trim();
    if (!title) return Response.json({ error: "Název úkolu je povinný" }, { status: 400 });

    const db = getDb();
    const current = await actor();
    await db.insert(tenants).values({ id: DEMO_TENANT_ID, name: "Develo Group", slug: "develo-group" }).onConflictDoNothing();
    await db.insert(users).values({ id: current.id, tenantId: DEMO_TENANT_ID, email: current.email, displayName: current.displayName, role: "admin" }).onConflictDoNothing();
    const assigneeId=payload.assignedToUserId?.trim()||current.id;
    const assigneeName=payload.assignedToUserId?.trim()?payload.assigneeName?.trim()||"Uživatel CRM":current.displayName;
    if(assigneeId!==current.id)await db.insert(users).values({id:assigneeId,tenantId:DEMO_TENANT_ID,email:`${assigneeId.replace(/[^a-z0-9]+/gi,"-").toLowerCase()}@preview.invalid`,displayName:assigneeName,role:"member"}).onConflictDoNothing();

    const id = String(Date.now());
    const [created] = await db.insert(tasks).values({
      id,
      tenantId: DEMO_TENANT_ID,
      title,
      description: payload.description?.trim() || null,
      objectType: payload.objectType || "unit",
      objectId: payload.objectId || "A203",
      assignedToUserId: assigneeId,
      priority: payload.priority || "medium",
      dueAt: payload.dueAt || addPragueCalendarDaysKey(systemClock.now(), 1),
      source: "manual",
    }).returning();
    return Response.json({ task: {...created,assigneeName} }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Úkol se nepodařilo uložit";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const payload = await request.json() as { id?: string; completed?: boolean };
    if (!payload.id) return Response.json({ error: "Chybí úkol" }, { status: 400 });
    const current = await actor();
    const db = getDb();
    const [existing] = await db.select().from(tasks).where(and(eq(tasks.id, payload.id), eq(tasks.tenantId, DEMO_TENANT_ID))).limit(1);
    if (!existing) return Response.json({ error: "Úkol nebyl nalezen" }, { status: 404 });
    // Preview admin may complete any task; regular production permissions are
    // enforced by the PostgreSQL repository and project scope.
    const completed = payload.completed !== false;
    const [updated] = await db.update(tasks).set({ state: completed ? "completed" : "open", completedAt: completed ? new Date().toISOString() : null, updatedAt: new Date().toISOString() }).where(and(eq(tasks.id, payload.id), eq(tasks.tenantId, DEMO_TENANT_ID))).returning();
    return Response.json({ task: updated, actor: current.id });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Úkol nelze aktualizovat" }, { status: 500 });
  }
}

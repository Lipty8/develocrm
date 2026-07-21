import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { tasks, tenants, users } from "../../../db/schema";

const DEMO_TENANT_ID = "develocrm-demo";
const DEMO_USER_ID = "iva-novotna";

export async function GET() {
  try {
    const db = getDb();
    const rows = await db
      .select()
      .from(tasks)
      .where(eq(tasks.tenantId, DEMO_TENANT_ID))
      .orderBy(desc(tasks.createdAt))
      .limit(50);
    return Response.json({ tasks: rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Úkoly se nepodařilo načíst";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      title?: string;
      objectType?: string;
      objectId?: string;
      priority?: string;
      dueAt?: string;
    };
    const title = payload.title?.trim();
    if (!title) return Response.json({ error: "Název úkolu je povinný" }, { status: 400 });

    const db = getDb();
    await db.insert(tenants).values({ id: DEMO_TENANT_ID, name: "Develo Group", slug: "develo-group" }).onConflictDoNothing();
    await db.insert(users).values({ id: DEMO_USER_ID, tenantId: DEMO_TENANT_ID, email: "iva@develo.example", displayName: "Iva Novotná", role: "admin" }).onConflictDoNothing();

    const id = String(Date.now());
    const [created] = await db.insert(tasks).values({
      id,
      tenantId: DEMO_TENANT_ID,
      title,
      objectType: payload.objectType || "unit",
      objectId: payload.objectId || "A203",
      assignedToUserId: DEMO_USER_ID,
      priority: payload.priority || "medium",
      dueAt: payload.dueAt || "2026-07-22",
      source: "manual",
    }).returning();
    return Response.json({ task: created }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Úkol se nepodařilo uložit";
    return Response.json({ error: message }, { status: 500 });
  }
}

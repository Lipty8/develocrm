import { projects as previewProjects, units as previewUnits, type UnitRecord, type UnitStatus } from "../../crm-data";
import { previewCatalogMeta, type CatalogSnapshot } from "../../repositories/catalog-repository";
import type { ProjectRecord } from "../../crm-data";
import { apiUnavailable, browserFallbackResponse, serverDataMode } from "../../lib/data-mode";

type BackendCatalog = {
  projects: Array<{
    id: string; code: string; name: string; location: string | null; manager: string | null;
    lifecycleStatus:string; managerMembershipId:string|null; plannedHandoverFrom: string | null; plannedHandoverTo: string | null; constructionStatus: string | null;
    counts: Record<string, number>;
  }>;
  units: Array<{
    id: string; code: string; projectId:string; structureId:string|null; projectName: string; structureName: string | null; layout: string | null;
    areaM2: number; usableAreaM2: number | null; floorLabel: string | null; orientation: string | null;
    balconyM2: number | null; terraceM2: number | null; gardenM2: number | null; commercialStatus: string;
    constructionStatus: string | null;
    updatedAt:string;
    accessories: Array<{ id:string; assignmentId:string; code: string; type: string; category: string; areaM2: number | null; relation?:string|null }>;
  }>;
  accessories:Array<{id:string;code:string;type:string;category:string;areaM2:number|null;projectId:string;projectName:string;available:boolean;relation?:string|null}>;
  memberships:Array<{id:string;name:string}>;
  structures:Array<{id:string;projectId:string;projectName:string;name:string;kind:string}>;
};

export async function GET(request: Request) {
  const backendUrl = process.env.DEVELOCRM_API_URL?.replace(/\/$/, "");
  const tenantId = process.env.DEVELOCRM_TENANT_ID;
  const authorization = request.headers.get("authorization");
  if (!backendUrl || !tenantId || !authorization) {
    if (serverDataMode() !== "browser") {
      return apiUnavailable("Katalog není dostupný. Aplikace není připojena ke společnému backendu.");
    }
    const units=previewUnits.map(unit=>({...unit,projectCode:previewProjects.find(project=>project.name===unit.project)?.code,accessories:previewCatalogMeta.accessories.filter(item=>item.project===unit.project&&item.assignmentId?.includes(`-${unit.id}-`))}));
    return browserFallbackResponse({ projects: previewProjects, units, ...previewCatalogMeta, source: "preview-seed" } satisfies CatalogSnapshot);
  }

  const response = await fetch(`${backendUrl}/v1/catalog`, {
    headers: { authorization, "x-tenant-id": tenantId }, cache: "no-store",
  });
  if (!response.ok) return Response.json({ error: "Backend katalog není dostupný" }, { status: response.status });
  const catalog = await response.json() as BackendCatalog;
  return Response.json(adaptBackendCatalog(catalog));
}

export async function PATCH(request: Request, context: { params: Promise<{ projectId?: string; unitId?: string }> }) {
  return forwardMutation(request, context, "PATCH");
}
export async function POST(request: Request, context: { params: Promise<{ unitId?: string }> }) {
  return forwardMutation(request, context, "POST");
}
export async function DELETE(request: Request, context: { params: Promise<{ assignmentId?: string }> }) {
  return forwardMutation(request, context, "DELETE");
}
async function forwardMutation(request: Request, context: {params: Promise<Record<string,string|undefined>>}, method: string) {
  const backendUrl=process.env.DEVELOCRM_API_URL?.replace(/\/$/,""); const tenantId=process.env.DEVELOCRM_TENANT_ID; const authorization=request.headers.get("authorization");
  if(!backendUrl||!tenantId||!authorization) return Response.json({error:"Editace vyžaduje připojený backend"},{status:503});
  const params=await context.params; const target=params.projectId?`/v1/projects/${params.projectId}`:params.unitId?(method==="POST"?`/v1/units/${params.unitId}/accessories`:`/v1/units/${params.unitId}`):`/v1/accessory-assignments/${params.assignmentId}`;
  const response=await fetch(`${backendUrl}${target}`,{method,headers:{authorization,"x-tenant-id":tenantId,"content-type":"application/json"},body:method==="DELETE"?undefined:await request.text()});
  return new Response(await response.text(),{status:response.status,headers:{"content-type":"application/json"}});
}

function adaptBackendCatalog(catalog: BackendCatalog): CatalogSnapshot {
  const projectStructures = new Map<string, Set<string>>();
  for (const unit of catalog.units) {
    if (!unit.structureName) continue;
    const structures = projectStructures.get(unit.projectName) ?? new Set<string>();
    structures.add(unit.structureName);
    projectStructures.set(unit.projectName, structures);
  }
  const projects = catalog.projects.map((project, index): ProjectRecord => {
    const available = project.counts.available ?? 0;
    const preReserved = project.counts.pre_reserved ?? 0;
    const reserved = (project.counts.reserved ?? 0) + (project.counts.contracted ?? 0);
    const sold = project.counts.sold ?? 0;
    const handedOver = project.counts.handed_over ?? 0;
    const unitCount = Object.values(project.counts).reduce((sum, count) => sum + count, 0);
    return {
      backendId:project.id,name: project.name,sourceName:project.name, code: project.code, location: project.location ?? "",
      progress: Math.round(((sold + handedOver) / Math.max(unitCount, 1)) * 100), units: unitCount,
      available, preReserved, reserved, sold, handedOver, attention: 0,
      color: (["sage", "sand", "slate"] as const)[index % 3], stage: constructionLabel(project.constructionStatus),
      revenue: "—", buildings: [...(projectStructures.get(project.name) ?? [])],
      lifecycleStatus:project.lifecycleStatus,manager: project.manager ?? "—",managerMembershipId:project.managerMembershipId, plannedHandover: quarterLabel(project.plannedHandoverFrom),plannedCompletionFrom:project.plannedHandoverFrom,plannedCompletionTo:project.plannedHandoverTo,
    };
  });
  const units = catalog.units.map((unit): UnitRecord => {
    return {
      backendId:unit.id,projectBackendId:unit.projectId,projectCode:catalog.projects.find(project=>project.id===unit.projectId)?.code,structureId:unit.structureId,id: unit.code, project: unit.projectName, building: unit.structureName ?? "Bez zařazení",
      layout: unit.layout ?? "—", area: unit.areaM2, floor: unit.floorLabel ?? "—",
      orientation: unit.orientation ?? "—", price: 0,
      usableArea: unit.usableAreaM2 ?? undefined, balcony: unit.balconyM2, terrace: unit.terraceM2, garden: unit.gardenM2,
      status: commercialLabel(unit.commercialStatus), construction: constructionLabel(unit.constructionStatus),
      updatedAt:unit.updatedAt,
      handover: "Neplánováno",
      accessory: unit.accessories.map((item) => `${item.type} ${item.code}${item.areaM2 ? ` · ${item.areaM2} m²` : ""}`).join(" · ") || "Bez příslušenství",accessories:unit.accessories,
    };
  });
  return { projects, units, accessories:catalog.accessories.map(item=>({...item,project:item.projectName,projectBackendId:item.projectId})),memberships:catalog.memberships,structures:catalog.structures.map(item=>({id:item.id,projectId:item.projectId,project:item.projectName,name:item.name,kind:item.kind})),source: "backend-api" };
}

function commercialLabel(status: string): UnitStatus {
  return ({ available: "Volný", pre_reserved: "Předrezervace", reserved: "RS", contracted: "SBK", sold: "KS", handed_over: "Předáno", blocked: "Blokováno" } as Record<string, UnitStatus>)[status] ?? "Volný";
}

function constructionLabel(status: string | null): string {
  return ({ preparation: "Příprava", permitting: "Povolování", construction: "Ve výstavbě",
    rough_construction: "Hrubá stavba", installations: "Instalace", fit_out: "Dokončovací práce", completed: "Dokončeno" } as Record<string, string>)[status ?? ""] ?? "Bez stavebního stavu";
}

function quarterLabel(date: string | null): string {
  if (!date) return "Neplánováno";
  const parsed = new Date(`${date}T00:00:00Z`);
  return `Q${Math.floor(parsed.getUTCMonth() / 3) + 1} ${parsed.getUTCFullYear()}`;
}

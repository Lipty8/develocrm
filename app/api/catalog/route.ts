import { projects as previewProjects, units as previewUnits, type UnitRecord, type UnitStatus } from "../../crm-data";
import { previewCatalogMeta, type CatalogSnapshot } from "../../repositories/catalog-repository";
import type { ProjectRecord } from "../../crm-data";
import { apiUnavailable, browserFallbackResponse, serverDataMode } from "../../lib/data-mode";
import { forwardBackendMutation, type BackendMutationMethod } from "../../lib/backend-proxy";
import { projectConstructionLabel } from "../../lib/project-construction";
import { projectCompletionLabel } from "../../lib/project-completion";
import { projectSalesPerformancePercent } from "../../lib/project-sales-performance";
import { unitCommercialStatusLabel } from "../../lib/unit-commercial-status";

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
    constructionStatus: string | null; unitPrice?:number|null; accessoryPrice?:number; totalPrice?:number|null;
    updatedAt:string;
    accessories: Array<{ id:string; assignmentId:string; code: string; type: string; category: string; areaM2: number | null; relation?:string|null; amount:number; amountNet:number|null; currency:string }>;
  }>;
  accessories:Array<{id:string;assignmentId?:string;code:string;type:string;category:string;subtype?:string|null;location?:string|null;areaM2:number|null;projectId:string;projectName:string;available:boolean;archived?:boolean;assignedUnitId?:string|null;assignedUnitCode?:string|null;assignedUnitStatus?:string|null;assignedClient?:string|null;assignmentHistory?:Array<{assignmentId:string;unitId:string;unitCode:string;validFrom:string;validTo:string|null;assignedBy:string|null}>;relation?:string|null;amount:number;amountNet:number|null;currency:string}>;
  memberships:Array<{id:string;name:string}>;
  structures:Array<{id:string;projectId:string;projectName:string;name:string;kind:string}>;
};

type BackendPriceBreakdowns = Record<string, {
  unitPrice: number | null;
  accessoryPrice: number;
  totalPrice: number | null;
}>;

export async function GET(request: Request) {
  const backendUrl = process.env.DEVELOCRM_API_URL?.replace(/\/$/, "");
  const tenantId = process.env.DEVELOCRM_TENANT_ID;
  const authorization = request.headers.get("authorization");
  const incoming=new URL(request.url).searchParams;const projectId=incoming.get("projectId");
  if (!backendUrl || !tenantId || !authorization) {
    if (serverDataMode() !== "browser") {
      return apiUnavailable("Katalog není dostupný. Aplikace není připojena ke společnému backendu.");
    }
    const scopedProjects=projectId?previewProjects.filter(project=>(project.backendId??project.code)===projectId):previewProjects;
    const scopedNames=new Set(scopedProjects.map(project=>project.name));
    const units=previewUnits.filter(unit=>scopedNames.has(unit.project)).map(unit=>({...unit,projectCode:scopedProjects.find(project=>project.name===unit.project)?.code,accessories:previewCatalogMeta.accessories.filter(item=>item.project===unit.project&&item.assignmentId?.includes(`-${unit.id}-`))}));
    return browserFallbackResponse({ projects: scopedProjects, units, accessories:previewCatalogMeta.accessories.filter(item=>scopedNames.has(item.project)),memberships:previewCatalogMeta.memberships,structures:previewCatalogMeta.structures.filter(item=>scopedProjects.some(project=>(project.backendId??project.code)===item.projectId||project.name===item.project)), source: "preview-seed" } satisfies CatalogSnapshot);
  }

  const backendHeaders = { authorization, "x-tenant-id": tenantId };
  const [response, commercialResponse] = await Promise.all([
    fetch(`${backendUrl}/v1/catalog${incoming.size?`?${incoming}`:""}`, {
      headers: backendHeaders, cache: "no-store",
    }),
    fetch(`${backendUrl}/v1/commercial${incoming.size?`?${incoming}`:""}`, {
      headers: backendHeaders, cache: "no-store",
    }),
  ]);
  if (!response.ok) return Response.json({ error: "Backend katalog není dostupný" }, { status: response.status });
  const catalog = await response.json() as BackendCatalog;
  const commercial = commercialResponse.ok
    ? await commercialResponse.json() as {priceBreakdowns?: BackendPriceBreakdowns}
    : null;
  return Response.json(adaptBackendCatalog(catalog, commercial?.priceBreakdowns));
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
async function forwardMutation(request: Request, context: {params: Promise<Record<string,string|undefined>>}, method: BackendMutationMethod) {
  const params=await context.params; const target=params.projectId?`/v1/projects/${params.projectId}`:params.unitId?(method==="POST"?`/v1/units/${params.unitId}/accessories`:`/v1/units/${params.unitId}`):`/v1/accessory-assignments/${params.assignmentId}`;
  return forwardBackendMutation(request,{method,target,unavailableMessage:"Editace vyžaduje připojený backend"});
}

function adaptBackendCatalog(catalog: BackendCatalog, priceBreakdowns?: BackendPriceBreakdowns): CatalogSnapshot {
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
      progress: projectSalesPerformancePercent({units:unitCount,available,preReserved,reserved,sold,handedOver}), units: unitCount,
      available, preReserved, reserved, sold, handedOver, attention: 0,
      color: (["sage", "sand", "slate"] as const)[index % 3], stage: projectConstructionLabel(project.constructionStatus),stageCode:project.constructionStatus,
      revenue: "—", buildings: [...(projectStructures.get(project.name) ?? [])],
      lifecycleStatus:project.lifecycleStatus,manager: project.manager ?? "—",managerMembershipId:project.managerMembershipId, plannedHandover: projectCompletionLabel(project.plannedHandoverFrom??project.plannedHandoverTo),plannedCompletionFrom:project.plannedHandoverFrom,plannedCompletionTo:project.plannedHandoverTo,
    };
  });
  const units = catalog.units.map((unit): UnitRecord => {
    const legacyBreakdown = priceBreakdowns?.[unit.code];
    const unitPrice = unit.unitPrice ?? legacyBreakdown?.unitPrice ?? null;
    const accessoryPrice = unit.accessoryPrice ?? legacyBreakdown?.accessoryPrice ?? 0;
    const totalPrice = unit.totalPrice ?? legacyBreakdown?.totalPrice ?? null;
    return {
      backendId:unit.id,projectBackendId:unit.projectId,projectCode:catalog.projects.find(project=>project.id===unit.projectId)?.code,structureId:unit.structureId,id: unit.code, project: unit.projectName, building: unit.structureName ?? "Bez zařazení",
      layout: unit.layout ?? "—", area: unit.areaM2, floor: unit.floorLabel ?? "—",
      orientation: unit.orientation ?? "—", price: totalPrice ?? 0,basePrice:unitPrice,accessoryPrice,priceConfigured:unitPrice!==null,
      usableArea: unit.usableAreaM2 ?? undefined, balcony: unit.balconyM2, terrace: unit.terraceM2, garden: unit.gardenM2,
      status: unitCommercialStatusLabel(unit.commercialStatus) as UnitStatus, construction: constructionLabel(unit.constructionStatus),
      updatedAt:unit.updatedAt,
      handover: "Neplánováno",
      accessory: unit.accessories.map((item) => `${item.type} ${item.code}${item.areaM2 ? ` · ${item.areaM2} m²` : ""}`).join(" · ") || "Bez příslušenství",accessories:unit.accessories,
    };
  });
  return { projects, units, accessories:catalog.accessories.map(item=>({...item,project:item.projectName,projectBackendId:item.projectId})),memberships:catalog.memberships,structures:catalog.structures.map(item=>({id:item.id,projectId:item.projectId,project:item.projectName,name:item.name,kind:item.kind})),source: "backend-api" };
}

function constructionLabel(status: string | null): string {
  return ({ preparation: "Příprava", permitting: "Povolování", construction: "Ve výstavbě",
    rough_construction: "Hrubá stavba", installations: "Instalace", fit_out: "Dokončovací práce", completed: "Dokončeno" } as Record<string, string>)[status ?? ""] ?? "Bez stavebního stavu";
}

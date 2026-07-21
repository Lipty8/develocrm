import { projects as previewProjects, units as previewUnits, type UnitRecord, type UnitStatus } from "../../crm-data";
import type { CatalogSnapshot, ProjectRecord } from "../../repositories/catalog-repository";

type BackendCatalog = {
  projects: Array<{
    id: string; code: string; name: string; location: string | null; manager: string | null;
    plannedHandoverFrom: string | null; plannedHandoverTo: string | null; constructionStatus: string | null;
    counts: Record<string, number>;
  }>;
  units: Array<{
    id: string; code: string; projectName: string; structureName: string | null; layout: string | null;
    areaM2: number; floorLabel: string | null; orientation: string | null; commercialStatus: string;
    constructionStatus: string | null;
    accessories: Array<{ code: string; type: string; category: string; areaM2: number | null }>;
  }>;
};

export async function GET(request: Request) {
  const backendUrl = process.env.DEVELOCRM_API_URL?.replace(/\/$/, "");
  const tenantId = process.env.DEVELOCRM_TENANT_ID;
  const authorization = request.headers.get("authorization");
  if (!backendUrl || !tenantId || !authorization) {
    return Response.json({ projects: previewProjects, units: previewUnits, source: "preview-seed" } satisfies CatalogSnapshot);
  }

  const response = await fetch(`${backendUrl}/v1/catalog`, {
    headers: { authorization, "x-tenant-id": tenantId }, cache: "no-store",
  });
  if (!response.ok) return Response.json({ error: "Backend katalog není dostupný" }, { status: response.status });
  const catalog = await response.json() as BackendCatalog;
  return Response.json(adaptBackendCatalog(catalog));
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
      name: project.name, code: project.code, location: project.location ?? "",
      progress: Math.round(((sold + handedOver) / Math.max(unitCount, 1)) * 100), units: unitCount,
      available, preReserved, reserved, sold, handedOver, attention: 0,
      color: (["sage", "sand", "slate"] as const)[index % 3], stage: constructionLabel(project.constructionStatus),
      revenue: "—", buildings: [...(projectStructures.get(project.name) ?? [])],
      manager: project.manager ?? "—", plannedHandover: quarterLabel(project.plannedHandoverFrom),
    };
  });
  const units = catalog.units.map((unit): UnitRecord => {
    // Pole klienta, předání a ceny patří do C/D; do té doby je presentation adapter
    // doplní pouze pro známé preview kódy, bez zápisu duplicit do produkční DB.
    const preview = previewUnits.find((candidate) => candidate.id === unit.code);
    return {
      id: unit.code, project: unit.projectName, building: unit.structureName ?? "Bez zařazení",
      layout: unit.layout ?? "—", area: unit.areaM2, floor: unit.floorLabel ?? "—",
      orientation: unit.orientation ?? "—", price: preview?.price ?? 0,
      status: commercialLabel(unit.commercialStatus), construction: constructionLabel(unit.constructionStatus),
      handover: preview?.handover ?? "Neplánováno", client: preview?.client, attention: preview?.attention,
      accessory: unit.accessories.map((item) => `${item.type} ${item.code}${item.areaM2 ? ` · ${item.areaM2} m²` : ""}`).join(" · ") || "Bez příslušenství",
    };
  });
  return { projects, units, source: "backend-api" };
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

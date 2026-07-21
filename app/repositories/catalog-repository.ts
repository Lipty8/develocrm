import type { UnitRecord } from "../crm-data";
import { projects as previewProjects } from "../crm-data";

export type ProjectRecord = (typeof previewProjects)[number];
export type CatalogSnapshot = { projects: ProjectRecord[]; units: UnitRecord[]; source: "backend-api" | "preview-seed" };

export interface CatalogRepository {
  getCatalog(signal?: AbortSignal): Promise<CatalogSnapshot>;
}

export class ApiCatalogRepository implements CatalogRepository {
  async getCatalog(signal?: AbortSignal): Promise<CatalogSnapshot> {
    const response = await fetch("/api/catalog", { signal, cache: "no-store" });
    if (!response.ok) throw new Error("Katalog projektů se nepodařilo načíst");
    return response.json() as Promise<CatalogSnapshot>;
  }
}

export const catalogRepository: CatalogRepository = new ApiCatalogRepository();

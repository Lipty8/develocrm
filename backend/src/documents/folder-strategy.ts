export type DocumentFolderKind = "contract" | "floor_plan" | "project_documentation" | "client_document" | "price_document" | "reservation" | "other";

export type FolderStrategyConfig = {
  projectsRoot: string;
  unitsSegment: string;
  clientsSegment: string;
  projectDocumentsSegment: string;
  categorySegments: Record<DocumentFolderKind, string>;
};

export const defaultFolderStrategy: FolderStrategyConfig = {
  projectsRoot: "projects",
  unitsSegment: "units",
  clientsSegment: "clients",
  projectDocumentsSegment: "project-documents",
  categorySegments: {
    contract: "contracts", floor_plan: "floor-plans", project_documentation: "documentation",
    client_document: "client-documents", price_document: "prices", reservation: "reservations", other: "other",
  },
};

/** Paths help humans browse; persisted Graph drive/item IDs remain the identity source of truth. */
export class SharePointFolderStrategy {
  constructor(private readonly config: FolderStrategyConfig = defaultFolderStrategy) {}

  projectDocuments(input: { projectId: string; projectCode: string; category: DocumentFolderKind }): string[] {
    return [this.config.projectsRoot, stableSegment(input.projectCode, input.projectId), this.config.projectDocumentsSegment, this.config.categorySegments[input.category]];
  }

  unitDocuments(input: { projectId: string; projectCode: string; unitId: string; unitCode: string; category: DocumentFolderKind }): string[] {
    return [this.config.projectsRoot, stableSegment(input.projectCode, input.projectId), this.config.unitsSegment, stableSegment(input.unitCode, input.unitId), this.config.categorySegments[input.category]];
  }

  clientDocuments(input: { projectId: string; projectCode: string; partyId: string; displayName: string }): string[] {
    return [this.config.projectsRoot, stableSegment(input.projectCode, input.projectId), this.config.clientsSegment, stableSegment(input.displayName, input.partyId)];
  }
}

function stableSegment(label: string, stableId: string): string {
  const safe = label.normalize("NFKD").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "item";
  return `${safe}--${stableId.replace(/-/g, "").slice(0, 12)}`;
}

import type { ClientRecord, ProjectRecord } from "../crm-data";
import { normalizeClientRelationshipStatus, type ClientRelationshipStatus } from "../../backend/src/shared/client-relationship";

export function clientRelationshipStatus(client: ClientRecord, project?: Pick<ProjectRecord, "backendId" | "name" | "sourceName">): ClientRelationshipStatus {
  if (project) {
    const relationship = client.projectRelationships?.find((item) =>
      (project.backendId && item.projectId === project.backendId) || item.project === project.name || item.project === project.sourceName,
    );
    if (relationship) return relationship.status;
  }
  return normalizeClientRelationshipStatus(client.state, client.lifecycleStatus);
}

export function clientRelationshipTone(status: ClientRelationshipStatus): "success" | "blue" | "neutral" {
  if (status === "Aktivní klient") return "success";
  if (status === "Zájemce") return "blue";
  return "neutral";
}

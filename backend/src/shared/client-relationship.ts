export const CLIENT_RELATIONSHIP_STATUSES = ["Aktivní klient", "Zájemce", "Archiv"] as const;

export type ClientRelationshipStatus = (typeof CLIENT_RELATIONSHIP_STATUSES)[number];

export function deriveClientRelationshipStatus(input: { archived: boolean; activeBuyerRelationship: boolean }): ClientRelationshipStatus {
  if (input.archived) return "Archiv";
  return input.activeBuyerRelationship ? "Aktivní klient" : "Zájemce";
}

export function normalizeClientRelationshipStatus(value: string | null | undefined, lifecycleStatus?: string): ClientRelationshipStatus {
  if (lifecycleStatus === "archived" || value === "Archiv" || value === "Archivovaný") return "Archiv";
  if (["Aktivní klient", "Předání", "Předáno"].includes(value ?? "")) return "Aktivní klient";
  return "Zájemce";
}

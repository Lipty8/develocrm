import type { GraphDeltaPage, GraphFileMetadata } from "./graph-adapter.js";

export type StoredDocumentProjection = {
  documentId: string;
  externalItemId: string;
  name: string;
  etag: string | null;
  webUrl: string | null;
  archived: boolean;
};

export type DocumentDeltaAction =
  | { type: "import_metadata"; item: GraphFileMetadata }
  | { type: "update_metadata"; documentId: string; item: GraphFileMetadata }
  | { type: "append_version"; documentId: string; item: GraphFileMetadata }
  | { type: "archive"; documentId: string; externalItemId: string };

/**
 * Builds an idempotent delta plan from stable Graph item IDs and etags.
 * The caller applies the complete page and encrypted checkpoint in one database
 * transaction; unique external item/version constraints make retries safe.
 */
export function planDocumentDelta(current: StoredDocumentProjection[], page: GraphDeltaPage): DocumentDeltaAction[] {
  const byItem = new Map(current.map((document) => [document.externalItemId, document]));
  const actions: DocumentDeltaAction[] = [];
  const latestItems = new Map<string, GraphFileMetadata>();
  for (const item of page.items) if (!item.isFolder && item.itemId) latestItems.set(item.itemId, item);

  for (const item of latestItems.values()) {
    const existing = byItem.get(item.itemId);
    if (!existing) {
      actions.push({ type: "import_metadata", item });
      continue;
    }
    if (existing.archived) continue;
    const metadataChanged = existing.name !== item.name || existing.webUrl !== item.webUrl;
    const contentChanged = Boolean(item.etag && item.etag !== existing.etag);
    if (metadataChanged) actions.push({ type: "update_metadata", documentId: existing.documentId, item });
    if (contentChanged) actions.push({ type: "append_version", documentId: existing.documentId, item });
  }

  for (const itemId of new Set(page.deletedItemIds)) {
    const existing = byItem.get(itemId);
    if (existing && !existing.archived) actions.push({ type: "archive", documentId: existing.documentId, externalItemId: itemId });
  }
  return actions;
}

export interface DocumentDeltaCheckpointPort {
  /** Returns a decrypted cursor only inside the trusted integration boundary. */
  loadCursor(connectionId: string): Promise<{ cursor: string | null; fingerprint: string | null }>;
  /** Applies actions and stores the new cursor encrypted, atomically. */
  applyPageAtomically(input: { connectionId: string; expectedFingerprint: string | null; actions: DocumentDeltaAction[]; nextCursor: string | null }): Promise<void>;
}

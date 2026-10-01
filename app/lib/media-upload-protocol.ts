import { validateMediaFile, type MediaKind } from "./media-validation";

export const MEDIA_UPLOAD_CHUNK_SIZE = 768 * 1024;
export const MEDIA_UPLOAD_MAX_CHUNKS = Math.ceil((25 * 1024 * 1024) / MEDIA_UPLOAD_CHUNK_SIZE);

export type MediaUploadDescriptor = {
  entityType: "project" | "unit";
  entityId: string;
  kind: MediaKind;
  fileName: string;
  mimeType: string;
  size: number;
};

export function validateMediaUploadDescriptor(value: MediaUploadDescriptor) {
  validateMediaFile({ name: value.fileName, type: value.mimeType, size: value.size }, value.kind);
  const chunkCount = Math.ceil(value.size / MEDIA_UPLOAD_CHUNK_SIZE);
  if (!Number.isSafeInteger(value.size) || value.size <= 0 || chunkCount < 1 || chunkCount > MEDIA_UPLOAD_MAX_CHUNKS) {
    throw new Error("Soubor je příliš velký.");
  }
  return { chunkCount, chunkSize: MEDIA_UPLOAD_CHUNK_SIZE };
}

export function mediaChunkBounds(index: number, size: number, chunkSize = MEDIA_UPLOAD_CHUNK_SIZE) {
  if (!Number.isSafeInteger(index) || index < 0) throw new Error("Neplatná část souboru.");
  const start = index * chunkSize;
  const end = Math.min(size, start + chunkSize);
  if (start >= size || end <= start) throw new Error("Neplatná část souboru.");
  return { start, end };
}

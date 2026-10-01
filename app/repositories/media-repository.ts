import { apiFetch, type ApiFetch } from "../lib/api-client";
import { MEDIA_UPLOAD_CHUNK_SIZE, mediaChunkBounds } from "../lib/media-upload-protocol";
import { validateMediaFile, type MediaKind } from "../lib/media-validation";

export type MediaLink = { id: string; entityType: "project" | "unit"; entityId: string; kind: MediaKind; fileName: string; mimeType: string; url: string; uploadedAt?: string; uploadedBy?: string; version?: string };

export interface MediaRepository {
  get(entityType: "project" | "unit", entityId: string, signal?: AbortSignal): Promise<MediaLink | null>;
  upload(entityType: "project" | "unit", entityId: string, kind: "cover" | "floorplan", file: File): Promise<MediaLink>;
}

async function materializeAuthenticatedMedia(media: MediaLink, fetcher:ApiFetch, signal?: AbortSignal): Promise<MediaLink> {
  const response=await fetcher(media.url,{signal,cache:"no-store"});
  if(!response.ok)throw new Error(response.status===403?"Nemáte oprávnění zobrazit toto médium.":"Médium se nepodařilo načíst.");
  const blob=await response.blob();
  return {...media,url:URL.createObjectURL(blob),mimeType:blob.type||media.mimeType};
}

async function mediaError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => ({})) as { error?: string; correlationId?: string };
  const requestId = response.headers.get("x-correlation-id") || payload.correlationId;
  return new Error(`${payload.error || fallback}${requestId ? ` · ID chyby ${requestId}` : ""}`);
}

export class ApiMediaRepository implements MediaRepository {
  constructor(private readonly fetcher:ApiFetch=apiFetch) {}
  async get(entityType: "project" | "unit", entityId: string, signal?: AbortSignal) {
    const response = await this.fetcher(`/api/media?entityType=${entityType}&entityId=${encodeURIComponent(entityId)}`, { signal, cache: "no-store" });
    if (!response.ok) return null;
    const payload = await response.json() as { media: MediaLink[] };
    const media=payload.media[0];
    return media?materializeAuthenticatedMedia(media,this.fetcher,signal):null;
  }
  async upload(entityType: "project" | "unit", entityId: string, kind: "cover" | "floorplan", file: File) {
    validateMediaFile(file, kind);
    const fallback = kind === "cover"
      ? "Titulní obrázek se nepodařilo uložit. Zkuste to prosím znovu."
      : "Půdorys se nepodařilo uložit. Zkuste to prosím znovu.";
    const startResponse = await this.fetcher("/api/media", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "start", entityType, entityId, kind, fileName: file.name, mimeType: file.type, size: file.size }),
      dataInvalidation: "none",
    });
    if (!startResponse.ok) throw await mediaError(startResponse, fallback);
    const session = await startResponse.json() as { uploadId: string; chunkSize?: number; chunkCount?: number };
    const chunkSize = session.chunkSize || MEDIA_UPLOAD_CHUNK_SIZE;
    const chunkCount = session.chunkCount || Math.ceil(file.size / chunkSize);
    try {
      for (let index = 0; index < chunkCount; index += 1) {
        const { start, end } = mediaChunkBounds(index, file.size, chunkSize);
        const chunkResponse = await this.fetcher(`/api/media?uploadId=${encodeURIComponent(session.uploadId)}&index=${index}`, {
          method: "PUT",
          headers: { "content-type": "application/octet-stream" },
          body: file.slice(start, end),
          dataInvalidation: "none",
        });
        if (!chunkResponse.ok) throw await mediaError(chunkResponse, fallback);
      }
      const response = await this.fetcher("/api/media", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ uploadId: session.uploadId }),
        dataInvalidation: "none",
      });
      if (!response.ok) throw await mediaError(response, fallback);
      const payload = await response.json() as { media?: MediaLink };
      if (!payload.media) throw new Error(fallback);
      return materializeAuthenticatedMedia(payload.media,this.fetcher);
    } catch (error) {
      await this.fetcher(`/api/media?uploadId=${encodeURIComponent(session.uploadId)}`, { method: "DELETE", dataInvalidation: "none" }).catch(() => undefined);
      throw error;
    }
  }
}

export const mediaRepository: MediaRepository = new ApiMediaRepository();

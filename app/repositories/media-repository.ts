export type MediaLink = { id: string; entityType: "project" | "unit"; entityId: string; kind: "cover" | "floorplan"; fileName: string; mimeType: string; url: string };

export interface MediaRepository {
  get(entityType: "project" | "unit", entityId: string, signal?: AbortSignal): Promise<MediaLink | null>;
  upload(entityType: "project" | "unit", entityId: string, kind: "cover" | "floorplan", file: File): Promise<MediaLink>;
}

class ApiMediaRepository implements MediaRepository {
  async get(entityType: "project" | "unit", entityId: string, signal?: AbortSignal) {
    const response = await fetch(`/api/media?entityType=${entityType}&entityId=${encodeURIComponent(entityId)}`, { signal, cache: "no-store" });
    if (!response.ok) return null;
    const payload = await response.json() as { media: MediaLink[] };
    return payload.media[0] ?? null;
  }
  async upload(entityType: "project" | "unit", entityId: string, kind: "cover" | "floorplan", file: File) {
    const form = new FormData();
    form.set("entityType", entityType); form.set("entityId", entityId); form.set("kind", kind); form.set("file", file);
    const response = await fetch("/api/media", { method: "POST", body: form });
    const payload = await response.json().catch(() => ({})) as { media?: MediaLink; error?: string };
    if (!response.ok || !payload.media) throw new Error(payload.error || "Obrázek se nepodařilo uložit");
    return payload.media;
  }
}

export const mediaRepository: MediaRepository = new ApiMediaRepository();

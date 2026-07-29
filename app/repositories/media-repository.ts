import { apiFetch } from "../lib/api-client";

export type MediaLink = { id: string; entityType: "project" | "unit"; entityId: string; kind: "cover" | "floorplan"; fileName: string; mimeType: string; url: string };

export interface MediaRepository {
  get(entityType: "project" | "unit", entityId: string, signal?: AbortSignal): Promise<MediaLink | null>;
  upload(entityType: "project" | "unit", entityId: string, kind: "cover" | "floorplan", file: File): Promise<MediaLink>;
}

async function prepareMediaUpload(file: File): Promise<File> {
  if (file.size > 12 * 1024 * 1024) throw new Error("Soubor může mít nejvýše 12 MB");
  if (file.size <= 850 * 1024) return file;

  const bitmap = await createImageBitmap(file);
  let maxDimension = 2000;
  let smallest: Blob | null = null;
  try {
    for (const quality of [0.84, 0.76, 0.68, 0.6]) {
      const scale = Math.min(1, maxDimension / bitmap.width, maxDimension / bitmap.height);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Obrázek se nepodařilo připravit");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", quality));
      if (blob && (!smallest || blob.size < smallest.size)) smallest = blob;
      if (blob && blob.size <= 850 * 1024) return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".webp", { type: "image/webp" });
      maxDimension = Math.round(maxDimension * 0.76);
    }
  } finally {
    bitmap.close();
  }
  if (!smallest) throw new Error("Obrázek se nepodařilo optimalizovat");
  return new File([smallest], file.name.replace(/\.[^.]+$/, "") + ".webp", { type: "image/webp" });
}

class ApiMediaRepository implements MediaRepository {
  async get(entityType: "project" | "unit", entityId: string, signal?: AbortSignal) {
    const response = await apiFetch(`/api/media?entityType=${entityType}&entityId=${encodeURIComponent(entityId)}`, { signal, cache: "no-store" });
    if (!response.ok) return null;
    const payload = await response.json() as { media: MediaLink[] };
    return payload.media[0] ?? null;
  }
  async upload(entityType: "project" | "unit", entityId: string, kind: "cover" | "floorplan", file: File) {
    const prepared = await prepareMediaUpload(file);
    const form = new FormData();
    form.set("entityType", entityType); form.set("entityId", entityId); form.set("kind", kind); form.set("file", prepared);
    const response = await apiFetch("/api/media", { method: "POST", body: form });
    const payload = await response.json().catch(() => ({})) as { media?: MediaLink; error?: string };
    if (!response.ok || !payload.media) throw new Error(payload.error || "Obrázek se nepodařilo uložit");
    return payload.media;
  }
}

export const mediaRepository: MediaRepository = new ApiMediaRepository();

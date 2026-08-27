export const IMAGE_MEDIA_LIMIT = 12 * 1024 * 1024;
export const PDF_MEDIA_LIMIT = 25 * 1024 * 1024;

const IMAGE_TYPES = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);

export type MediaKind = "cover" | "floorplan";

export function validateMediaFile(file: Pick<File, "name" | "type" | "size">, kind: MediaKind) {
  const extension = file.name.toLocaleLowerCase("en-US").match(/\.[^.]+$/)?.[0] ?? "";
  const expectedImageType = IMAGE_TYPES.get(extension);
  const isPdf = extension === ".pdf" && file.type === "application/pdf";
  const isImage = Boolean(expectedImageType && expectedImageType === file.type);

  if (!isImage && !(kind === "floorplan" && isPdf)) {
    throw new Error("Nepodporovaný formát souboru.");
  }
  const limit = isPdf ? PDF_MEDIA_LIMIT : IMAGE_MEDIA_LIMIT;
  if (file.size > limit) throw new Error("Soubor je příliš velký.");
  return { isPdf, limit };
}

export function mediaAccept(kind: MediaKind) {
  return kind === "floorplan"
    ? ".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
    : ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";
}

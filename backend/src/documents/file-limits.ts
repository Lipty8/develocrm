/** Business document limits. Template/contract-specific validators stay stricter. */
export const DEFAULT_DOCUMENT_MAX_BYTES = 4 * 1024 * 1024;
export const PDF_DOCUMENT_MAX_BYTES = 25 * 1024 * 1024;
export const DOCUMENT_UPLOAD_BODY_LIMIT = 4 * Math.ceil(PDF_DOCUMENT_MAX_BYTES / 3) + 64 * 1024;

export function documentMaxBytes(mimeType: string, fileName: string): number {
  return mimeType === "application/pdf" && /\.pdf$/i.test(fileName)
    ? PDF_DOCUMENT_MAX_BYTES : DEFAULT_DOCUMENT_MAX_BYTES;
}

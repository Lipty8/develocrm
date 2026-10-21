/** Conservative single mailbox for clickable contract contacts, never a mailto URI.
 * No headers, percent escapes, field switches or display-name/address lists.
 * Unsupported mailbox syntax is reported for correction, not silently rewritten.
 */
export function isDocumentMailbox(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 254) return false;
  const match = /^([A-Za-z0-9_+~-]+(?:\.[A-Za-z0-9_+~-]+)*)@([A-Za-z0-9.-]+)$/.exec(value);
  if (!match || match[1].length > 64) return false;
  const labels = match[2].split('.');
  return labels.length >= 2 && labels.every(label => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label))
    && /^[A-Za-z]{2,63}$/.test(labels.at(-1)!);
}

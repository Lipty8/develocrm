export const TABLE_COLUMN_STORAGE_VERSION = 1;

export function tableColumnStorageKey(userKey, tableId) {
  const user = String(userKey || "anonymous").trim().toLocaleLowerCase("cs-CZ");
  return `develocrm.table-columns.v${TABLE_COLUMN_STORAGE_VERSION}:${encodeURIComponent(user)}:${tableId}`;
}

export function defaultVisibleColumns(columns) {
  return columns.filter((column) => column.required || column.defaultVisible).map((column) => column.id);
}

export function normalizeVisibleColumns(columns, value) {
  if (!Array.isArray(value)) return defaultVisibleColumns(columns);
  const known = new Set(columns.map((column) => column.id));
  const requested = value.filter((id) => known.has(id));
  const required = columns.filter((column) => column.required).map((column) => column.id);
  const normalized = [...new Set([...required, ...requested])];
  return normalized.length ? normalized : defaultVisibleColumns(columns);
}

export function toggleVisibleColumn(columns, visible, id) {
  const column = columns.find((item) => item.id === id);
  if (!column || column.required) return normalizeVisibleColumns(columns, visible);
  const next = visible.includes(id) ? visible.filter((item) => item !== id) : [...visible, id];
  return normalizeVisibleColumns(columns, next);
}

export const TABLE_FILTER_TYPES = ["text", "enum", "number-range", "date-range", "relation", "boolean"];

export function normalizeComparable(value) {
  return String(value ?? "").trim().toLocaleLowerCase("cs-CZ");
}

export function matchesTableFilter(value, filter) {
  if (!filter) return true;
  if (!["number-range", "date-range"].includes(filter.type) && (filter.value == null || filter.value === "" || Array.isArray(filter.value) && filter.value.length === 0)) return true;
  if (filter.type === "text") {
    const actual = normalizeComparable(value);
    const expected = normalizeComparable(filter.value);
    if (filter.operator === "equals") return actual === expected;
    if (filter.operator === "startsWith") return actual.startsWith(expected);
    return actual.includes(expected);
  }
  if (filter.type === "enum" || filter.type === "relation") return filter.value.map(normalizeComparable).includes(normalizeComparable(value));
  if (filter.type === "boolean") return Boolean(value) === Boolean(filter.value);
  if (filter.type === "number-range") {
    const actual = Number(value);
    return Number.isFinite(actual) && (filter.from == null || filter.from === "" || actual >= Number(filter.from)) && (filter.to == null || filter.to === "" || actual <= Number(filter.to));
  }
  if (filter.type === "date-range") {
    const actual = new Date(value).getTime();
    const from = filter.from ? new Date(filter.from).getTime() : null;
    const to = filter.to ? new Date(filter.to).getTime() : null;
    return Number.isFinite(actual) && (from == null || actual >= from) && (to == null || actual <= to);
  }
  return true;
}

export function filterTableRows(rows, filters, accessors) {
  return rows.filter(row => Object.entries(filters).every(([columnId, filter]) => matchesTableFilter(accessors[columnId]?.(row), filter)));
}

export function activeTableFilterCount(filters) {
  return Object.values(filters).filter(filter => filter && (filter.value !== "" && (!Array.isArray(filter.value) || filter.value.length) || filter.from || filter.to)).length;
}

// Consistent rule: a hidden column keeps its filter. Every configurable list exposes
// the active-filter count and a global reset, so the condition never becomes invisible.
export function retainHiddenColumnFilter(filters) {
  return { ...filters };
}

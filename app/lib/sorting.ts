export type SortDirection = "asc" | "desc";

export function stableSort<T>(
  rows: T[],
  selector: (row: T) => string | number | Date | null | undefined,
  direction: SortDirection,
  stableKey: (row: T) => string,
): T[] {
  const multiplier = direction === "asc" ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const left = selector(a.row);
      const right = selector(b.row);
      const compared = compare(left, right) * multiplier;
      if (compared) return compared;
      const stable = stableKey(a.row).localeCompare(stableKey(b.row), "cs-CZ", { numeric: true });
      return stable || a.index - b.index;
    })
    .map(({ row }) => row);
}

function compare(left: string | number | Date | null | undefined, right: string | number | Date | null | undefined): number {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  if (left instanceof Date || right instanceof Date) return new Date(left).getTime() - new Date(right).getTime();
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left).localeCompare(String(right), "cs-CZ", { numeric: true, sensitivity: "base" });
}

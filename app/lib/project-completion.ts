export function projectCompletionStorageDate(month: string | null | undefined): string | null {
  if (!month) return null;
  const match = /^(\d{4})-(0[1-9]|1[0-2])(?:-\d{2})?$/.exec(month);
  return match ? `${match[1]}-${match[2]}-01` : null;
}

export function projectCompletionMonthValue(date: string | null | undefined): string {
  const normalized = projectCompletionStorageDate(date);
  return normalized ? normalized.slice(0, 7) : "";
}

export function projectCompletionLabel(date: string | null | undefined): string {
  const normalized = projectCompletionStorageDate(date);
  if (!normalized) return "Neplánováno";
  const [year, month] = normalized.split("-").map(Number);
  return new Intl.DateTimeFormat("cs-CZ", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1)));
}

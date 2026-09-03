export const PRAGUE_TIME_ZONE = "Europe/Prague";

export type DateValue = Date | string | number | null | undefined;

function validDate(value: DateValue): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatPragueDate(value: DateValue, options: Intl.DateTimeFormatOptions = {}): string {
  const date = validDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("cs-CZ", {
    timeZone: PRAGUE_TIME_ZONE,
    day: "numeric",
    month: "numeric",
    year: "numeric",
    ...options,
  }).format(date);
}

export function formatPragueTime(value: DateValue): string {
  const date = validDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("cs-CZ", {
    timeZone: PRAGUE_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatPragueDateTime(value: DateValue): string {
  const date = validDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("cs-CZ", {
    timeZone: PRAGUE_TIME_ZONE,
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatPragueMonthYear(value: DateValue): string {
  const date = validDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("cs-CZ", {
    timeZone: PRAGUE_TIME_ZONE,
    month: "long",
    year: "numeric",
  }).format(date);
}

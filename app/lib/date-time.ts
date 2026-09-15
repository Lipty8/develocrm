import { useEffect, useState } from "react";
import { PRAGUE_TIME_ZONE } from "./date-format";

export { formatPragueDate, formatPragueDateTime, formatPragueDateTimeExact, formatPragueMonthYear, formatPragueTime, PRAGUE_TIME_ZONE } from "./date-format";
export type Clock = { now(): Date };
export const systemClock: Clock = { now: () => new Date() };

export function formatPragueLongDate(value: Date): string {
  return new Intl.DateTimeFormat("cs-CZ", {
    timeZone: PRAGUE_TIME_ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(value);
}

export function useClock(clock: Clock = systemClock, intervalMs = 60_000): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const update = () => setNow(clock.now());
    update();
    const timer = window.setInterval(update, intervalMs);
    return () => window.clearInterval(timer);
  }, [clock, intervalMs]);
  return now;
}

export function addCalendarDays(value: Date, days: number): Date {
  const result = new Date(value);
  result.setDate(result.getDate() + days);
  return result;
}

export function localDateKey(value: Date): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: PRAGUE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

export function addPragueCalendarDaysKey(value: Date, days: number): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: PRAGUE_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(value);
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)?.value);
  const calendarNoonUtc = new Date(Date.UTC(read("year"), read("month") - 1, read("day") + days, 12));
  return localDateKey(calendarNoonUtc);
}

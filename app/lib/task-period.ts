import {addPragueCalendarDaysKey, localDateKey} from "./date-time";

export type TaskPeriod = "overdue" | "today" | "week";

export function matchesTaskPeriod(dueAt: string | null | undefined, period: string, now: Date): boolean {
  if (!period || !["overdue", "today", "week"].includes(period)) return true;
  if (!dueAt) return false;
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return false;
  const day = localDateKey(due);
  const today = localDateKey(now);
  if (period === "overdue") return day < today;
  if (period === "today") return day === today;
  const weekday = new Intl.DateTimeFormat("en-US", {timeZone: "Europe/Prague", weekday: "short"}).format(now);
  const dayNumber = ({Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6} as Record<string, number>)[weekday];
  if (dayNumber === undefined) return false;
  return day >= addPragueCalendarDaysKey(now, -dayNumber) && day <= addPragueCalendarDaysKey(now, 6 - dayNumber);
}

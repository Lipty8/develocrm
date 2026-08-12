export const unitCommercialStatuses = {
  available: { label: "Volný", className: "available" },
  pre_reserved: { label: "Předrezervace", className: "pre-reserved" },
  reserved: { label: "Rezervovaná", className: "reserved" },
  contracted: { label: "SBK", className: "contracted" },
  sold: { label: "KS", className: "sold" },
  handed_over: { label: "Předáno", className: "handed-over" },
  blocked: { label: "Blokováno", className: "blocked" },
} as const;

export type UnitCommercialStatusCode = keyof typeof unitCommercialStatuses;
export type CommercialSalesBucket = "available" | "preReservation" | "sold" | "unavailable";

const aliases: Record<string, UnitCommercialStatusCode> = {
  "volný": "available", "volné": "available", "k dispozici": "available",
  "předrezervace": "pre_reserved", "předrezervováno": "pre_reserved", "předrezervovaná": "pre_reserved", "předrezervované": "pre_reserved",
  "rezervováno": "reserved", "rezervovaná": "reserved", "rezervované": "reserved", "rs": "reserved",
  "smluvně zajištěno": "contracted", "sbk": "contracted", "ks": "contracted",
  "prodáno": "sold", "prodaná": "sold", "prodané": "sold", "předáno": "handed_over", "předaná": "handed_over", "předané": "handed_over",
  "blokováno": "blocked",
};

export function normalizeUnitCommercialStatus(value: string): UnitCommercialStatusCode | null {
  if (value in unitCommercialStatuses) return value as UnitCommercialStatusCode;
  return aliases[value.trim().toLocaleLowerCase("cs-CZ")] ?? null;
}

export function unitCommercialStatusLabel(value: string): string {
  const code = normalizeUnitCommercialStatus(value);
  return code ? unitCommercialStatuses[code].label : value;
}

export function unitCommercialStatusClass(value: string): string | null {
  const code = normalizeUnitCommercialStatus(value);
  return code ? unitCommercialStatuses[code].className : null;
}

/** Jednotná obchodní interpretace detailního workflow stavu pro KPI, reporty a dostupnost. */
export function getCommercialSalesBucket(value: string): CommercialSalesBucket {
  const code = normalizeUnitCommercialStatus(value);
  if (code === "available") return "available";
  if (code === "pre_reserved") return "preReservation";
  if (code === "reserved" || code === "contracted" || code === "sold" || code === "handed_over") return "sold";
  return "unavailable";
}

export function isUnitCommerciallyAvailable(value: string): boolean {
  return getCommercialSalesBucket(value) === "available";
}

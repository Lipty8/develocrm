export const unitCommercialStatuses = {
  available: { label: "Volný", className: "available" },
  pre_reserved: { label: "Předrezervace", className: "pre-reserved" },
  reserved: { label: "RS", className: "reserved" },
  contracted: { label: "SBK", className: "contracted" },
  sold: { label: "KS", className: "sold" },
  handed_over: { label: "Předáno", className: "handed-over" },
  blocked: { label: "Blokováno", className: "blocked" },
} as const;

export type UnitCommercialStatusCode = keyof typeof unitCommercialStatuses;

const aliases: Record<string, UnitCommercialStatusCode> = {
  "volný": "available", "volné": "available", "k dispozici": "available",
  "předrezervace": "pre_reserved", "předrezervováno": "pre_reserved", "předrezervované": "pre_reserved",
  "rezervováno": "reserved", "rezervované": "reserved", "rs": "reserved",
  "smluvně zajištěno": "contracted", "sbk": "contracted", "ks": "contracted",
  "prodáno": "sold", "prodané": "sold", "předáno": "handed_over", "předané": "handed_over",
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

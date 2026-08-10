export const PROJECT_CONSTRUCTION_PHASES = [
  { code: "preparation", label: "Příprava" },
  { code: "permitting", label: "Povolování" },
  { code: "construction", label: "Ve výstavbě" },
  { code: "rough_construction", label: "Hrubá stavba" },
  { code: "installations", label: "Instalace" },
  { code: "fit_out", label: "Dokončovací práce" },
  { code: "completed", label: "Dokončeno" },
] as const;

export function projectConstructionLabel(code?: string | null): string {
  return PROJECT_CONSTRUCTION_PHASES.find((phase) => phase.code === code)?.label ?? "Bez stavebního stavu";
}

export function projectConstructionCode(label?: string | null): string | null {
  return PROJECT_CONSTRUCTION_PHASES.find((phase) => phase.label === label)?.code ?? null;
}

export function projectConstructionStepIndex(code?: string | null): number {
  const index = PROJECT_CONSTRUCTION_PHASES.findIndex((phase) => phase.code === code);
  return index < 0 ? 0 : index;
}

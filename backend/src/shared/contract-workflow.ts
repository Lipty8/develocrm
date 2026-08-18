export const CONTRACT_STATUS_ORDER = [
  "draft",
  "sent",
  "negotiation",
  "approved",
  "signed",
] as const;

export type ContractStatus = typeof CONTRACT_STATUS_ORDER[number] | "signing" | "cancelled" | "terminated";

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  draft: "V přípravě",
  sent: "Odeslána",
  negotiation: "Ve vyjednávání",
  approved: "Schválená",
  signing: "Schválená",
  signed: "Podepsaná",
  cancelled: "Zrušena",
  terminated: "Ukončena",
};

export const CONTRACT_TRANSITIONS: Record<ContractStatus, ContractStatus[]> = {
  draft: ["sent", "cancelled"],
  sent: ["negotiation", "approved", "cancelled"],
  negotiation: ["sent", "approved", "cancelled"],
  approved: ["negotiation", "cancelled"],
  signing: ["approved", "negotiation", "cancelled"],
  signed: ["terminated"],
  cancelled: [],
  terminated: [],
};

const LABEL_TO_STATUS = Object.fromEntries(
  Object.entries(CONTRACT_STATUS_LABELS).map(([code, label]) => [label, code]),
) as Record<string, ContractStatus>;
LABEL_TO_STATUS["Ke kontrole"] = "approved";
LABEL_TO_STATUS["Schválená"] = "approved";
LABEL_TO_STATUS["Schválena"] = "approved";
LABEL_TO_STATUS["K podpisu"] = "signing";
LABEL_TO_STATUS["Podepsána"] = "signed";

export function normalizeContractStatus(value: string | undefined): ContractStatus {
  if (value && value in CONTRACT_STATUS_LABELS) return value as ContractStatus;
  return LABEL_TO_STATUS[value ?? ""] ?? "draft";
}

export function contractStatusLabel(value: string | undefined): string {
  return CONTRACT_STATUS_LABELS[normalizeContractStatus(value)];
}

export function availableContractTransitions(value: string | undefined): ContractStatus[] {
  return CONTRACT_TRANSITIONS[normalizeContractStatus(value)];
}

export function contractStepIndex(value: string | undefined): number {
  const normalized = normalizeContractStatus(value);
  const visibleStatus = normalized === "signing" ? "approved" : normalized;
  const index = CONTRACT_STATUS_ORDER.indexOf(visibleStatus as typeof CONTRACT_STATUS_ORDER[number]);
  return Math.max(0, index);
}

export function recommendedContractAction(input: {
  status?: string;
  type?: string;
  missingData?: number;
  missingAttachments?: number;
}): { label: string; tone: "primary" | "warning" | "neutral"; reason: string } {
  const status = normalizeContractStatus(input.status);
  const missing = (input.missingData ?? 0) + (input.missingAttachments ?? 0);
  if (status === "draft" && missing > 0) {
    return { label: "Doplnit chybějící údaje", tone: "warning", reason: `${missing} chybějící položky` };
  }
  const type = (input.type ?? "smlouvu").toUpperCase();
  const rules: Record<ContractStatus, { label: string; tone: "primary" | "warning" | "neutral"; reason: string }> = {
    draft: { label: `Odeslat ${type}`, tone: "primary", reason: "Smlouva je připravována" },
    sent: { label: "Zkontrolovat reakci klienta", tone: "primary", reason: "Smlouva čeká na reakci nebo podpis" },
    negotiation: { label: "Zapracovat připomínky", tone: "warning", reason: "Probíhá vyjednávání" },
    approved: { label: "Označit jako podepsané", tone: "primary", reason: "Schválenou verzi lze označit jako podepsanou" },
    signing: { label: "Označit jako podepsané", tone: "primary", reason: "Historická smlouva čeká na záznam podpisu" },
    signed: { label: "Bez otevřené akce", tone: "neutral", reason: "Smlouva je podepsaná" },
    cancelled: { label: "Bez otevřené akce", tone: "neutral", reason: "Smlouva byla zrušena" },
    terminated: { label: "Bez otevřené akce", tone: "neutral", reason: "Smlouva byla ukončena" },
  };
  return rules[status];
}

export function isValidContractTransition(from: string | undefined, to: string): boolean {
  return availableContractTransitions(from).includes(normalizeContractStatus(to));
}

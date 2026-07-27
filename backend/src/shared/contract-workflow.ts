export const CONTRACT_STATUS_ORDER = [
  "draft",
  "sent",
  "negotiation",
  "approved",
  "signing",
  "signed",
] as const;

export type ContractStatus = typeof CONTRACT_STATUS_ORDER[number] | "cancelled" | "terminated";

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  draft: "V přípravě",
  sent: "Odeslána",
  negotiation: "Ve vyjednávání",
  approved: "Schválena",
  signing: "K podpisu",
  signed: "Podepsána",
  cancelled: "Zrušena",
  terminated: "Ukončena",
};

export const CONTRACT_TRANSITIONS: Record<ContractStatus, ContractStatus[]> = {
  draft: ["sent", "cancelled"],
  sent: ["negotiation", "approved", "cancelled"],
  negotiation: ["sent", "approved", "cancelled"],
  approved: ["signing", "negotiation", "cancelled"],
  signing: ["negotiation", "cancelled"],
  signed: ["terminated"],
  cancelled: [],
  terminated: [],
};

const LABEL_TO_STATUS = Object.fromEntries(
  Object.entries(CONTRACT_STATUS_LABELS).map(([code, label]) => [label, code]),
) as Record<string, ContractStatus>;
LABEL_TO_STATUS["Ke kontrole"] = "approved";

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
  const index = CONTRACT_STATUS_ORDER.indexOf(normalizeContractStatus(value) as typeof CONTRACT_STATUS_ORDER[number]);
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
    approved: { label: "Připravit k podpisu", tone: "primary", reason: "Schválená verze může přejít k podpisu" },
    signing: { label: "Zkontrolovat podpisy", tone: "primary", reason: "Čeká se na požadované podpisy" },
    signed: { label: "Bez otevřené akce", tone: "neutral", reason: "Smlouva je podepsaná" },
    cancelled: { label: "Bez otevřené akce", tone: "neutral", reason: "Smlouva byla zrušena" },
    terminated: { label: "Bez otevřené akce", tone: "neutral", reason: "Smlouva byla ukončena" },
  };
  return rules[status];
}

export function isValidContractTransition(from: string | undefined, to: string): boolean {
  return availableContractTransitions(from).includes(normalizeContractStatus(to));
}

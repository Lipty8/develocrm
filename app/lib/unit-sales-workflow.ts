import type { ContractRecord, UnitCommercialContext, UnitRecord } from "../crm-data";

export const unitSalesWorkflowSteps = ["Zájem", "Předrezervace", "RS", "SBK", "KS", "Předání"] as const;

export function projectUnitSalesWorkflow(input: {
  unit: Pick<UnitRecord, "id" | "handover">;
  context?: UnitCommercialContext;
  contracts: ContractRecord[];
}): { completedThrough: number; activeIndex: number } {
  const relevant = input.contracts.filter(contract => contract.unit === input.unit.id);
  const signed = (type: "RS" | "SBK" | "KS") => relevant.some(contract =>
    contract.type.toUpperCase() === type && (contract.statusCode === "signed" || ["Podepsána","Podepsaná"].includes(contract.state)),
  );
  if (/předáno|dokončeno/i.test(input.unit.handover)) return { completedThrough: 5, activeIndex: 5 };
  if (signed("KS")) return { completedThrough: 4, activeIndex: 5 };
  if (signed("SBK")) return { completedThrough: 3, activeIndex: 4 };
  if (signed("RS")) return { completedThrough: 2, activeIndex: 3 };

  const stage = input.context?.stage;
  if (["ks", "handover"].includes(stage ?? "")) return { completedThrough: 3, activeIndex: 4 };
  if (stage === "sbk") return { completedThrough: 2, activeIndex: 3 };
  if (["reservation", "rs"].includes(stage ?? "")) return { completedThrough: 1, activeIndex: 2 };
  if (stage === "pre_reservation" || input.context?.hold?.type === "pre_reservation") return { completedThrough: 0, activeIndex: 1 };
  return { completedThrough: -1, activeIndex: 0 };
}

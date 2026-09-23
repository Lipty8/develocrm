import type { ContractRecord, UnitCommercialContext, UnitRecord } from "../crm-data";
import {getSalesProcessState,type SalesProcessProjection} from "../../backend/src/shared/next-contract-action";

export const unitSalesWorkflowSteps = ["Zájem", "V jednání", "RS", "SBK", "KS", "Předání"] as const;

export function projectUnitSalesWorkflow(input: {
  unit: Pick<UnitRecord, "id" | "handover" | "status">;
  context?: UnitCommercialContext;
  contracts: ContractRecord[];
}): SalesProcessProjection {
  const relevant = input.contracts.filter(contract => contract.unit === input.unit.id&&(!input.context?.salesCaseId||contract.salesCaseId===input.context.salesCaseId));
  const projection=getSalesProcessState({
    hasActiveSalesCase:Boolean(input.context?.salesCaseId),
    commercialStatus:input.unit.status,
    hasInterest:Boolean(input.context?.interests.length),
    salesStage:input.context?.stage,
    holdType:input.context?.hold?.type,
    handoverCompleted:/předáno|dokončeno/i.test(input.unit.handover),
    contracts:relevant.map(contract=>({
      id:contract.id??`${contract.type}-${contract.updated}`,
      type:(contract.typeCode??contract.type).toLocaleLowerCase("cs-CZ"),
      status:contract.statusCode??(["Podepsána","Podepsaná"].includes(contract.state)?"signed":contract.state),
    })),
  });
  return projection;
}

export type {SalesProcessProjection};

import type {ContractRecord,PriceHistoryRecord} from "../crm-data";
export type CommercialSnapshot={currentPrices:Record<string,number>;priceHistories:Record<string,PriceHistoryRecord[]>;contracts:ContractRecord[];contractSummary:Record<string,number>;source:"backend-api"|"preview-seed"};
export interface CommercialRepository{getSnapshot(signal?:AbortSignal):Promise<CommercialSnapshot>}
class ApiCommercialRepository implements CommercialRepository{async getSnapshot(signal?:AbortSignal){const response=await fetch("/api/commercial",{signal,cache:"no-store"});if(!response.ok)throw new Error("Ceny a smlouvy se nepodařilo načíst");return response.json() as Promise<CommercialSnapshot>;}}
export const commercialRepository:CommercialRepository=new ApiCommercialRepository();

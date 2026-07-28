import type { ContractHistoryEvent, ContractRecord, PriceHistoryRecord } from "../crm-data";
import { contractStatusLabel, isValidContractTransition, recommendedContractAction } from "../../backend/src/shared/contract-workflow";
import { recordPreviewActivity } from "./activity-repository";

export type CommercialSnapshot = {
  currentPrices: Record<string, number>;
  priceHistories: Record<string, PriceHistoryRecord[]>;
  contracts: ContractRecord[];
  contractSummary: Record<string, number>;
  priceProposals?:Array<{id:string;unit:string;priceType:string;currentAmount:number;proposedAmount:number;validFrom:string;reason:string;status:"pending"|"approved"|"rejected";proposer:string;decider?:string|null}>;
  source: "backend-api" | "preview-seed";
};

export interface CommercialRepository {
  getSnapshot(signal?: AbortSignal): Promise<CommercialSnapshot>;
  recordPrice(input: { unitId: string; unitKey?: string; priceType: string; amount: number; validFrom: string; reason: string; approverMembershipId?: string; actorName?: string }): Promise<void>;
  decidePrice(input:{proposalId:string;decision:"approved"|"rejected";reason:string;actorName?:string}):Promise<void>;
  transitionContract(input: { contractId: string; to: string; reason: string; actorName?: string }): Promise<void>;
}

type PreviewContractEdit = Pick<ContractRecord, "statusCode" | "state" | "updated" | "updatedAt" | "history">;
const PREVIEW_CONTRACT_EDITS = "develocrm.contract.edits.v31";

class ApiCommercialRepository implements CommercialRepository {
  async getSnapshot(signal?: AbortSignal) {
    const response = await fetch("/api/commercial", { signal, cache: "no-store" });
    if (!response.ok) throw new Error("Ceny a smlouvy se nepodařilo načíst");
    const snapshot = await response.json() as CommercialSnapshot;
    if (typeof window !== "undefined") {
      const edits = JSON.parse(localStorage.getItem("develocrm.price.edits") || "{}");
      for (const [unit, rows] of Object.entries(edits)) {
        snapshot.priceHistories[unit] = [...(rows as PriceHistoryRecord[]), ...(snapshot.priceHistories[unit] || [])];
        const first = (snapshot.priceHistories[unit] || [])[0];
        if (first) snapshot.currentPrices[unit] = first.amount;
      }
      snapshot.priceProposals=[...(snapshot.priceProposals??[]),...JSON.parse(localStorage.getItem("develocrm.price.proposals.v32")||"[]")];
      const contractEdits = readContractEdits();
      snapshot.contracts = snapshot.contracts.map((item) => {
        const merged = { ...item, ...(item.id ? contractEdits[item.id] : {}) };
        return { ...merged, action: recommendedContractAction({ status: merged.statusCode ?? merged.state, type: merged.type, missingData: merged.missingData, missingAttachments: merged.missingAttachments }).label };
      });
    }
    return snapshot;
  }

  async recordPrice(input: { unitId: string; unitKey?: string; priceType: string; amount: number; validFrom: string; reason: string; approverMembershipId?: string; actorName?: string }) {
    const { unitKey, actorName, ...payload } = input;
    const response = await fetch("/api/commercial/prices", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    if (response.ok) return;
    if (response.status === 503 && typeof window !== "undefined") {
      const key = unitKey ?? input.unitId;
      const author = actorName ?? "Iva Novotná";
      const proposals=JSON.parse(localStorage.getItem("develocrm.price.proposals.v32")||"[]");
      proposals.unshift({id:`preview-proposal-${crypto.randomUUID()}`,unit:key,priceType:input.priceType,currentAmount:0,proposedAmount:input.amount,validFrom:input.validFrom,reason:input.reason,status:"pending",proposer:author,decider:null});
      localStorage.setItem("develocrm.price.proposals.v32",JSON.stringify(proposals));
      recordPreviewActivity({ unitKey: key, title: "Navržena změna ceny jednotky", detail: `${author} · čeká na schválení · ${input.reason}`, icon: "price", action: "unit.price_proposed" });
      return;
    }
    const payloadError = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(payloadError.error || "Cenu se nepodařilo uložit");
  }

  async decidePrice(input:{proposalId:string;decision:"approved"|"rejected";reason:string;actorName?:string}) {
    const response=await fetch(`/api/commercial/price-proposals/${input.proposalId}/decision`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(input)});
    if(response.ok)return;
    if(response.status===503&&typeof window!=="undefined"){
      const proposals=JSON.parse(localStorage.getItem("develocrm.price.proposals.v32")||"[]") as CommercialSnapshot["priceProposals"];
      const proposal=proposals?.find(item=>item.id===input.proposalId);
      if(!proposal||proposal.status!=="pending")throw new Error("Čekající návrh ceny nebyl nalezen");
      proposal.status=input.decision;proposal.decider=input.actorName??"Jednatel";
      localStorage.setItem("develocrm.price.proposals.v32",JSON.stringify(proposals));
      if(input.decision==="approved"){
        const edits=JSON.parse(localStorage.getItem("develocrm.price.edits")||"{}") as Record<string,PriceHistoryRecord[]>;
        const row:PriceHistoryRecord={id:`preview-price-${crypto.randomUUID()}`,unit:proposal.unit,type:proposal.priceType,amount:proposal.proposedAmount,currency:"CZK",validFrom:proposal.validFrom,validTo:null,reason:proposal.reason,author:proposal.proposer,approver:proposal.decider??null};
        edits[proposal.unit]=[row,...(edits[proposal.unit]??[])];
        localStorage.setItem("develocrm.price.edits",JSON.stringify(edits));
      }
      recordPreviewActivity({unitKey:proposal.unit,title:input.decision==="approved"?"Schválena změna ceny":"Zamítnuta změna ceny",detail:`${proposal.decider} · ${input.reason}`,icon:"price",action:"unit.price_proposal_decided"});
      return;
    }
    const payload=await response.json().catch(()=>({})) as {error?:string};
    throw new Error(payload.error||"Návrh ceny se nepodařilo rozhodnout");
  }

  async transitionContract(input: { contractId: string; to: string; reason: string; actorName?: string }) {
    const response = await fetch(`/api/commercial/contracts/${input.contractId}/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
    if (response.ok) return;
    if (response.status === 503 && typeof window !== "undefined") {
      const current = await this.getSnapshot().then(snapshot => snapshot.contracts.find(contract => contract.id === input.contractId));
      if (!current) throw new Error("Smlouva nebyla v preview nalezena");
      const from = current.statusCode ?? current.state;
      if (!isValidContractTransition(from, input.to)) throw new Error("Tento přechod smlouvy není povolen");
      const occurredAt = new Date().toISOString();
      const event: ContractHistoryEvent = {
        id: `preview-contract-event-${crypto.randomUUID()}`,
        fromStatus: from,
        toStatus: input.to,
        occurredAt,
        actor: input.actorName ?? "Iva Novotná",
        note: input.reason,
        source: "manual",
      };
      const rows = readContractEdits();
      rows[input.contractId] = {
        statusCode: input.to,
        state: contractStatusLabel(input.to),
        updatedAt: occurredAt,
        updated: occurredAt,
        history: [event, ...(current.history ?? [])],
      };
      localStorage.setItem(PREVIEW_CONTRACT_EDITS, JSON.stringify(rows));
      recordPreviewActivity({ unitKey: current.unit, title: `Smlouva ${current.type}: ${contractStatusLabel(input.to)}`, detail: `${event.actor} · ${input.reason}`, icon: "contract", action: "contract.status_changed" });
      return;
    }
    const payload = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(payload.error || "Stav smlouvy se nepodařilo změnit");
  }
}

function readContractEdits(): Record<string, PreviewContractEdit> {
  if (typeof window === "undefined") return {};
  const current = JSON.parse(localStorage.getItem(PREVIEW_CONTRACT_EDITS) || "{}");
  const legacy = JSON.parse(localStorage.getItem("develocrm.contract.edits") || "{}");
  return { ...legacy, ...current };
}

export const commercialRepository: CommercialRepository = new ApiCommercialRepository();

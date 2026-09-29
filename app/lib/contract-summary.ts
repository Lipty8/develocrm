export type ContractSummaryCategory="rs"|"sbk"|"ks"|"other";

export type ContractSummaryInput={
  typeCode?:string;
  type?:string;
  parentContractId?:string|null;
  amendmentNumber?:number|null;
  baseContractType?:string|null;
};

export type ContractSummaryCounts={total:number;rs:number;sbk:number;ks:number;other:number};

/** Klasifikace vychází z doménového typu a vztahu k rodičovské smlouvě, nikdy z názvu dokumentu. */
export function contractSummaryCategory(contract:ContractSummaryInput):ContractSummaryCategory{
  if(contract.parentContractId||contract.amendmentNumber!=null)return "other";
  const code=(contract.typeCode??contract.type??"").trim().toLocaleLowerCase("cs-CZ");
  if(code==="rs"||code==="sbk"||code==="ks")return code;
  return "other";
}

export function contractSummaryCounts(contracts:readonly ContractSummaryInput[]):ContractSummaryCounts{
  return contracts.reduce<ContractSummaryCounts>((counts,contract)=>{
    counts.total+=1;
    counts[contractSummaryCategory(contract)]+=1;
    return counts;
  },{total:0,rs:0,sbk:0,ks:0,other:0});
}

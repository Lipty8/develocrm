export type ContractEndOutcome={state:'released'|'blocked'|'eligible';reasons:Array<{code:string;message:string}>;salesCaseId:string;unitId:string};
export function contractEndMessage(outcome:ContractEndOutcome){
  return outcome.state==='released'?'Obchod ukončen – jednotka uvolněna.':'Smlouva ukončena – jednotku zatím nelze uvolnit.';
}

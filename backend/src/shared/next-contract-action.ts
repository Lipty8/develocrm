export type CoreContractType="rs"|"sbk"|"ks";
export type ContractWorkflowFact={id:string;type:CoreContractType;status:string};
export type PaymentWorkflowFact={contractId:string;type:string;status:string};
export type NextContractAction=
  |{kind:"create_contract";contractType:CoreContractType;label:string}
  |{kind:"await_payment";contractType:"rs"|"sbk";label:string;obligationType:"reservation_fee"|"purchase_installment"}
  |{kind:"open_contracts";label:string}
  |{kind:"missing_sales_case";label:string};

const active=(fact:ContractWorkflowFact|undefined)=>Boolean(fact&&!['cancelled','terminated'].includes(fact.status));
const signed=(fact:ContractWorkflowFact|undefined)=>fact?.status==="signed";
const paid=(payments:PaymentWorkflowFact[],contract:ContractWorkflowFact|undefined,type:string)=>Boolean(contract&&payments.some(item=>item.contractId===contract.id&&item.type===type&&['paid','overpaid'].includes(item.status)));

export function getNextContractAction(input:{hasActiveSalesCase:boolean;contracts:ContractWorkflowFact[];payments:PaymentWorkflowFact[]}):NextContractAction{
  if(!input.hasActiveSalesCase)return{kind:"missing_sales_case",label:"Nejdříve přiřadit klienta"};
  const latest=(type:CoreContractType)=>input.contracts.find(item=>item.type===type&&active(item));
  const rs=latest("rs"),sbk=latest("sbk"),ks=latest("ks");
  if(active(ks))return{kind:"open_contracts",label:"Otevřít smlouvy"};
  if(active(sbk)){
    if(!signed(sbk))return{kind:"open_contracts",label:"Otevřít smlouvy"};
    if(!paid(input.payments,sbk,"purchase_installment"))return{kind:"await_payment",contractType:"sbk",obligationType:"purchase_installment",label:"Čeká na úhradu při SBK"};
    return{kind:"create_contract",contractType:"ks",label:"Vytvořit KS"};
  }
  if(active(rs)){
    if(!signed(rs))return{kind:"open_contracts",label:"Otevřít smlouvy"};
    if(!paid(input.payments,rs,"reservation_fee"))return{kind:"await_payment",contractType:"rs",obligationType:"reservation_fee",label:"Čeká na úhradu rezervačního poplatku"};
    return{kind:"create_contract",contractType:"sbk",label:"Vytvořit SBK"};
  }
  return{kind:"create_contract",contractType:"rs",label:"Vytvořit RS"};
}

export function contextualContractIdentity(type:CoreContractType,unitCode:string){
  const reference=`${type.toUpperCase()} ${unitCode}`;
  const title=({rs:"Rezervační smlouva",sbk:"Smlouva o budoucí kupní smlouvě",ks:"Kupní smlouva"} as const)[type];
  return{reference,title:`${title} · ${unitCode}`};
}

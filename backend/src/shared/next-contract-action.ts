export type CoreContractType="rs"|"sbk"|"ks";
export type ContractWorkflowFact={id:string;type:string;status:string};
export type NextContractAction=
  |{kind:"create_contract";contractType:CoreContractType;label:string}
  |{kind:"open_contracts";label:string}
  |{kind:"missing_sales_case";label:string}
  |{kind:"none";label:string;reason:string};

export const salesProcessSteps=[
  {code:"interest",label:"Zájem"},
  {code:"pre_reservation",label:"Předrezervace"},
  {code:"rs",label:"RS"},
  {code:"sbk",label:"SBK"},
  {code:"ks",label:"KS"},
  {code:"handover",label:"Předání"},
] as const;
export type SalesProcessProjection={
  completedThrough:number;
  activeIndex:number;
  currentStage:(typeof salesProcessSteps)[number]["code"];
  commercialStatusLabel:string;
  steps:Array<{code:(typeof salesProcessSteps)[number]["code"];label:string;state:"complete"|"current"|"pending"}>;
  nextContractAction:NextContractAction;
  unavailableReason:string|null;
};
export type SalesProcessInput={
  hasActiveSalesCase:boolean;
  contracts:ContractWorkflowFact[];
  commercialStatus?:string|null;
  salesStage?:string|null;
  holdType?:string|null;
  handoverCompleted?:boolean;
  hasInterest?:boolean;
};

const active=(fact:ContractWorkflowFact|undefined)=>Boolean(fact&&!['cancelled','terminated'].includes(fact.status));
const signed=(fact:ContractWorkflowFact|undefined)=>fact?.status==="signed";
const commercialStatusLabels:Record<string,string>={available:"Volný",pre_reserved:"Předrezervace",reserved:"Rezervovaná",contracted:"SBK",sold:"KS",handed_over:"Předáno",blocked:"Blokováno"};
const stageIndex:Record<string,number>={interest:0,pre_reservation:1,reservation:2,rs:2,sbk:3,ks:4,handover:5};

function resolveNextContractAction(input:SalesProcessInput,activeIndex:number,activeContract?:ContractWorkflowFact):NextContractAction{
  if(!input.hasActiveSalesCase)return{kind:"missing_sales_case",label:"Nejdříve přiřadit klienta"};
  if(activeContract&&!signed(activeContract))return{kind:"open_contracts",label:"Otevřít smlouvy"};
  if(activeIndex>=5)return{kind:"none",label:"",reason:"Kupní smlouva je podepsaná. Další etapou je předání."};
  const contractType=({2:"rs",3:"sbk",4:"ks"} as Record<number,CoreContractType>)[Math.max(2,activeIndex)]??"rs";
  return{kind:"create_contract",contractType,label:`Vytvořit ${contractType.toUpperCase()}`};
}

export function getSalesProcessState(input:SalesProcessInput):SalesProcessProjection{
  const latest=(type:CoreContractType)=>input.contracts.find(item=>item.type===type&&active(item));
  const rs=latest("rs"),sbk=latest("sbk"),ks=latest("ks");
  let completedThrough=-1;
  let activeIndex=0;
  let activeContract:ContractWorkflowFact|undefined;
  if(input.handoverCompleted){completedThrough=5;activeIndex=5;}
  else if(signed(ks)){completedThrough=4;activeIndex=5;}
  else if(active(ks)){completedThrough=3;activeIndex=4;activeContract=ks;}
  else if(signed(sbk)){completedThrough=3;activeIndex=4;}
  else if(active(sbk)){completedThrough=2;activeIndex=3;activeContract=sbk;}
  else if(signed(rs)){completedThrough=2;activeIndex=3;}
  else if(active(rs)){completedThrough=1;activeIndex=2;activeContract=rs;}
  else if(input.salesStage&&input.salesStage in stageIndex){activeIndex=stageIndex[input.salesStage];completedThrough=activeIndex-1;}
  else if(input.salesStage==="pre_reservation"||input.holdType==="pre_reservation"){completedThrough=0;activeIndex=1;}
  else if(input.hasActiveSalesCase||input.hasInterest){completedThrough=-1;activeIndex=0;}
  const nextContractAction=resolveNextContractAction(input,activeIndex,activeContract);
  const currentStage=salesProcessSteps[activeIndex]?.code??"interest";
  const unavailableReason=nextContractAction.kind==="none"?nextContractAction.reason:
    nextContractAction.kind==="missing_sales_case"?"Jednotka nemá aktivní obchodní proces.":
    nextContractAction.kind==="open_contracts"?"Nejdříve dokončete rozpracovanou smlouvu.":null;
  return{
    completedThrough,activeIndex,currentStage,nextContractAction,unavailableReason,
    commercialStatusLabel:input.commercialStatus?commercialStatusLabels[input.commercialStatus]??input.commercialStatus:salesProcessSteps[activeIndex]?.label??"Zájem",
    steps:salesProcessSteps.map((step,index)=>({...step,state:index<=completedThrough?"complete":index===activeIndex?"current":"pending"})),
  };
}

export function getNextContractAction(input:SalesProcessInput):NextContractAction{
  return getSalesProcessState(input).nextContractAction;
}

export function contextualContractIdentity(type:CoreContractType,unitCode:string){
  const displayName=`${type.toUpperCase()} ${unitCode}`;
  const contractName=({rs:"Rezervační smlouva",sbk:"Smlouva o smlouvě budoucí kupní",ks:"Kupní smlouva"} as const)[type];
  return{reference:displayName,title:`${contractName} · ${unitCode}`};
}

export type CoreContractType="rs"|"sbk"|"ks";
export type ContractWorkflowFact={id:string;type:string;status:string};
export type NextContractAction=
  |{kind:"create_contract";contractType:CoreContractType;allowedContractTypes:CoreContractType[];label:string}
  |{kind:"open_contracts";label:string}
  |{kind:"missing_sales_case";label:string}
  |{kind:"none";label:string;reason:string};

export const salesProcessSteps=[
  {code:"interest",label:"Zájem"},
  {code:"pre_reservation",label:"V jednání"},
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
  steps:Array<{code:(typeof salesProcessSteps)[number]["code"];label:string;state:"complete"|"current"|"pending"|"skipped"}>;
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
const commercialStatusLabels:Record<string,string>={available:"Volný",pre_reserved:"V jednání",reserved:"Rezervovaná",contracted:"SBK",sold:"KS",handed_over:"Předáno",blocked:"Blokováno"};
const stageIndex:Record<string,number>={interest:0,pre_reservation:1,reservation:2,rs:2,sbk:3,ks:4,handover:5};

function resolveNextContractAction(input:SalesProcessInput,activeIndex:number,activeContract:ContractWorkflowFact|undefined,signedTypes:Set<CoreContractType>):NextContractAction{
  if(!input.hasActiveSalesCase)return{kind:"missing_sales_case",label:"Nejdříve přiřadit klienta"};
  if(activeContract&&!signed(activeContract))return{kind:"open_contracts",label:"Otevřít smlouvy"};
  if(signedTypes.has("ks")||activeIndex>=5)return{kind:"none",label:"",reason:"Kupní smlouva je podepsaná. Další etapou je předání."};
  const allowedContractTypes:CoreContractType[]=signedTypes.has("sbk")||activeIndex>=4?["ks"]:signedTypes.has("rs")||activeIndex>=3?["sbk","ks"]:["rs","sbk","ks"];
  const contractType=allowedContractTypes[0];
  return{kind:"create_contract",contractType,allowedContractTypes,label:"Vytvořit smlouvu"};
}

export function getSalesProcessState(input:SalesProcessInput):SalesProcessProjection{
  const latest=(type:CoreContractType)=>input.contracts.find(item=>item.type===type&&active(item));
  const rs=latest("rs"),sbk=latest("sbk"),ks=latest("ks");
  const signedTypes=new Set<CoreContractType>([...(signed(rs)?["rs" as const]:[]),...(signed(sbk)?["sbk" as const]:[]),...(signed(ks)?["ks" as const]:[])]);
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
  const nextContractAction=resolveNextContractAction(input,activeIndex,activeContract,signedTypes);
  const currentStage=salesProcessSteps[activeIndex]?.code??"interest";
  const unavailableReason=nextContractAction.kind==="none"?nextContractAction.reason:
    nextContractAction.kind==="missing_sales_case"?"Jednotka nemá aktivní obchodní proces.":
    nextContractAction.kind==="open_contracts"?"Nejdříve dokončete rozpracovanou smlouvu.":null;
  return{
    completedThrough,activeIndex,currentStage,nextContractAction,unavailableReason,
    commercialStatusLabel:input.commercialStatus?commercialStatusLabels[input.commercialStatus]??input.commercialStatus:salesProcessSteps[activeIndex]?.label??"Zájem",
    steps:salesProcessSteps.map((step,index)=>{
      if(index===0||index===1)return{...step,state:(index<=completedThrough?"complete":index===activeIndex?"current":"pending") as "complete"|"current"|"pending"};
      if(step.code==="rs"||step.code==="sbk"||step.code==="ks"){
        const fact=({rs,sbk,ks} as const)[step.code];
        if(signed(fact))return{...step,state:"complete" as const};
        if(active(fact))return{...step,state:"current" as const};
        if(index<activeIndex)return{...step,state:"skipped" as const};
      }
      return{...step,state:index===activeIndex?"current" as const:"pending" as const};
    }),
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

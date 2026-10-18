export type ContractSigningPlan={versionId:string;sellerPlannedOn:string|null;buyerPlannedOn:string|null;editable:boolean};
export class ContractSigningPlanValidationError extends Error{
  constructor(){super('Zadejte platné datum ve formátu RRRR-MM-DD.');this.name='ContractSigningPlanValidationError';}
}
export function signingPlanDay(value:unknown):string|null{
  if(value===null)return null;
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<'2000-01-01'||value>'2199-12-31')throw new ContractSigningPlanValidationError();
  const day=new Date(`${value}T12:00:00Z`);
  if(!Number.isFinite(day.getTime())||day.toISOString().slice(0,10)!==value)throw new ContractSigningPlanValidationError();
  return value;
}

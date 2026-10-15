import type {ContractRecord,UnitCommercialContext,UnitRecord} from '../crm-data';

export const unitContextKey=(unit:Pick<UnitRecord,'id'|'backendId'>)=>unit.backendId??unit.id;

/** Live entities are resolved only by immutable identity, never by a display code. */
export function getUnitContext(unit:Pick<UnitRecord,'id'|'backendId'>,contexts:Record<string,UnitCommercialContext>){
  return contexts[unitContextKey(unit)];
}

export function contractBelongsToUnit(contract:ContractRecord,unit:Pick<UnitRecord,'id'|'backendId'|'projectBackendId'|'project'>){
  if(unit.backendId)return contract.unitId===unit.backendId;
  return contract.unit===unit.id&&(!contract.project||contract.project===unit.project);
}

export function currentCaseContracts(unit:Pick<UnitRecord,'id'|'backendId'|'projectBackendId'|'project'>,context:UnitCommercialContext|undefined,contracts:ContractRecord[]){
  if(!context?.salesCaseId)return [];
  return contracts.filter(contract=>contractBelongsToUnit(contract,unit)&&contract.salesCaseId===context.salesCaseId);
}

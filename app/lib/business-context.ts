import type {ClientRecord,ContractRecord,UnitCommercialContext,UnitRecord} from '../crm-data';

export const unitContextKey=(unit:Pick<UnitRecord,'id'|'backendId'>)=>unit.backendId??unit.id;

/** Live entities are resolved only by immutable identity, never by a display code. */
export function getUnitContext(unit:Pick<UnitRecord,'id'|'backendId'>,contexts:Record<string,UnitCommercialContext>){
  return contexts[unitContextKey(unit)];
}

/** History is never an implicit choice of buyer for a new sale. */
export function preferredSalesPartyId(context:UnitCommercialContext|undefined){
  return (context?.salesCaseId ? context.buyers[0]?.partyId : undefined)
    ?? context?.interests.find(item=>item.status==='active')?.partyId ?? '';
}

/** An active sale is authoritative; historic unit links are not buyer choices. */
export function clientChangeCandidates(unit:Pick<UnitRecord,'id'|'backendId'>|undefined,context:UnitCommercialContext|undefined,rows:ClientRecord[]){
  if(!unit)return [];
  if(context?.salesCaseId){
    return context.buyers.filter(buyer=>['buyer','co_buyer'].includes(buyer.role))
      .map(buyer=>rows.find(client=>client.id===buyer.partyId))
      .filter((client):client is ClientRecord=>Boolean(client));
  }
  // Keep the existing after-sale path; this is not a new ownership policy.
  return rows.filter(client=>Boolean(unit.backendId&&client.unitRelations?.some(relation=>relation.unitId===unit.backendId)));
}

export function contractBelongsToUnit(contract:ContractRecord,unit:Pick<UnitRecord,'id'|'backendId'|'projectBackendId'|'project'>){
  if(unit.backendId)return contract.unitId===unit.backendId;
  return contract.unit===unit.id&&(!contract.project||contract.project===unit.project);
}

export function currentCaseContracts(unit:Pick<UnitRecord,'id'|'backendId'|'projectBackendId'|'project'>,context:UnitCommercialContext|undefined,contracts:ContractRecord[]){
  if(!context?.salesCaseId)return [];
  return contracts.filter(contract=>contractBelongsToUnit(contract,unit)&&contract.salesCaseId===context.salesCaseId);
}

/** Present the persisted command result; never infer release policy in the UI. */
export function currentCaseReleaseBlocker(unit:Pick<UnitRecord,'id'|'backendId'|'projectBackendId'|'project'>,salesCaseId:string|null|undefined,rows:ContractRecord[]){
  if(!salesCaseId)return null;
  return rows.filter(row=>contractBelongsToUnit(row,unit)&&row.salesCaseId===salesCaseId&&row.endOutcome?.state==='blocked')
    .sort((a,b)=>(b.updatedAt??b.updated??'').localeCompare(a.updatedAt??a.updated??''))[0]?.endOutcome??null;
}

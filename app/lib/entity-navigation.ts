import type {ClientRecord,UnitRecord} from '../crm-data';
import {clientRoute,unitRoute} from '../crm-routing.mjs';

export type UnitReference={unitId?:string;unit?:string;code?:string;projectId?:string;project?:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A missing relation must never navigate to a different, arbitrary entity.
export function relatedUnitHref(reference:UnitReference,rows:UnitRecord[]):string|null{
  if(reference.unitId&&uuid.test(reference.unitId))return unitRoute(reference.unitId);
  const code=reference.unit??reference.code;
  if(!code||(!reference.projectId&&!reference.project))return null;
  const matches=rows.filter(row=>row.id===code&&(reference.projectId?row.projectBackendId===reference.projectId:row.project===reference.project));
  if(matches.length!==1)return null;
  return unitRoute(matches[0].backendId??matches[0].id);
}

export function relatedClientHref(identity:string,rows:ClientRecord[]):string|null{
  if(uuid.test(identity))return clientRoute(identity);
  const byId=rows.find(row=>row.id===identity);
  if(byId)return clientRoute(byId.id);
  const matches=rows.filter(row=>row.name===identity);
  return matches.length===1?clientRoute(matches[0].id):null;
}

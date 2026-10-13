import {createHash} from 'node:crypto';
/** Explicit flat renderer string map; ordering is stable across JSONB roundtrips. */
export function snapshotHash(snapshot:Record<string,string>):string{
 const ordered:Record<string,string>={};
 for(const key of Object.keys(snapshot).sort()){
  if(typeof snapshot[key]!=='string')throw new Error('invalid generation snapshot');
  Object.defineProperty(ordered,key,{value:snapshot[key],enumerable:true});
 }
 return createHash('sha256').update(JSON.stringify(ordered)).digest('hex');
}

import type {ClientRecord,ContractRecord,ProjectRecord,UnitRecord} from '../crm-data';
import {clientRoute,contractRoute,projectRoute,unitRoute} from '../crm-routing.mjs';
import {isArchivedProject} from './project-visibility';

export type WorkspaceSearchData={projects:ProjectRecord[];units:UnitRecord[];clients:ClientRecord[];contracts:ContractRecord[]};
export type WorkspaceSearchResult={type:'Projekt'|'Jednotka'|'Klient'|'Smlouva';title:string;detail:string;href:string};
const normalized=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('cs-CZ').trim();

// Uses only records returned by existing server-side tenant/project/permission queries.
export function searchWorkspace(data:WorkspaceSearchData,value:string):WorkspaceSearchResult[]{
  const query=normalized(value);if(query.length<2)return[];
  const matches=(...values:Array<string|undefined>)=>normalized(values.filter(Boolean).join(' ')).includes(query);
  return [
    ...data.projects.filter(row=>!isArchivedProject(row)&&matches(row.name,row.location,row.code)).slice(0,3).map(row=>({type:'Projekt' as const,title:row.name,detail:row.location,href:projectRoute(row.backendId??row.code)})),
    ...data.units.filter(row=>matches(row.id,row.client,row.project)).slice(0,4).map(row=>({type:'Jednotka' as const,title:row.id,detail:`${row.layout} · ${row.project}`,href:unitRoute(row.backendId??row.id)})),
    ...data.clients.filter(row=>row.lifecycleStatus!=='archived'&&matches(row.name,row.email,row.phone,row.contact,row.registrationNumber)).slice(0,3).map(row=>({type:'Klient' as const,title:row.name,detail:row.projects,href:clientRoute(row.id)})),
    ...data.contracts.filter(row=>Boolean(row.id)&&matches(row.reference,row.client,row.unit,row.project)).slice(0,3).map(row=>({type:'Smlouva' as const,title:row.reference??`${row.type} · ${row.unit}`,detail:`${row.client} · ${row.project}`,href:contractRoute(row.id!)})),
  ];
}

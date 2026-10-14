import type {ProjectRecord} from '../crm-data';
export type ProjectVisibility='visible'|'active'|'completed'|'archived'|'all';
export const PROJECT_VISIBILITY_OPTIONS:Array<{value:ProjectVisibility;label:string}>=[
 {value:'visible',label:'Aktivní a dokončené'},{value:'active',label:'Aktivní'},
 {value:'completed',label:'Dokončené'},{value:'archived',label:'Archivované'},{value:'all',label:'Všechny projekty'},
];
export function isArchivedProject(project:Pick<ProjectRecord,'archivedAt'|'lifecycleStatus'>){return Boolean(project.archivedAt)||project.lifecycleStatus==='archived';}
export function isActiveProject(project:Pick<ProjectRecord,'archivedAt'|'lifecycleStatus'>){return !isArchivedProject(project)&&(project.lifecycleStatus??'active')==='active';}
export function matchesProjectVisibility(project:ProjectRecord,filter:ProjectVisibility){const archived=isArchivedProject(project);return filter==='all'||(filter==='archived'?archived:!archived&&(filter==='visible'||(filter==='active'?isActiveProject(project):project.lifecycleStatus==='completed')));}

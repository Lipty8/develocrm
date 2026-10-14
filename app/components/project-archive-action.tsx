"use client";
import React,{useState} from 'react';
import type {ProjectRecord} from '../crm-data';
import {apiFetch,type ApiFetch} from '../lib/api-client';
import {isArchivedProject} from '../lib/project-visibility';
import {RowActionMenu} from './row-action-menu';
import {FormModal} from '../CRMApp';

export function ProjectArchiveAction({project,onChanged,request=apiFetch}:{project:ProjectRecord;onChanged:()=>void;request?:ApiFetch}){
 const [impact,setImpact]=useState<{activeCases:number;activeContracts:number;unpaidObligations:number}|null>(null);
 const [error,setError]=useState('');const [open,setOpen]=useState(false);const [restoreLifecycle,setRestoreLifecycle]=useState('');
 const archived=isArchivedProject(project);
 const show=async()=>{setError('');setImpact(null);setOpen(true);try{const response=await request(`/api/catalog/projects/${project.backendId}/archive-impact`);if(!response.ok)throw new Error();setImpact(await response.json());}catch{setError('Dopady archivace se nepodařilo načíst. Zavřete okno a zkuste to znovu.');}};
 return <><RowActionMenu label="Akce projektu" actions={[{label:archived?'Obnovit z archivu':'Archivovat projekt',onSelect:()=>{void show();},danger:!archived}]}/>
 {open&&<FormModal title={archived?'Obnovit projekt z archivu':'Archivovat projekt'} close={()=>setOpen(false)} saveLabel={archived?'Obnovit z archivu':'Archivovat projekt'} onSave={async()=>{
   if(!impact)throw new Error('Nejdříve musí být načteny dopady archivace.');
   if(archived&&project.lifecycleStatus==='archived'&&!restoreLifecycle)throw new Error('Vyberte obchodní stav obnoveného projektu.');
   const response=await request(`/api/catalog/projects/${project.backendId}/archive`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({archived:!archived,restoreLifecycle:restoreLifecycle||undefined})});
   if(!response.ok){const payload=await response.json().catch(()=>({}));throw new Error(payload.error??'Viditelnost projektu se nepodařilo změnit.');}
   setOpen(false);onChanged();
 }}>
 <p>{archived?'Projekt se znovu zobrazí v běžném pracovním prostoru.':'Projekt zmizí z běžných přehledů a dashboardových souhrnů. Všechna data, dokumenty a historie zůstanou zachovány. Projekt lze kdykoliv obnovit.'}</p>
 <p>Archivace nemění obchodní stav ani nezastavuje související procesy, termíny a závazky.</p>
 {impact&&<div role="status">Aktivní obchodní případy: <strong>{impact.activeCases}</strong> · Platné smlouvy: <strong>{impact.activeContracts}</strong> · Neuhrazené povinnosti: <strong>{impact.unpaidObligations}</strong>
 {(impact.activeCases>0||impact.activeContracts>0||impact.unpaidObligations>0)&&<p className="form-error">Projekt má probíhající obchodní procesy nebo závazky. Ty zůstávají v platnosti i po archivaci.</p>}</div>}
 {error&&<p role="alert">{error}</p>}
 {archived&&project.lifecycleStatus==='archived'&&<label><span>Původní obchodní stav není evidován. Vyberte stav pro obnovení.</span><select value={restoreLifecycle} onChange={event=>setRestoreLifecycle(event.target.value)}><option value="">Vyberte stav</option><option value="preparation">Příprava</option><option value="active">Aktivní</option><option value="completed">Dokončený</option></select></label>}
 </FormModal>}
 </>;
}

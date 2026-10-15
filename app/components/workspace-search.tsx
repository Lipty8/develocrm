'use client';
import {useEffect,useState} from 'react';
import {catalogRepository} from '../repositories/catalog-repository';
import {clientRepository} from '../repositories/client-repository';
import {commercialRepository} from '../repositories/commercial-repository';
import {searchWorkspace,type WorkspaceSearchData} from '../lib/workspace-search';

export function useWorkspaceSearch(query:string,focused:boolean){
  const [snapshot,setSnapshot]=useState<WorkspaceSearchData|null>(null);
  const [error,setError]=useState('');
  const enabled=focused&&query.trim().length>=2;
  useEffect(()=>{
    if(!enabled)return;
    const controller=new AbortController();
    void Promise.resolve().then(()=>{if(!controller.signal.aborted){setSnapshot(null);setError('');}});
    Promise.all([catalogRepository.getCatalog(controller.signal),clientRepository.getDirectory(controller.signal),commercialRepository.getSnapshot(controller.signal)]).then(([catalog,directory,commercial])=>{
      if(!controller.signal.aborted){setSnapshot({projects:catalog.projects,units:catalog.units,clients:directory.clients,contracts:commercial.contracts});setError('');}
    }).catch(()=>{if(!controller.signal.aborted){setSnapshot(null);setError('Vyhledávání se nepodařilo načíst. Zkuste jej otevřít znovu.');}});
    return()=>controller.abort();
  },[enabled]);
  return{results:snapshot?searchWorkspace(snapshot,query):[],loading:enabled&&!snapshot&&!error,error};
}

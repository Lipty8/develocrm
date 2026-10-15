"use client";
import {useEffect,useState} from 'react';
import {ReadError} from '../lib/read-state';

export function useAsyncRead<T>(key:string,read:(signal:AbortSignal)=>Promise<T>){
  const [attempt,setAttempt]=useState(0);
  const requestKey=`${key}:${attempt}`;
  const [result,setResult]=useState<{key:string;data?:T;error?:unknown}>({key:''});
  useEffect(()=>{
    const controller=new AbortController();
    void read(controller.signal).then(data=>{if(!controller.signal.aborted)setResult({key:requestKey,data});}).catch(error=>{if(!controller.signal.aborted)setResult({key:requestKey,error});});
    return()=>controller.abort();
  },[requestKey,read]);
  const current=result.key===requestKey?result:undefined;
  return{data:current?.data,error:current?.error,loading:!current,retry:()=>setAttempt(value=>value+1)};
}

export function AsyncNotice({loading,error,empty=false,retry}:{loading?:boolean;error?:unknown;empty?:boolean;retry?:()=>void}){
  if(!loading&&!error&&!empty)return null;
  const denied=error instanceof ReadError&&error.status===403;
  return <div className="empty-filter-state" role={error?'alert':'status'} aria-live="polite"><strong>{loading?'Načítám…':denied?'Nedostatečné oprávnění':error?'Údaje se nepodařilo načíst':'Žádné záznamy'}</strong>{Boolean(error)&&<><small>{error instanceof ReadError?error.message:'Zkuste načtení opakovat.'}</small>{retry&&<button className="secondary-button compact" onClick={retry}>Zkusit znovu</button>}</>}</div>;
}

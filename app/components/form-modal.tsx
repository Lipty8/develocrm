"use client";
import {useId,useRef,useState,type ReactNode} from 'react';
import {AlertTriangle,X} from 'lucide-react';

export function FormModal({title,subtitle,headerAside,className='',close,onSave,children,saveLabel='Uložit',submitDisabled=false}:{
  title:string;subtitle?:string;headerAside?:ReactNode;className?:string;close:()=>void;onSave:()=>Promise<void>;children:ReactNode;saveLabel?:string;submitDisabled?:boolean;
}){
  const titleId=useId();const [busy,setBusy]=useState(false);const busyRef=useRef(false);const [error,setError]=useState('');
  const dismiss=()=>{if(!busyRef.current)close();};
  const submit=async()=>{if(busyRef.current||submitDisabled)return;busyRef.current=true;setBusy(true);setError('');try{await onSave();}catch(problem){setError(problem instanceof Error?problem.message:'Změnu se nepodařilo uložit');}finally{busyRef.current=false;setBusy(false);}};
  return <div className="modal-layer"><button className="modal-scrim" onClick={dismiss} disabled={busy} aria-label="Zavřít dialog"/><div role="dialog" aria-modal="true" aria-labelledby={titleId} className={`modal form-modal ${className}`}>
    <div className="modal-head"><div><h2 id={titleId}>{title}</h2>{subtitle&&<p>{subtitle}</p>}</div>{headerAside&&<div className="modal-head-aside">{headerAside}</div>}<button className="icon-button" onClick={dismiss} disabled={busy} aria-label="Zavřít"><X size={19}/></button></div>
    <div className="modal-form">{children}{error&&<div className="form-error" role="alert"><AlertTriangle size={15}/>{error}</div>}</div>
    <div className="modal-foot"><button className="secondary-button" onClick={dismiss} disabled={busy}>Zrušit</button><button className="primary-button" onClick={()=>void submit()} disabled={busy||submitDisabled}>{busy?'Ukládám…':saveLabel}</button></div>
  </div></div>;
}

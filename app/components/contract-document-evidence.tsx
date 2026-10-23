"use client";
import {useEffect,useRef,useState} from "react";
import {apiFetch} from "../lib/api-client";
import {formatPragueDateTime} from "../lib/date-time";
import type {ContractDocumentVersion} from '../crm-data';
export type {ContractDocumentVersion} from '../crm-data';


/** The server returns the exact authorized, hash-verified version, never the
 * current SharePoint item as a fallback for an unavailable historical file. */
export function ExactContractDocumentDownload({contractId,version,label}:{contractId:string;version:ContractDocumentVersion;label?:string}){
  const identity=`${contractId}:${version.id}`;
  const [state,setState]=useState({identity,busy:false,error:''});
  const request=useRef<AbortController|null>(null);
  const resources=useRef(new Map<string,ReturnType<typeof setTimeout>>());
  useEffect(()=>{
    const urls=resources.current;
    return()=>{request.current?.abort();for(const [url,timer] of urls){clearTimeout(timer);URL.revokeObjectURL(url);}urls.clear();};
  },[identity]);
  const current=state.identity===identity?state:{busy:false,error:''};
  async function download(){
    if(request.current&&!request.current.signal.aborted)return;
    const controller=new AbortController();request.current=controller;setState({identity,busy:true,error:''});
    try{
      const response=await apiFetch(`/api/commercial/contracts/${encodeURIComponent(contractId)}/versions/${encodeURIComponent(version.id)}/document`,{signal:controller.signal,cache:'no-store'});
      if(!response.ok)throw new Error('Přesný dokument se nepodařilo ověřit a stáhnout.');
      const bytes=await response.blob();if(controller.signal.aborted)return;
      const url=URL.createObjectURL(bytes);const link=document.createElement('a');
      link.href=url;link.download=version.documentName??`smlouva-v${version.number}`;link.click();
      resources.current.set(url,setTimeout(()=>{URL.revokeObjectURL(url);resources.current.delete(url);},60000));
    }catch{
      if(!controller.signal.aborted)setState({identity,busy:false,error:'Přesný dokument se nepodařilo ověřit a stáhnout.'});
    }finally{
      if(request.current===controller)request.current=null;
      if(!controller.signal.aborted)setState(previous=>previous.identity===identity?{...previous,busy:false}:previous);
    }
  }
  return <span className="contract-document-download"><button className="secondary-button" disabled={current.busy} aria-label={label??(version.documentName?.toLowerCase().endsWith('.docx')?'Stáhnout Word':'Otevřít přesný dokument ze SharePointu')} onClick={download}>
    {current.busy?'Stahuji…':label??(version.documentName?.toLowerCase().endsWith('.docx')?'Stáhnout Word':'Otevřít přesný dokument ze SharePointu')}</button>
    {current.error&&<small role="alert">{current.error}</small>}</span>;
}

export function ContractVersionDocumentAction({contractId,version}:{contractId:string;version:ContractDocumentVersion}){
  if(version.documentVersionId&&version.documentReady)return <ExactContractDocumentDownload key={`${contractId}:${version.id}`} contractId={contractId} version={version} label={`Stáhnout dokument v${version.number}`}/>;
  return <small>{version.evidenceState==='legacy_missing'?'Podepsaný dokument dosud není doložen.':version.documentVersionId?'Dokument není dostupný.':'Bez dokumentu.'}</small>;
}
export function ContractDocumentEvidence({contractId,version,canUpload,onChanged,verifying=false}:{contractId:string;version?:ContractDocumentVersion;canUpload:boolean;onChanged:()=>void;verifying?:boolean}){
  const [file,setFile]=useState<File|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState("");const [key,setKey]=useState(()=>crypto.randomUUID());
  const signed=version?.status==='signed';
  async function upload(){if(!file||busy)return;setBusy(true);setError("");try{
    if(file.size>4*1024*1024)throw new Error("Soubor je příliš velký. Maximální velikost je 4 MB.");
    const base64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(",")[1]);reader.onerror=()=>reject(new Error("Soubor nelze načíst."));reader.readAsDataURL(file);});
    const mimeType=file.type||(file.name.toLowerCase().endsWith('.docx')?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':file.name.toLowerCase().endsWith('.pdf')?'application/pdf':'');
    const response=await apiFetch(`/api/commercial/contracts/${encodeURIComponent(contractId)}/external-document`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({fileName:file.name,mimeType,contentBase64:base64,idempotencyKey:key})});
    if(!response.ok){const payload=await response.json().catch(()=>null) as {error?:unknown}|null;throw new Error(typeof payload?.error==='string'?payload.error:"Finální dokument se nepodařilo uložit.");}setFile(null);setKey(crypto.randomUUID());onChanged();
  }catch(e){setError(e instanceof Error?e.message:"Dokument se nepodařilo uložit.");}finally{setBusy(false);}}
  return <section className="card module-card"><div className="tab-card-header"><div><h2>{signed?"Podepsaný dokument":version?.documentReady?"Dokument připraven":"Finální dokument smlouvy"}</h2>
    {version?.documentVersionId&&<p>Verze {version.number} · {version.documentName}{signed&&version.signatureRecordedAt?` · Evidováno ${formatPragueDateTime(version.signatureRecordedAt)}`:""}</p>}
    {signed&&version?.evidenceState==='legacy_missing'&&<p>Historický podpis · čeká na doložení podepsaného dokumentu. Původní evidence podpisu zůstává zachována.</p>}
    {verifying?<p role="status">Ověřuji dostupnost dokumentu…</p>:!version?.documentReady&&version?.evidenceState!=='legacy_missing'&&<p role={signed?'alert':undefined}>{signed?"Podepsaný dokument nelze ověřit. Obraťte se na administrátora.":"Před evidencí podpisu připravte finální dokument."}</p>}</div>
    {version?.documentReady&&<ExactContractDocumentDownload key={`${contractId}:${version.id}`} contractId={contractId} version={version}/>}</div>
    {canUpload&&!signed&&<div className="form-row"><label><span>Externí dokument (DOCX nebo PDF, do 4 MB)</span><input type="file" accept=".docx,.pdf" disabled={busy} onChange={event=>{setFile(event.target.files?.[0]??null);setKey(crypto.randomUUID());setError("");}}/></label>
      <button className="secondary-button" disabled={!file||busy} onClick={upload}>{busy?"Ukládám…":"Nahrát externí dokument"}</button></div>}
    {error&&<p role="alert">{error}</p>}
  </section>;
}

"use client";
import {useState} from "react";
import {apiFetch} from "../lib/api-client";
import {formatPragueDateTime} from "../lib/date-time";

export type ContractDocumentVersion={id:string;number:number;status:string;documentVersionId?:string|null;documentReady?:boolean;documentName?:string|null;signatureRecordedAt?:string|null;evidenceState?:'pending'|'documented'|'legacy_missing'|'invalid'};
export function ContractDocumentEvidence({contractId,version,canUpload,onChanged}:{contractId:string;version?:ContractDocumentVersion;canUpload:boolean;onChanged:()=>void}){
  const [file,setFile]=useState<File|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState("");const [key,setKey]=useState(()=>crypto.randomUUID());
  const signed=version?.status==='signed';
  async function upload(){if(!file||busy)return;setBusy(true);setError("");try{
    if(file.size>4*1024*1024)throw new Error("Soubor je příliš velký. Maximální velikost je 4 MB.");
    const base64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(",")[1]);reader.onerror=()=>reject(new Error("Soubor nelze načíst."));reader.readAsDataURL(file);});
    const mimeType=file.type||(file.name.toLowerCase().endsWith('.docx')?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':file.name.toLowerCase().endsWith('.pdf')?'application/pdf':'');
    const response=await apiFetch(`/api/commercial/contracts/${encodeURIComponent(contractId)}/external-document`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({fileName:file.name,mimeType,contentBase64:base64,idempotencyKey:key})});
    if(!response.ok)throw new Error("Finální dokument se nepodařilo uložit.");setFile(null);setKey(crypto.randomUUID());onChanged();
  }catch(e){setError(e instanceof Error?e.message:"Dokument se nepodařilo uložit.");}finally{setBusy(false);}}
  async function open(){if(!version)return;setError("");try{
    const response=await apiFetch(`/api/commercial/contracts/${encodeURIComponent(contractId)}/versions/${encodeURIComponent(version.id)}/document`);
    if(!response.ok)throw new Error("Přesný dokument se nepodařilo ověřit a otevřít.");const url=URL.createObjectURL(await response.blob());
    const link=document.createElement("a");link.href=url;link.download=version.documentName??"smlouva";link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
  }catch(e){setError(e instanceof Error?e.message:"Dokument není dostupný.");}}
  return <section className="card module-card"><div className="tab-card-header"><div><h2>{signed?"Podepsaný dokument":version?.documentReady?"Dokument připraven":"Finální dokument smlouvy"}</h2>
    {version?.documentVersionId&&<p>Verze {version.number} · {version.documentName}{signed&&version.signatureRecordedAt?` · Evidováno ${formatPragueDateTime(version.signatureRecordedAt)}`:""}</p>}
    {signed&&version?.evidenceState==='legacy_missing'&&<p>Historický podpis · čeká na doložení podepsaného dokumentu. Původní evidence podpisu zůstává zachována.</p>}
    {!version?.documentReady&&version?.evidenceState!=='legacy_missing'&&<p role={signed?'alert':undefined}>{signed?"Podepsaný dokument nelze ověřit. Obraťte se na administrátora.":"Před evidencí podpisu připravte finální dokument."}</p>}</div>
    {version?.documentReady&&<button className="secondary-button" onClick={open}>Otevřít přesný dokument ze SharePointu</button>}</div>
    {canUpload&&!signed&&<div className="form-row"><label><span>Externí dokument (DOCX nebo PDF, do 4 MB)</span><input type="file" accept=".docx,.pdf" disabled={busy} onChange={event=>{setFile(event.target.files?.[0]??null);setKey(crypto.randomUUID());setError("");}}/></label>
      <button className="secondary-button" disabled={!file||busy} onClick={upload}>{busy?"Ukládám…":"Nahrát externí dokument"}</button></div>}
    {error&&<p role="alert">{error}</p>}
  </section>;
}

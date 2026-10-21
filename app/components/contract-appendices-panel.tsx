"use client";
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import type {ContractAppendixSummary} from '../../backend/src/shared/contract-appendices';
import {commercialRepository} from '../repositories/commercial-repository';
import {documentRepository,type DocumentRecord,type DocumentVersionRecord} from '../repositories/document-repository';

export function ContractAppendicesPanel({contractId,projectId,summary,disabled,onSaved}:{contractId:string;projectId:string;summary:ContractAppendixSummary;disabled:boolean;onSaved:()=>Promise<void>}){
  const [editing,setEditing]=useState<{number:number;expected:string|null}|null>(null);
  const [documents,setDocuments]=useState<DocumentRecord[]>([]);
  const [versions,setVersions]=useState<DocumentVersionRecord[]>([]);
  const [documentId,setDocumentId]=useState('');const [versionId,setVersionId]=useState('');
  const [loading,setLoading]=useState(false);const [saving,setSaving]=useState(false);const [error,setError]=useState('');
  const request=useRef<AbortController|null>(null);
  useEffect(()=>()=>request.current?.abort(),[]);
  const editable=summary.editable&&!disabled&&!!summary.contractVersionId;
  async function edit(item:ContractAppendixSummary['items'][number]){
    request.current?.abort();const controller=new AbortController();request.current=controller;
    setEditing({number:item.number,expected:item.documentVersionId});setDocuments([]);setVersions([]);setDocumentId('');setVersionId('');setError('');setLoading(true);
    try{
      const result=await documentRepository.listProject(projectId,{},controller.signal);
      if(!controller.signal.aborted)setDocuments(result.documents.filter(doc=>doc.projectId===projectId&&doc.storageProvider==='sharepoint'&&doc.status!=='archived'));
    }catch(value){if(!controller.signal.aborted)setError(value instanceof Error?value.message:'Dokumenty se nepodařilo načíst.');}
    finally{if(!controller.signal.aborted)setLoading(false);}
  }
  async function choose(id:string){
    request.current?.abort();const controller=new AbortController();request.current=controller;
    setDocumentId(id);setVersionId('');setVersions([]);setError('');if(!id){setLoading(false);return;}setLoading(true);
    try{
      const doc=await documentRepository.get(id,controller.signal);
      if(!controller.signal.aborted){
        if(!doc||doc.projectId!==projectId||doc.storageProvider!=='sharepoint')throw new Error('Dokument není pro tento projekt dostupný.');
        setVersions((doc.versions??[]).filter(version=>['ready','sent','negotiation','signed'].includes(version.status)));
      }
    }catch(value){if(!controller.signal.aborted)setError(value instanceof Error?value.message:'Verze dokumentu se nepodařilo načíst.');}
    finally{if(!controller.signal.aborted)setLoading(false);}
  }
  async function save(clear=false){
    if(!editable||saving||loading||!editing||!summary.contractVersionId||!clear&&(!documentId||!versionId))return;
    setSaving(true);setError('');
    try{
      await commercialRepository.setContractAppendix(contractId,{versionId:summary.contractVersionId,number:editing.number,
        documentId:clear?null:documentId,documentVersionId:clear?null:versionId,expectedDocumentVersionId:editing.expected});
      setEditing(null);await onSaved();
    }catch(value){setError(value instanceof Error?value.message:'Přílohu se nepodařilo uložit.');}
    finally{setSaving(false);}
  }
  return <section className="contract-payment-terms" aria-label="Přílohy smlouvy">
    <h3>Přílohy smlouvy</h3>
    <p>Vyberte odpovídající dokumenty a jejich verze. Po vytvoření finálního dokumentu se přílohy této verze již nemění.</p>
    <ol>{summary.items.map(item=><li key={item.number}>
      <strong>{item.label}</strong> · {item.name?`${item.name} · ${item.version??'verze neuvedena'}`:'Dokument není vybraný nebo není dostupný'}
      {!item.available&&item.name&&<span className="badge warning">Vyžaduje kontrolu</span>}
      {editable&&<button type="button" className="secondary-button compact" disabled={saving||loading} onClick={()=>void edit(item)} aria-label={`Vybrat přílohu ${item.number}`}>Vybrat dokument</button>}
    </li>)}</ol>
    {!summary.items.length&&<p>Pro vybranou variantu zatím není určen seznam příloh.</p>}
    <Link href={`/projects/${projectId}?tab=documents`}>Otevřít dokumenty projektu</Link>
    {editing&&editable&&<form onSubmit={event=>{event.preventDefault();void save();}} aria-label={`Výběr přílohy ${editing.number}`}>
      <h4>Příloha {editing.number}: {summary.items.find(item=>item.number===editing.number)?.label}</h4>
      {loading&&<p role="status">Načítám dokumenty…</p>}
      <div className="form-row">
        <label><span>Dokument</span><select value={documentId} disabled={loading||saving} onChange={event=>void choose(event.target.value)}>
          <option value="">Vyberte dokument</option>{documents.map(doc=><option key={doc.id} value={doc.id}>{doc.name}</option>)}
        </select></label>
        <label><span>Verze dokumentu</span><select value={versionId} disabled={loading||saving||!documentId} onChange={event=>setVersionId(event.target.value)}>
          <option value="">Vyberte konkrétní verzi</option>{versions.map(version=><option key={version.id} value={version.id}>{version.label}</option>)}
        </select></label>
      </div>
      {!loading&&!documents.length&&<p>Nejsou dostupné žádné uložené dokumenty projektu.</p>}
      {!loading&&documentId&&!versions.length&&<p>Dokument nemá připravenou dostupnou verzi.</p>}
      <div className="modal-actions"><button type="button" className="secondary-button compact" disabled={saving} onClick={()=>{request.current?.abort();setEditing(null);setLoading(false);setError('');}}>Zrušit</button>
        {editing.expected&&<button type="button" className="secondary-button compact" disabled={saving||loading} onClick={()=>void save(true)}>Odebrat z této verze</button>}
        <button type="submit" className="primary-button compact" disabled={loading||saving||!documentId||!versionId}>{saving?'Ukládám…':'Uložit přílohu'}</button></div>
    </form>}
    {error&&<p className="form-error" role="alert">{error}</p>}
  </section>;
}

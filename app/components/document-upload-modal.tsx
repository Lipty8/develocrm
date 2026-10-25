"use client";
import {useState} from 'react';
import {FormModal} from './form-modal';
import {DOCUMENT_FILE_ACCEPT,isDocumentEntityId,validateDocumentFile,type UploadProject} from '../lib/document-upload';
import {standaloneDocumentTypeOptions,type DocumentRecord,type DocumentFileUploadInput} from '../repositories/document-repository';

export type DocumentUploadLink={id:string;label:string;projectId:string};
export function DocumentUploadModal({projects,units=[],parties=[],initialProjectId,existing,close,save}:{
  projects:UploadProject[];units?:DocumentUploadLink[];parties?:DocumentUploadLink[];initialProjectId?:string;existing?:DocumentRecord;
  close:()=>void;save:(input:DocumentFileUploadInput)=>Promise<void>;
}){
  const [projectId,setProjectId]=useState(()=>existing?.projectId??(initialProjectId?projects.some(p=>p.id===initialProjectId)?initialProjectId:'':projects[0]?.id??''));
  const [typeCode,setTypeCode]=useState(existing?.typeCode??'other');const [name,setName]=useState(existing?.name??'');
  const [status,setStatus]=useState<'draft'|'ready'>('draft');const [unitId,setUnitId]=useState('');const [partyId,setPartyId]=useState('');
  const [note,setNote]=useState('');const [versionLabel,setVersionLabel]=useState(()=>`v${Math.max(0,...(existing?.versions??[]).map(v=>Number(/^v(\d+)$/.exec(v.label)?.[1]??0)))+1}`);
  const [file,setFile]=useState<File|null>(null);const [key,setKey]=useState(()=>crypto.randomUUID());const [busy,setBusy]=useState(false);const [fileError,setFileError]=useState('');
  const touch=()=>setKey(crypto.randomUUID());
  const validProject=projects.some(p=>p.id===projectId);
  const validType=standaloneDocumentTypeOptions.some(t=>t.code===typeCode);
  return <FormModal title={existing?`Nová verze · ${existing.name}`:'Nahrát dokument'} close={close} saveLabel={existing?'Nahrát novou verzi':'Nahrát dokument'} submitDisabled={!validProject||!validType||Boolean(fileError)} onSave={async()=>{
    if(!validProject||!isDocumentEntityId(projectId))throw new Error('Vyberte dostupný projekt.');
    if(!validType)throw new Error('Tento dokument se připravuje ve svém obchodním procesu.');
    if(!name.trim())throw new Error('Doplňte název dokumentu.');
    if(!versionLabel.trim())throw new Error('Doplňte označení verze.');
    if(!file)throw new Error('Vyberte soubor k nahrání.');
    validateDocumentFile(file);setBusy(true);
    try{await save({projectId,documentId:existing?.id,typeCode,documentName:name.trim(),versionLabel:versionLabel.trim(),status,note:note.trim(),file,idempotencyKey:key,
      ...(!existing?{unitId:unitId||undefined,partyId:partyId||undefined}:{})});}finally{setBusy(false);}
  }}>
    {!validProject&&<p role="alert">Pro nahrání dokumentu nemáte dostupný projekt.</p>}
    <fieldset disabled={busy} className="document-upload-fields">
      <div className="form-row"><label><span>Projekt</span><select value={projectId} disabled={Boolean(existing)} onChange={event=>{setProjectId(event.target.value);setUnitId('');setPartyId('');touch();}}><option value="" disabled>Vyberte projekt</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label><span>Typ dokumentu</span><select value={typeCode} disabled={Boolean(existing)} onChange={event=>{setTypeCode(event.target.value);touch();}}>{standaloneDocumentTypeOptions.map(t=><option key={t.code} value={t.code}>{t.name}</option>)}</select></label></div>
      <label><span>Název dokumentu</span><input maxLength={260} value={name} disabled={Boolean(existing)} onChange={event=>{setName(event.target.value);touch();}}/></label>
      <label><span>Soubor</span><input aria-label="Soubor" type="file" accept={DOCUMENT_FILE_ACCEPT} onChange={event=>{const value=event.target.files?.[0]??null;setFile(value);touch();setFileError('');if(value){try{validateDocumentFile(value);if(!name&&!existing)setName(value.name.replace(/\.[^.]+$/,''));}catch(error){setFileError(error instanceof Error?error.message:'Soubor nelze načíst.');}}}}/><small>PDF do 25 MB. DOCX, JPG, PNG a WebP do 4 MB.</small></label>
      {fileError&&<p role="alert">{fileError}</p>}
      <div className="form-row"><label><span>Označení verze</span><input value={versionLabel} maxLength={80} onChange={event=>{setVersionLabel(event.target.value);touch();}}/></label><label><span>Stav dokumentu</span><select value={status} onChange={event=>{setStatus(event.target.value==='ready'?'ready':'draft');touch();}}><option value="draft">Koncept</option><option value="ready">Připraveno</option></select></label></div>
      {!existing&&<div className="form-row"><label><span>Jednotka (volitelné)</span><select value={unitId} onChange={event=>{setUnitId(event.target.value);touch();}}><option value="">Bez vazby na jednotku</option>{units.filter(u=>u.projectId===projectId&&isDocumentEntityId(u.id)).map(u=><option key={u.id} value={u.id}>{u.label}</option>)}</select></label><label><span>Klient (volitelné)</span><select value={partyId} onChange={event=>{setPartyId(event.target.value);touch();}}><option value="">Bez vazby na klienta</option>{parties.filter(p=>p.projectId===projectId&&isDocumentEntityId(p.id)).map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select></label></div>}
      <label><span>{existing?'Popis změn':'Poznámka (volitelné)'}</span><textarea rows={3} value={note} onChange={event=>{setNote(event.target.value);touch();}}/></label>
      <p className="form-help">Smlouvy, dodatky a předávací protokoly vznikají ve svém obchodním procesu.</p>
    </fieldset>
  </FormModal>;
}

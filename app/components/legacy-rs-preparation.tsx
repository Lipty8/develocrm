"use client";
import {useEffect,useRef,useState} from 'react';
import {FilePenLine} from 'lucide-react';
import {commercialRepository,LegacyRsPreparationRejectedError,type LegacyRsPreparationInput,type LegacyRsPreparationPreview} from '../repositories/commercial-repository';
import {originalMoney,sumOriginalMoney} from '../../backend/src/contracts/original-money';
import {formatMoney} from '../crm-data';
import {FormModal} from './form-modal';

function amount(raw:string){
  const compact=raw.trim().replace(/\s/g,'').replace(/Kč$/i,'').replace(',','.');
  try{return originalMoney(compact).decimal;}catch{throw new Error('Zadejte platnou částku v korunách a haléřích.');}
}
const money=(value:string|null)=>value===null?'—':formatMoney(Number(value));
function displayAmount(raw:string){if(!raw.trim())return'';try{return money(amount(raw)).replace(/\s*Kč$/,'');}catch{return raw;}}

export function LegacyRsPreparation({contractId,unitLabel,disabled,onSaved}:{contractId:string;unitLabel:string;disabled:boolean;onSaved:()=>Promise<void>}){
  const [open,setOpen]=useState(false),[preview,setPreview]=useState<LegacyRsPreparationPreview|null>(null);
  const [loading,setLoading]=useState(false),[error,setError]=useState('');
  const [price,setPrice]=useState(''),[fee,setFee]=useState(''),[reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false);
  const [pending,setPending]=useState(false),[saved,setSaved]=useState(false);
  const attempt=useRef<LegacyRsPreparationInput|null>(null),request=useRef<AbortController|null>(null);
  useEffect(()=>()=>request.current?.abort(),[]);
  async function load(){
    if(attempt.current)return;
    request.current?.abort();const controller=new AbortController();request.current=controller;
    setLoading(true);setError('');setPreview(null);setConfirmed(false);
    try{const value=await commercialRepository.getLegacyRsPreparation(contractId,controller.signal);if(!controller.signal.aborted)setPreview(value);}
    catch(value){if(!controller.signal.aborted)setError(value instanceof Error?value.message:'Náhled se nepodařilo načíst.');}
    finally{if(!controller.signal.aborted)setLoading(false);}
  }
  let total:string|null=null;
  if(preview&&price.trim())try{total=sumOriginalMoney([amount(price),preview.accessoryPrice]);}catch{/* Invalid draft stays editable; submit explains it. */}
  async function save(){
    if(disabled)throw new Error('Příprava smlouvy nyní není dostupná.');
    if(saved){await onSaved();setOpen(false);return;}
    if(!attempt.current){
      if(!preview||loading)throw new Error('Nejdříve načtěte náhled smluvních údajů.');
      if(!confirmed)throw new Error('Potvrďte sjednanou cenu a uvedené příslušenství.');
      const agreedUnitPrice=amount(price),reservationFee=amount(fee);
      let agreedTotal:string;
      try{agreedTotal=sumOriginalMoney([agreedUnitPrice,preview.accessoryPrice]);}catch{throw new Error('Sjednaná cena přesahuje podporovaný rozsah. Zkontrolujte částku.');}
      if(originalMoney(reservationFee).minor<=BigInt(0)||originalMoney(reservationFee).minor>originalMoney(agreedTotal).minor)
        throw new Error('Rezervační poplatek musí být kladný a nesmí převýšit sjednanou cenu.');
      if(reason.trim().length<5)throw new Error('Doplňte stručný důvod přípravy smlouvy.');
      attempt.current={expectedVersionId:preview.versionId,previewToken:preview.previewToken,agreedUnitPrice,reservationFee,reason:reason.trim(),idempotencyKey:crypto.randomUUID()};
    }
    setPending(true);setError('');
    try{await commercialRepository.prepareLegacyRs(contractId,attempt.current);setSaved(true);setPending(false);await onSaved();setOpen(false);}
    catch(value){
      if(value instanceof LegacyRsPreparationRejectedError){attempt.current=null;setPending(false);setConfirmed(false);setPreview(null);}
      throw value;
    }
  }
  return <>
    <button className="secondary-button compact" disabled={disabled} onClick={()=>{setOpen(true);if(!attempt.current&&!saved)void load();}}><FilePenLine size={15}/> Doplnit smluvní údaje</button>
    {open&&<FormModal title="Doplnit údaje RS" subtitle={`Jednotka ${unitLabel}`} close={()=>{request.current?.abort();setOpen(false);}} onSave={save}
      saveLabel={saved?'Obnovit přehled':pending?'Ověřit předchozí uložení':'Potvrdit a vytvořit verzi'} submitDisabled={disabled||loading||!preview&&!pending&&!saved}>
      <p className="form-info">Vznikne nová pracovní verze. Původní historie zůstane zachovaná. Touto akcí smlouvu negenerujete ani nepodepisujete.</p>
      {loading&&<p role="status">Načítám cenu a příslušenství…</p>}
      {error&&<p className="form-error" role="alert">{error}</p>}
      {pending&&<p className="form-info" role="status">Výsledek uložení zatím není potvrzený. Ověřte stejný požadavek před dalšími změnami.</p>}
      {saved&&<p role="status">Údaje jsou uložené. Zbývá obnovit přehled smlouvy.</p>}
      {!loading&&!pending&&!saved&&<button type="button" className="secondary-button compact" onClick={()=>void load()}>Načíst aktuální náhled</button>}
      {preview&&<>
        <h3>Aktuální ceník a příslušenství</h3>
        <dl className="rs-preparation-summary">
          <div><dt>Ceníková cena jednotky</dt><dd>{money(preview.currentUnitPrice)}</dd></div>
          <div><dt>Příslušenství celkem</dt><dd>{money(preview.accessoryPrice)}</dd></div>
          <div><dt>Aktuální ceníkový součet</dt><dd>{money(preview.currentTotalPrice)}</dd></div>
        </dl>
        {preview.accessories.length?<ul>{preview.accessories.map(item=><li key={item.assignmentId}>{item.code} · {money(item.amount)}</li>)}</ul>:<p>Bez aktuálně přiřazeného příslušenství.</p>}
        <div className="form-row">
          <label><span>Sjednaná cena jednotky</span><span className="money-input"><input inputMode="decimal" value={price} disabled={pending||saved} onChange={e=>{setPrice(e.target.value);setConfirmed(false);}} onBlur={()=>setPrice(displayAmount(price))}/><b>Kč</b></span></label>
          <label><span>Rezervační poplatek</span><span className="money-input"><input inputMode="decimal" value={fee} disabled={pending||saved} onChange={e=>{setFee(e.target.value);setConfirmed(false);}} onBlur={()=>setFee(displayAmount(fee))}/><b>Kč</b></span></label>
        </div>
        {preview.currentUnitPrice!==null&&<button type="button" className="secondary-button compact" disabled={pending||saved} onClick={()=>{setPrice(displayAmount(preview.currentUnitPrice!));setConfirmed(false);}}>Použít aktuální cenu jednotky</button>}
        <dl className="rs-preparation-summary"><div><dt>Sjednaná cena včetně uvedeného příslušenství</dt><dd>{money(total)}</dd></div></dl>
        <label><span>Důvod přípravy</span><textarea rows={2} maxLength={1000} value={reason} disabled={pending||saved} onChange={e=>setReason(e.target.value)} placeholder="Např. doplnění potvrzených údajů importované smlouvy"/></label>
        <label className="checkbox-label"><input type="checkbox" checked={confirmed} disabled={pending||saved} onChange={e=>setConfirmed(e.target.checked)}/><span>Potvrzuji sjednanou cenu a uvedené příslušenství.</span></label>
      </>}
    </FormModal>}
  </>;
}

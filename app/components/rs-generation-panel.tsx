"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {Clock3,ExternalLink,FileText,History} from 'lucide-react';
import {commercialRepository,type RsReadiness} from '../repositories/commercial-repository';
import {formatMoney} from '../crm-data';
import {formatPragueDate} from '../lib/date-time';
import {signingPlanDay,type ContractSigningPlan} from '../../backend/src/shared/contract-signing-plan';

export function ContractSigningPlanForm({plan,contractId,disabled,onSaved}:{plan:ContractSigningPlan;contractId:string;disabled:boolean;onSaved:()=>Promise<void>}){
  const [seller,setSeller]=useState(plan.sellerPlannedOn??'');const [buyer,setBuyer]=useState(plan.buyerPlannedOn??'');
  const [saving,setSaving]=useState(false);const [error,setError]=useState('');
  return <form className="contract-payment-terms" onSubmit={async event=>{
    event.preventDefault();if(saving||disabled)return;setError('');setSaving(true);
    try{await commercialRepository.setSigningPlan(contractId,{versionId:plan.versionId,sellerPlannedOn:signingPlanDay(seller||null),buyerPlannedOn:signingPlanDay(buyer||null)});await onSaved();}
    catch(value){setError(value instanceof Error?value.message:'Plánovaná data se nepodařilo uložit.');}finally{setSaving(false);}
  }}>
    <h3>Plánovaná data podpisu</h3><p>Data budou uvedena v připravovaném dokumentu. Nejde o evidenci skutečného podpisu a neurčují splatnost platby.</p>
    <div className="form-row"><label><span>Prodávající – plánované datum podpisu</span><input type="date" min="2000-01-01" max="2199-12-31" value={seller} disabled={disabled||saving} onChange={event=>setSeller(event.target.value)}/></label>
      <label><span>Kupující – plánované datum podpisu</span><input type="date" min="2000-01-01" max="2199-12-31" value={buyer} disabled={disabled||saving} onChange={event=>setBuyer(event.target.value)}/></label></div>
    {error&&<p className="form-error" role="alert">{error}</p>}
    <button className="secondary-button compact" type="submit" disabled={disabled||saving}>{saving?'Ukládám…':'Uložit plánovaná data'}</button>
  </form>;
}

export function RsPreparationReturn({search}:{search:string}){
  const target=new URLSearchParams(search.replace(/^\?/, '')).get('returnTo');
  return target&&/^\/contracts\/[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(target)?<div className="unit-breadcrumb"><Link href={target}>← Zpět k přípravě smlouvy</Link></div>:null;
}

export function RsGenerationPanel({contractId,contractType='rs',canGenerate,onChanged,onShowVersions}:{contractId:string;contractType?:'rs'|'sbk';canGenerate:boolean;onChanged:()=>void;onShowVersions?:()=>void}){
  const [readiness,setReadiness]=useState<RsReadiness|null>(null);
  const [error,setError]=useState('');const [working,setWorking]=useState(false);const [checking,setChecking]=useState(true);
  const request=useRef<AbortController|null>(null);const generationKey=useRef<string|null>(null);
  const reload=useCallback(async()=>{
    request.current?.abort();const controller=new AbortController();request.current=controller;setChecking(true);setError('');
    try{const value=await commercialRepository.getRsReadiness(contractId,controller.signal);if(!controller.signal.aborted)setReadiness(value);}
    catch(value){if(!controller.signal.aborted){setReadiness(null);setError(value instanceof Error?value.message:'Připravenost smlouvy nelze ověřit.');}}
    finally{if(!controller.signal.aborted)setChecking(false);}
  },[contractId]);
  useEffect(()=>{
    const refresh=()=>{if(document.visibilityState!=='hidden')void reload();};
    void Promise.resolve().then(refresh);window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);
    return()=>{request.current?.abort();window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
  },[reload]);
  async function generate(){
    if(working||checking||!readiness?.ready)return;
    setWorking(true);setError('');generationKey.current??=crypto.randomUUID();
    try{await commercialRepository.generateRs(contractId,generationKey.current);generationKey.current=null;await reload();onChanged();}
    catch(value){setError(value instanceof Error?value.message:'Rezervační smlouvu nelze vytvořit.');}
    finally{setWorking(false);}
  }
  const summary=readiness?.summary;const money=(amount:number|null)=>amount==null?'—':formatMoney(amount);
  const returnTo=`returnTo=${encodeURIComponent(`/contracts/${contractId}`)}`;
  const type=contractType==='sbk'?'SBK':'RS';
  const title=contractType==='sbk'?'Příprava smlouvy o budoucí kupní smlouvě':'Příprava rezervační smlouvy';
  return <section className="card detail-tab-card rs-generation-card" aria-label={title}>
    <div className="tab-card-header"><h2>{title}</h2>{readiness?.currentDocument?.webUrl&&<a className="secondary-button compact" href={readiness.currentDocument.webUrl} target="_blank" rel="noreferrer"><ExternalLink size={15}/> Otevřít dokument</a>}</div>
    {error&&<div className="form-error" role="alert">{error}</div>}
    {checking&&<div className="empty-next" role="status"><Clock3 size={18}/><strong>Kontroluji připravenost…</strong></div>}
    {readiness&&<div className="rs-generation-status" aria-busy={checking}>
      <div><span className={`badge ${readiness.ready?'success':'warning'}`}>{readiness.ready?'Připraveno ke generování':'Příprava vyžaduje doplnění'}</span>{readiness.currentDocument&&<strong>Dokument připraven · verze {readiness.currentDocument.version}</strong>}</div>
      {summary&&<dl className="rs-preparation-summary">
        <div><dt>Projekt</dt><dd><Link href={`/projects/${summary.project.id}?${returnTo}`}>{summary.project.label}</Link></dd></div>
        <div><dt>Prodávající</dt><dd>{summary.seller||'Není nastaven'}</dd></div>
        <div><dt>Jednotka</dt><dd><Link href={`/units/${summary.unit.id}?${returnTo}`}>{summary.unit.label}</Link></dd></div>
        <div><dt>Kupující</dt><dd>{summary.buyers.length?summary.buyers.map(b=><Link key={b.id} href={`/clients/${b.id}?${returnTo}`}>{b.label}</Link>):'Není přiřazen'}</dd></div>
        <div><dt>Cena jednotky</dt><dd>{money(summary.unitPrice)}</dd></div>
        <div><dt>Sjednaná kupní cena celkem</dt><dd>{money(summary.totalPrice)}</dd></div>
        <div><dt>Příslušenství</dt><dd>{summary.accessories.join(', ')||'Bez příslušenství'}</dd></div>
        <div><dt>Rezervační poplatek</dt><dd>{money(summary.reservationFee)}</dd></div>
        {(summary.paymentTimingLabel||contractType==='rs')&&<div><dt>Splatnost podle smlouvy</dt><dd>{summary.paymentTimingLabel??`${summary.reservationFeeDueDays} pracovních dnů od podpisu`}</dd></div>}
        {contractType==='rs'&&<div><dt>Rezervační doba</dt><dd>{summary.reservationPeriodDays} dní</dd></div>}
        <div><dt>{summary.template?.approvalStatus&&summary.template.approvalStatus!=='approved'?'Šablona ke kontrole':'Schválená šablona'}</dt><dd>{summary.template?`${summary.template.name} · ${summary.template.version}`:'Není dostupná'}</dd></div>
        {summary.template?.effectiveFrom&&<div><dt>Šablona účinná od</dt><dd>{formatPragueDate(summary.template.effectiveFrom)}</dd></div>}
      </dl>}
      {summary?.signingPlan&&(canGenerate&&summary.signingPlan.editable?<ContractSigningPlanForm key={`${summary.signingPlan.versionId}:${summary.signingPlan.sellerPlannedOn}:${summary.signingPlan.buyerPlannedOn}`} plan={summary.signingPlan} contractId={contractId} disabled={working||checking} onSaved={reload}/>:<div className="contract-payment-terms"><h3>Plánovaná data podpisu</h3><p>Prodávající: {formatPragueDate(summary.signingPlan.sellerPlannedOn)} · Kupující: {formatPragueDate(summary.signingPlan.buyerPlannedOn)}</p>{!summary.signingPlan.editable&&<p>Pro změnu dat v dokumentu vytvořte novou verzi smlouvy.</p>}</div>)}
      {readiness.issues.length>0&&<ul>{readiness.issues.map(item=><li key={`${item.code}-${item.field}`}><span>{item.message}</span>{item.action&&<Link href={item.action.href}>{item.action.label}</Link>}</li>)}</ul>}
      <div className="project-detail-actions"><button className="secondary-button compact" onClick={()=>void reload()} disabled={working||checking}>Znovu zkontrolovat</button>
        {readiness.currentDocument&&onShowVersions&&<button className="secondary-button compact" onClick={onShowVersions}><History size={15}/> Historie verzí</button>}
        {canGenerate&&readiness.ready&&<button className="primary-button" disabled={working||checking} onClick={()=>void generate()}><FileText size={16}/>{working?'Vytvářím…':readiness.currentDocument?`Vytvořit novou verzi ${type}`:`Vygenerovat ${type}`}</button>}
      </div>
    </div>}
  </section>;
}

"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {Clock3,ExternalLink,FileText,History} from 'lucide-react';
import {commercialRepository,ContractGenerationNotReadyError,type RsReadiness} from '../repositories/commercial-repository';
import {formatMoney} from '../crm-data';
import {formatPragueDate} from '../lib/date-time';
import {signingPlanDay,type ContractSigningPlan} from '../../backend/src/shared/contract-signing-plan';
import {ContractAppendicesPanel} from './contract-appendices-panel';
import {LegacyRsPreparation} from './legacy-rs-preparation';

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
  const [storedReadiness,setReadiness]=useState<RsReadiness|null>(null);
  const readiness=storedReadiness?.contractId===contractId?storedReadiness:null;
  const [error,setError]=useState('');const [working,setWorking]=useState(false);const [checking,setChecking]=useState(true);
  const [pendingGeneration,setPendingGeneration]=useState(false);
  const request=useRef<AbortController|null>(null);const generationKey=useRef<string|null>(null);
  const reload=useCallback(async()=>{
    request.current?.abort();const controller=new AbortController();request.current=controller;setChecking(true);setError('');
    try{const value=await commercialRepository.getRsReadiness(contractId,controller.signal);if(!controller.signal.aborted){
      if(value.pendingGeneration?.recoverable){generationKey.current=value.pendingGeneration.idempotencyKey;setPendingGeneration(true);}
      setReadiness(value);
    }}
    catch(value){if(!controller.signal.aborted){setReadiness(null);setError(value instanceof Error?value.message:'Připravenost smlouvy nelze ověřit.');}}
    finally{if(!controller.signal.aborted)setChecking(false);}
  },[contractId]);
  useEffect(()=>{
    generationKey.current=null;
    const refresh=()=>{if(document.visibilityState!=='hidden')void reload();};
    void Promise.resolve().then(()=>{setPendingGeneration(false);refresh();});window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);
    return()=>{request.current?.abort();window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
  },[reload]);
  async function generate(){
    if(working||checking||!canGenerate||!generationKey.current&&!readiness?.ready)return;
    setWorking(true);setError('');generationKey.current??=crypto.randomUUID();setPendingGeneration(true);
    try{await commercialRepository.generateContract(contractId,generationKey.current);generationKey.current=null;setPendingGeneration(false);await reload();onChanged();}
    catch(value){
      if(value instanceof ContractGenerationNotReadyError){generationKey.current=null;setPendingGeneration(false);}
      // Data may have changed since the successful preflight. Do not leave a
      // stale ready CTA visible after the server refused generation.
      if(request.current&&!request.current.signal.aborted)await reload();
      setError(value instanceof Error?value.message:'Smlouvu nelze vytvořit.');
    }
    finally{setWorking(false);}
  }
  async function preparePaymentPlan(){
    const preparation=readiness?.summary?.paymentPlanPreparation;
    if(working||checking||generationKey.current||!canGenerate||!preparation?.canPrepare)return;
    setWorking(true);setError('');
    try{await commercialRepository.preparePaymentTerms(contractId,preparation.versionId);await reload();onChanged();}
    catch(value){setError(value instanceof Error?value.message:'Platební plán se nepodařilo připravit.');}
    finally{setWorking(false);}
  }
  const summary=readiness?.summary;const money=(amount:number|null)=>amount==null?'—':formatMoney(amount);
  const returnTo=`returnTo=${encodeURIComponent(`/contracts/${contractId}`)}`;
  const type=contractType==='sbk'?'SBK':'RS';
  const title=contractType==='sbk'?'Příprava smlouvy o budoucí kupní smlouvě':'Příprava rezervační smlouvy';
  return <section className="card detail-tab-card rs-generation-card" aria-label={title}>
    <div className="tab-card-header"><h2>{title}</h2>{readiness?.currentDocument?.webUrl&&<a className="secondary-button compact" href={readiness.currentDocument.webUrl} target="_blank" rel="noreferrer"><ExternalLink size={15}/> Otevřít dokument</a>}</div>
    {error&&<div className="form-error" role="alert">{error}</div>}
    {pendingGeneration&&!working&&<p className="form-info" role="status">Výsledek předchozího pokusu zatím není potvrzený. Nejdříve ověřte nebo dokončete stejný dokument; další verzi můžete vytvořit potom.</p>}
    {checking&&<div className="empty-next" role="status"><Clock3 size={18}/><strong>Kontroluji připravenost…</strong></div>}
    {readiness&&<div className="rs-generation-status" aria-busy={checking}>
      <div><span className={`badge ${readiness.ready&&!pendingGeneration?'success':'warning'}`}>{pendingGeneration?'Výsledek vyžaduje ověření':readiness.ready?'Připraveno ke generování':'Příprava vyžaduje doplnění'}</span>{readiness.currentDocument&&<strong>Dokument připraven · verze {readiness.currentDocument.version}</strong>}</div>
      {summary&&<dl className="rs-preparation-summary">
        <div><dt>Projekt</dt><dd><Link href={`/projects/${summary.project.id}?${returnTo}`}>{summary.project.label}</Link></dd></div>
        <div><dt>Prodávající</dt><dd>{summary.seller||'Není nastaven'}</dd></div>
        <div><dt>Jednotka</dt><dd><Link href={`/units/${summary.unit.id}?${returnTo}`}>{summary.unit.label}</Link></dd></div>
        <div><dt>Kupující</dt><dd>{summary.buyers.length?summary.buyers.map(b=><Link key={b.id} href={`/clients/${b.id}?${returnTo}`}>{b.label}</Link>):'Není přiřazen'}</dd></div>
        <div><dt>Cena jednotky</dt><dd>{money(summary.unitPrice)}</dd></div>
        <div><dt>Sjednaná kupní cena celkem</dt><dd>{money(summary.totalPrice)}</dd></div>
        <div><dt>Příslušenství ve smlouvě</dt><dd>{summary.unitPrice==null||summary.totalPrice==null?'Ve smlouvě zatím není potvrzené':summary.accessories.join(', ')||'Bez příslušenství'}</dd></div>
        <div><dt>Rezervační poplatek</dt><dd>{money(summary.reservationFee)}</dd></div>
        {(summary.paymentTimingLabel||contractType==='rs')&&<div><dt>Splatnost podle smlouvy</dt><dd>{summary.paymentTimingLabel??`${summary.reservationFeeDueDays} pracovních dnů od podpisu`}</dd></div>}
        {contractType==='rs'&&<div><dt>Rezervační doba</dt><dd>{summary.reservationPeriodDays} dní</dd></div>}
        <div><dt>{summary.template?.approvalStatus&&summary.template.approvalStatus!=='approved'?'Šablona ke kontrole':'Schválená šablona'}</dt><dd>{summary.template?`${summary.template.name} · ${summary.template.version}`:'Není dostupná'}</dd></div>
        {summary.template?.effectiveFrom&&<div><dt>Šablona účinná od</dt><dd>{formatPragueDate(summary.template.effectiveFrom)}</dd></div>}
      </dl>}
      {summary&&contractType==='rs'&&canGenerate&&summary.unitPrice===null&&summary.totalPrice===null&&summary.reservationFee===null
        &&!readiness.currentDocument&&!readiness.issues.some(item=>item.code==='closed_case')&&readiness.issues.some(item=>item.code==='price')&&<LegacyRsPreparation key={contractId} contractId={contractId} unitLabel={summary.unit.label}
        disabled={working||checking||pendingGeneration} onSaved={async()=>{await reload();onChanged();}}/>}
      {summary?.appendices&&<ContractAppendicesPanel key={`${contractId}:${summary.appendices.contractVersionId}`} contractId={contractId} projectId={summary.project.id} unitId={summary.unit.id}
        summary={summary.appendices} disabled={!canGenerate||working||checking||pendingGeneration} onSaved={async()=>{await reload();onChanged();}}/>}
      {summary?.precedingRsComparison&&<div className="contract-payment-terms" aria-label="Porovnání s podepsanou RS">
        <h3>Porovnání s podepsanou RS</h3><p>{summary.precedingRsComparison.message}</p>
        {summary.precedingRsComparison.contractId&&<p><Link href={`/contracts/${summary.precedingRsComparison.contractId}`}>Otevřít {summary.precedingRsComparison.reference??'podepsanou RS'} · verze {summary.precedingRsComparison.contractVersion}</Link></p>}
        {summary.precedingRsComparison.buyerChanged&&<p>Kupující je jiný klientský záznam než při vytvoření RS. Ověřte návaznost změny kupujícího a smluvních stran.</p>}
        {summary.precedingRsComparison.differences.length>0&&<div className="unit-table-wrap"><table className="data-table"><thead><tr><th>Údaj</th><th>Podepsaná RS</th><th>Připravovaná SBK</th></tr></thead><tbody>
          {summary.precedingRsComparison.differences.map(item=><tr key={item.field}><th scope="row">{item.label}</th><td>{item.previous}</td><td>{item.current}</td></tr>)}
        </tbody></table></div>}
        {summary.precedingRsComparison.differences.some(item=>item.valuesRestricted)&&<p>Podrobné osobní údaje ověřte na kartě kupujícího a v podepsané RS; tento přehled zobrazuje pouze jejich změnu.</p>}
        {summary.precedingRsComparison.status==='compared'&&<p>Porovnáno {summary.precedingRsComparison.comparedFields} údajů. SBK používá údaje své připravované verze; z RS se nic automaticky nepřepisuje.</p>}
      </div>}
      {summary?.paymentPlan&&<div className="contract-payment-terms" aria-label="Platební plán smlouvy"><h3>Platební plán</h3>
        <dl className="rs-preparation-summary">{summary.paymentPlan.rows.map(row=><div key={row.key}>
          <dt>{row.key==='rs_fee'?'Rezervační poplatek':row.key==='sbk_first'?'První splátka SBK':'Doplatek SBK'}</dt>
          <dd>{formatMoney(Number(row.amount))}<br/>{row.days} {row.calendar==='calendar_days'?'kalendářních dnů':row.days===3?'pracovní dny':'pracovních dnů'} od {row.anchor==='notice_delivery'?'doručení výzvy':'posledního potřebného podpisu'}</dd>
        </div>)}<div><dt>Variabilní symbol</dt><dd>{summary.paymentPlan.variableSymbol}</dd></div></dl>
        <p>Konkrétní splatnost vznikne až po evidenci skutečného podpisu nebo doručení výzvy.</p>
      </div>}
      {!summary?.paymentPlan&&summary?.paymentPlanPreparation&&<div className="contract-payment-terms">
        {summary.paymentPlanPreparation.hasExistingObligations?<p>Smlouva již má platební předpisy. Touto akcí se jejich podmínky zpětně nemění.</p>:
          canGenerate&&summary.paymentPlanPreparation.canPrepare&&<button className="secondary-button compact" disabled={working||checking||pendingGeneration} onClick={()=>void preparePaymentPlan()}>{working?'Připravuji…':'Připravit platební plán'}</button>}
      </div>}
      {summary?.signingPlan&&(canGenerate&&summary.signingPlan.editable?<ContractSigningPlanForm key={`${summary.signingPlan.versionId}:${summary.signingPlan.sellerPlannedOn}:${summary.signingPlan.buyerPlannedOn}`} plan={summary.signingPlan} contractId={contractId} disabled={working||checking||pendingGeneration} onSaved={reload}/>:<div className="contract-payment-terms"><h3>Plánovaná data podpisu</h3><p>Prodávající: {formatPragueDate(summary.signingPlan.sellerPlannedOn)} · Kupující: {formatPragueDate(summary.signingPlan.buyerPlannedOn)}</p>{!summary.signingPlan.editable&&<p>Pro změnu dat v dokumentu vytvořte novou verzi smlouvy.</p>}</div>)}
      {readiness.issues.length>0&&<ul>{readiness.issues.map(item=><li key={`${item.code}-${item.field}`}><span>{item.message}</span>{item.action&&<Link href={item.action.href}>{item.action.label}</Link>}</li>)}</ul>}
    </div>}
      <div className="project-detail-actions"><button className="secondary-button compact" onClick={()=>void reload()} disabled={working||checking}>Znovu zkontrolovat</button>
        {readiness?.currentDocument&&onShowVersions&&<button className="secondary-button compact" onClick={onShowVersions}><History size={15}/> Historie verzí</button>}
        {canGenerate&&(pendingGeneration||readiness?.ready)&&<button className="primary-button" disabled={working||checking} onClick={()=>void generate()}><FileText size={16}/>{working?'Zpracovávám…':pendingGeneration?'Ověřit předchozí generování':readiness?.currentDocument?`Vytvořit novou verzi ${type}`:`Vygenerovat ${type}`}</button>}
      </div>
  </section>;
}

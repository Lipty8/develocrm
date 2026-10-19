'use client';
import {useCallback,useEffect,useState} from 'react';
import {apiFetch} from '../lib/api-client';
import {formatMoney} from '../crm-data';
import {formatPragueDate,localDateKey} from '../lib/date-time';
import type {SbkFinalNoticeContext} from '../../backend/src/shared/sbk-final-notice';

export function ContractFinalNotice({contractId,canManage,onChanged}:{contractId:string;canManage:boolean;onChanged:()=>void}){
  const[state,setState]=useState<SbkFinalNoticeContext|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const[file,setFile]=useState<File|null>(null),[day,setDay]=useState(()=>localDateKey(new Date())),[key,setKey]=useState(()=>crypto.randomUUID());
  const path=`/api/commercial/contracts/${encodeURIComponent(contractId)}/final-notice`;
  const load=useCallback(async(signal?:AbortSignal)=>{
    setLoading(true);setError('');
    try{const response=await apiFetch(path,{signal,cache:'no-store'});const value=await response.json() as {context?:SbkFinalNoticeContext|null;error?:string};
      if(!response.ok)throw new Error(value.error??'Doručení výzvy se nepodařilo načíst.');if(!signal?.aborted)setState(value.context??null);
    }catch(value){if(!signal?.aborted)setError(value instanceof Error?value.message:'Doručení výzvy se nepodařilo načíst.');}
    finally{if(!signal?.aborted)setLoading(false);}
  },[path]);
  useEffect(()=>{const controller=new AbortController();void Promise.resolve().then(()=>{if(!controller.signal.aborted)return load(controller.signal);});return()=>controller.abort();},[load]);
  async function save(){
    if(!file||!state?.canRecord||!canManage||busy)return;
    setBusy(true);setError('');
    try{
      if(file.size>4*1024*1024)throw new Error('Soubor je příliš velký. Maximální velikost je 4 MB.');
      if(!day||day<state.signedOn||day>localDateKey(new Date()))throw new Error('Zadejte skutečné datum doručení po podpisu smlouvy, nejvýše dnešní.');
      const contentBase64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('Soubor nelze načíst.'));reader.readAsDataURL(file);});
      const mimeType=file.type||(file.name.toLowerCase().endsWith('.pdf')?'application/pdf':file.name.toLowerCase().endsWith('.docx')?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'');
      const response=await apiFetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({versionId:state.versionId,deliveredOn:day,fileName:file.name,mimeType,contentBase64,idempotencyKey:key})});
      const value=await response.json() as {context?:SbkFinalNoticeContext|null;error?:string};
      if(!response.ok||!value.context?.notice)throw new Error(value.error??'Doručení výzvy se nepodařilo uložit.');
      setState(value.context);setFile(null);setKey(crypto.randomUUID());onChanged();
    }catch(value){setError(value instanceof Error?value.message:'Doručení výzvy se nepodařilo uložit.');}
    finally{setBusy(false);}
  }
  if(!loading&&!state&&!error)return null;
  return<section className="card detail-tab-card" aria-label="Doručení výzvy k doplatku"><div className="tab-card-header"><h2>Výzva k doplatku SBK</h2></div>
    {loading?<p role="status">Načítám doručení výzvy…</p>:state&&<>
      <dl className="rs-preparation-summary"><div><dt>Doplatek podle smlouvy</dt><dd>{formatMoney(Number(state.amount))}</dd></div>
        <div><dt>Doručení výzvy</dt><dd>{state.notice?formatPragueDate(state.notice.deliveredOn):'Dosud neevidováno'}</dd></div>
        <div><dt>Splatnost doplatku</dt><dd>{Number(state.amount)===0?'Bez doplatku':state.notice?.dueOn?formatPragueDate(state.notice.dueOn):'Čeká na doložené doručení výzvy'}</dd></div></dl>
      {state.notice?.webUrl&&<a className="secondary-button compact" href={state.notice.webUrl} target="_blank" rel="noreferrer">Otevřít doklad o doručení</a>}
      {canManage&&state.canRecord&&!state.notice&&<form className="contract-payment-terms" onSubmit={event=>{event.preventDefault();void save();}}>
        <p>Evidujte skutečné doručení výzvy kupujícímu a přiložte doklad. Doplatek bude splatný za 30 kalendářních dnů.</p>
        <div className="form-row"><label><span>Datum skutečného doručení</span><input type="date" min={state.signedOn} max={localDateKey(new Date())} value={day} disabled={busy} onChange={event=>{setDay(event.target.value);setKey(crypto.randomUUID());}}/></label>
          <label><span>Doklad o doručení (PDF nebo DOCX, do 4 MB)</span><input type="file" accept=".pdf,.docx" disabled={busy} onChange={event=>{setFile(event.target.files?.[0]??null);setKey(crypto.randomUUID());setError('');}}/></label></div>
        <button className="primary-button" type="submit" disabled={!file||busy}>{busy?'Ukládám…':'Evidovat doručení výzvy'}</button>
      </form>}
    </>}
    {error&&<p className="form-error" role="alert">{error} {!busy&&<button className="text-button" type="button" onClick={()=>void load()}>Znovu načíst</button>}</p>}
  </section>;
}

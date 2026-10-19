'use client';
import {useEffect,useState} from 'react';
import {commercialRepository} from '../repositories/commercial-repository';
type Timings=Record<'rs'|'sbk','fixed_date'|'signature'|null>;

/** Read-only discovery from the same backend projection used on save. */
export function useContractPaymentTimings(unitId:string|null){
  const[attempt,retry]=useState(0);
  const[state,setState]=useState<{unitId:string;attempt:number;timings?:Timings;error?:string}|null>(null);
  useEffect(()=>{
    if(!unitId)return;
    const controller=new AbortController();
    void(async()=>{
      try{
        const action=await commercialRepository.getNextContractAction(unitId,controller.signal);
        if(action.unitId!==unitId)throw new Error('Načtené údaje neodpovídají vybrané jednotce. Zkuste to znovu.');
        if(action.kind!=='create_contract')throw new Error('Pro tuto jednotku nyní nelze založit další smlouvu.');
        if(!action.paymentTimings)throw new Error('Platební podmínky se nepodařilo načíst. Obnovte přehled a zkuste to znovu.');
        if(!controller.signal.aborted)setState({unitId,attempt,timings:action.paymentTimings});
      }catch(error){if(!controller.signal.aborted)setState({unitId,attempt,error:error instanceof Error?error.message:'Platební podmínky se nepodařilo načíst.'});}
    })();
    return()=>controller.abort();
  },[unitId,attempt]);
  const current=state?.unitId===unitId&&state.attempt===attempt?state:null;
  return{timings:current?.timings,loading:!!unitId&&!current,error:unitId?current?.error??'':'Jednotka nemá platný identifikátor.',retry:()=>retry(value=>value+1)};
}

export function ContractPaymentTimingNotice({loading,error,onRetry,signature,type}:{loading:boolean;error:string;onRetry:()=>void;signature:boolean;type:string}){
  if(loading)return<p role="status">Načítám platební podmínky…</p>;
  if(error)return<div className="form-error" role="alert">{error} <button className="secondary-button compact" type="button" onClick={onRetry}>Zkusit znovu</button></div>;
  if(!signature)return null;
  return<p className="form-help">{type==='sbk'?'První splátka činí 20 % sjednané ceny a je splatná do 5 pracovních dnů od posledního potřebného podpisu. Doplatek zohlední uhrazený rezervační poplatek a bude splatný do 30 dnů od doloženého doručení výzvy.':'Rezervační poplatek bude splatný do 3 pracovních dnů od posledního potřebného podpisu.'}</p>;
}

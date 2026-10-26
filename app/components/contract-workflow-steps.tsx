import {Check} from 'lucide-react';
import {contractWorkflowPresentation} from '../lib/contract-stage-history';
import type {ContractHistoryEvent} from '../crm-data';
import type {ContractStatus} from '../../backend/src/shared/contract-workflow';

type Props={history?:readonly ContractHistoryEvent[];status?:string;compact?:boolean;selected?:string;onSelect?:(status:ContractStatus)=>void};

export function ContractWorkflowSteps({history=[],status,compact=false,selected,onSelect}:Props){
  return <>{contractWorkflowPresentation(history,status).map((stage,index)=>{
    const stateClass=stage.state==='complete'?'done':stage.state==='current'?'current':'';
    const icon=stage.state==='complete'?<Check size={compact?10:12}/>:index+1;
    const description=`${stage.label} · ${stage.stateLabel}`;
    if(compact)return <span key={stage.code} className={stateClass} title={description} data-stage={stage.code} data-state={stage.state}><i>{icon}</i><small>{stage.label}</small></span>;
    return <button type="button" key={stage.code} className={`${stateClass} ${selected===stage.code?'selected':''}`} aria-label={description} aria-pressed={selected===stage.code} aria-current={stage.state==='current'?'step':undefined}
      data-stage={stage.code} data-state={stage.state} onClick={()=>onSelect?.(stage.code)}>
      <i>{icon}</i><strong>{stage.label}</strong><small>{stage.stateLabel}</small>
    </button>;
  })}</>;
}

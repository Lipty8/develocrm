import {CONTRACT_STATUS_ORDER,contractStatusLabel,contractStepIndex,normalizeContractStatus} from '../../backend/src/shared/contract-workflow';

type StageEvent={fromStatus:string|null;toStatus:string;occurredAt:string};
const visibleStage=(status:string|null)=>status==='signing'?'approved':status;

/** The latest visit to a stage, not an entry and exit from different visits. */
export function contractStageHistory<T extends StageEvent>(history:readonly T[],selected:string,current:string){
  selected=selected==='signing'?'approved':selected;current=current==='signing'?'approved':current;
  // Preserve the API's deterministic order for equal timestamps, including
  // multiple transitions recorded in one database transaction.
  const ordered=history.map((event,index)=>({event,index,time:Date.parse(event.occurredAt)}))
    .filter(item=>Number.isFinite(item.time))
    .sort((a,b)=>b.time-a.time||a.index-b.index).map(item=>item.event);
  const events=history.filter(event=>visibleStage(event.toStatus)===selected||visibleStage(event.fromStatus)===selected);
  const entered=ordered.findIndex(event=>visibleStage(event.toStatus)===selected&&visibleStage(event.fromStatus)!==selected);
  const started=entered<0?undefined:ordered[entered];
  const completed=current===selected||!started?undefined:
    ordered.slice(0,entered).find(event=>visibleStage(event.fromStatus)===selected&&visibleStage(event.toStatus)!==selected);
  return{events,started,completed};
}

export type ContractStageDisplayState='current'|'complete'|'pending'|'unrecorded';
const stageLabels:Record<ContractStageDisplayState,string>={current:'Aktuální krok',complete:'Dokončeno',pending:'Čeká',unrecorded:'Bez záznamu'};

/** Read-only presentation of the existing lifecycle, never a transition rule. */
export function contractWorkflowPresentation(history:readonly StageEvent[],status:string|undefined){
  const current=normalizeContractStatus(status),currentIndex=contractStepIndex(current);
  const closed=current==='cancelled'||current==='terminated';
  return CONTRACT_STATUS_ORDER.map((code,index)=>{
    const visit=contractStageHistory(history,code,current);
    const state:ContractStageDisplayState=!closed&&index===currentIndex?'current':
      !closed&&index>currentIndex?'pending':visit.started&&visit.completed?'complete':'unrecorded';
    return{code,label:contractStatusLabel(code),state,stateLabel:stageLabels[state]};
  });
}

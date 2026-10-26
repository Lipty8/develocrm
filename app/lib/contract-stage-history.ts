type StageEvent={fromStatus:string|null;toStatus:string;occurredAt:string};

/** The latest visit to a stage, not an entry and exit from different visits. */
export function contractStageHistory<T extends StageEvent>(history:readonly T[],selected:string,current:string){
  // Preserve the API's deterministic order for equal timestamps, including
  // multiple transitions recorded in one database transaction.
  const ordered=history.map((event,index)=>({event,index,time:Date.parse(event.occurredAt)}))
    .filter(item=>Number.isFinite(item.time))
    .sort((a,b)=>b.time-a.time||a.index-b.index).map(item=>item.event);
  const events=history.filter(event=>event.toStatus===selected||event.fromStatus===selected);
  const entered=ordered.findIndex(event=>event.toStatus===selected&&event.fromStatus!==selected);
  const started=entered<0?undefined:ordered[entered];
  const completed=current===selected||!started?undefined:
    ordered.slice(0,entered).find(event=>event.fromStatus===selected&&event.toStatus!==selected);
  return{events,started,completed};
}

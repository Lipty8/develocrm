export const DATA_MUTATED_EVENT="develocrm:data-mutated";

export type DataMutationDetail={method:string;target:string};

export function announceDataMutation(detail:DataMutationDetail):void{
  if(typeof window==="undefined")return;
  window.dispatchEvent(new CustomEvent<DataMutationDetail>(DATA_MUTATED_EVENT,{detail}));
}

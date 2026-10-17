import type {DocumentTemplate} from '../repositories/template-repository';

/** A stale response for the previous filter must never prefill another project. */
export function templateUploadContext(templates:DocumentTemplate[],scope:{projectId?:string;outputTypeCode?:string;selectedTemplateId?:string;fallbackProjectId?:string}){
  const eligible=templates.filter(t=>(!scope.projectId||t.projectId===scope.projectId)&&(!scope.outputTypeCode||t.outputTypeCode===scope.outputTypeCode));
  const existing=eligible.find(t=>t.id===scope.selectedTemplateId)??eligible[0];
  return{existing,projectId:scope.projectId||existing?.projectId||scope.fallbackProjectId||'',outputTypeCode:scope.outputTypeCode||existing?.outputTypeCode||'reservation_contract'};
}

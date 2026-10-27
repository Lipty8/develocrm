import type {GenerationAppendixSelection} from '../shared/contract-appendices.js';

// Server-built inputs needed to replay the existing generation pipeline exactly.
// Identity is always supplied by the current authorized request, never this JSON.
export type GenerationRequest={projectId:string;templateVersionId:string;unitId?:string;partyId?:string;salesCaseId?:string;
  contractId?:string;documentId?:string;documentName?:string;snapshot?:Record<string,string>;contractAppendices?:GenerationAppendixSelection};
export function generationRequest(input:GenerationRequest){
  return {projectId:input.projectId,templateVersionId:input.templateVersionId,unitId:input.unitId??null,
    partyId:input.partyId??null,salesCaseId:input.salesCaseId??null,contractId:input.contractId??null,
    documentId:input.documentId??null,documentName:input.documentName??null,snapshot:input.snapshot??null,
    ...(input.contractAppendices?{contractAppendices:input.contractAppendices}:{})};
}
export type StoredGenerationRequest=ReturnType<typeof generationRequest>;
export function restoreGenerationRequest(stored:StoredGenerationRequest):GenerationRequest{
  return {projectId:stored.projectId,templateVersionId:stored.templateVersionId,unitId:stored.unitId??undefined,
    partyId:stored.partyId??undefined,salesCaseId:stored.salesCaseId??undefined,contractId:stored.contractId??undefined,
    documentId:stored.documentId??undefined,documentName:stored.documentName??undefined,snapshot:stored.snapshot??undefined,
    ...(stored.contractAppendices?{contractAppendices:stored.contractAppendices}:{})};
}

import type {ContractSigningPlan} from './contract-signing-plan.js';
import type {ContractAppendixSummary} from './contract-appendices.js';
export type PrecedingRsComparison={status:'compared'|'unavailable';message:string;contractId?:string;reference?:string;contractVersion?:number;
  documentVersionId?:string;buyerChanged?:boolean;comparedFields:number;differences:Array<{field:string;label:string;previous:string;current:string;valuesRestricted?:boolean}>};
export type RsReadinessIssue={code:string;field:string;message:string;action?:{href:string;label:string}};
export type RsPreparationSummary={
  project:{id:string;label:string};unit:{id:string;label:string};buyers:Array<{id:string;label:string}>;
  seller:string|null;unitPrice:number|null;totalPrice:number|null;reservationFee:number|null;
  reservationFeeDueDays:number;reservationPeriodDays:number;accessories:string[];paymentTimingLabel?:string;
  signingPlan?:ContractSigningPlan|null;
  appendices?:ContractAppendixSummary;
  precedingRsComparison?:PrecedingRsComparison;
  paymentPlan?:{versionId:string|null;variableSymbol:string;rows:Array<{key:'rs_fee'|'sbk_first'|'sbk_final';amount:string;anchor:'effective_signature'|'notice_delivery';days:number;calendar:'czech_working_days'|'calendar_days'}>};
  paymentPlanPreparation?:{versionId:string;canPrepare:boolean;hasExistingObligations:boolean};
  template:{name:string;version:string;effectiveFrom:string|null;approvalStatus?:string}|null;
};
export type RsReadiness={ready:boolean;issues:RsReadinessIssue[];contractType?:'rs'|'sbk';contractId:string;projectId?:string;templateVersionId?:string|null;
  summary?:RsPreparationSummary;
  currentDocument?:{documentId:string;documentVersionId:string;contractVersionId?:string;version:number;webUrl:string|null}|null};

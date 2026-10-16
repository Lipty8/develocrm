export type RsReadinessIssue={code:string;field:string;message:string;action?:{href:string;label:string}};
export type RsPreparationSummary={
  project:{id:string;label:string};unit:{id:string;label:string};buyers:Array<{id:string;label:string}>;
  seller:string|null;unitPrice:number|null;totalPrice:number|null;reservationFee:number|null;
  reservationFeeDueDays:number;reservationPeriodDays:number;accessories:string[];
  template:{name:string;version:string;effectiveFrom:string|null}|null;
};
export type RsReadiness={ready:boolean;issues:RsReadinessIssue[];contractId:string;projectId?:string;templateVersionId?:string|null;
  summary?:RsPreparationSummary;
  currentDocument?:{documentId:string;documentVersionId:string;contractVersionId?:string;version:number;webUrl:string|null}|null};

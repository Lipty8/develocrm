import { dejviceClients, dejviceContracts, dejvicePriceHistories, dejviceProject, dejviceUnitContexts, dejviceUnits } from "./dejvice-pilot-data";

export type UnitStatus = "Volný" | "Předrezervace" | "Rezervovaná" | "SBK" | "KS" | "Předáno" | "Blokováno";

export type UnitRecord = {
  backendId?: string;
  projectBackendId?: string;
  projectCode?: string;
  structureId?: string | null;
  id: string;
  project: string;
  building: string;
  layout: string;
  area: number;
  floor: string;
  orientation: string;
  price: number;
  basePrice?: number;
  accessoryPrice?: number;
  status: UnitStatus;
  construction: string;
  handover: string;
  client?: string;
  attention?: string;
  accessory: string;
  usableArea?: number;
  priceNet?: number;
  balcony?: number | null;
  terrace?: number | null;
  garden?: number | null;
  floorplanAvailable?: boolean;
  floorplanImageUrl?: string | null;
  floorplanMimeType?: string | null;
  floorplanFileName?: string | null;
  floorplanUploadedAt?: string | null;
  floorplanUploadedBy?: string | null;
  accessories?: AccessoryAssignmentRecord[];
  updatedAt?: string;
};
export type AccessoryAssignmentRecord = { id:string; assignmentId?:string; code:string; type:string; category:string; areaM2:number|null; relation?:string|null; amount?:number; amountNet?:number|null; currency?:string };
export type AccessoryAssignmentHistoryRecord = { assignmentId:string; unitId:string; unitCode:string; validFrom:string; validTo:string|null; assignedBy:string|null };
export type CatalogAccessoryRecord = AccessoryAssignmentRecord & {
  project:string;
  projectBackendId?:string;
  subtype?:string|null;
  location?:string|null;
  available:boolean;
  assignedUnitId?:string|null;
  assignedUnitCode?:string|null;
  assignedUnitStatus?:string|null;
  assignedClient?:string|null;
  assignmentHistory?:AccessoryAssignmentHistoryRecord[];
  archived?:boolean;
};
export type MembershipOption = { id:string; name:string };
export type ProjectStructureOption = { id:string; projectId:string; project:string; name:string; kind:string };
export type ProjectRecord = { backendId?:string; name:string; sourceName?:string; code:string; location:string; address?:string|null; description?:string|null; projectCompany?:string|null; defaultCurrency?:string; plannedUnitCount?:number|null; note?:string|null; progress:number; units:number; available:number; preReserved:number; reserved:number; sold:number; handedOver:number; attention:number; color:"sage"|"sand"|"slate"; stage:string; stageCode?:string|null; lifecycleStatus?:string; revenue:string; buildings:string[]; manager:string; managerMembershipId?:string|null; plannedHandover:string; plannedCompletionFrom?:string|null; plannedCompletionTo?:string|null; coverImageUrl?:string|null };
export type TaskRecord = { id:string|number; title:string; description?:string; object:string; objectType?:string; objectId?:string; projectId?:string|null; project:string; due:string; dueAt?:string|null; priority:string; owner:string; assigneeId?:string|null; done:boolean; updatedAt?:string };

export type InterestHistoryRecord = { date: string; project: string; unit: string; type: string; result: string };
export type ClientActivityRecord = { id:string;type:string;note:string;occurredAt:string;author:string };
export type ClientRecord = {
  id: string; name: string; type: string; kind: "FO" | "PO"; email: string; phone: string; contact: string;
  units: string[]; projects: string; projectIds?:string[]; projectNames: string[]; state: string; contractStatus: string; initials: string;
  interestHistory?: InterestHistoryRecord[];
  activityHistory?: ClientActivityRecord[];
  firstName?:string; lastName?:string; legalName?:string; registrationNumber?:string; vatNumber?:string; contactPerson?:string;
  address?:{line1:string;line2?:string;city:string;postalCode?:string;countryCode:string;addressType:string}|null;
  updatedAt?:string;
  lifecycleStatus?:"active"|"inactive"|"merged"|"archived";
  unitRelations?:Array<{unitId:string;code:string;projectId:string;project:string;contractType?:"RS"|"SBK"|"KS";contractStatus?:string}>;
};
export type UnitCommercialContext = {
  salesCaseId?: string | null;
  buyers: Array<{ partyId: string; name: string; email: string; role: string; share: number | null }>;
  buyerHistory?: Array<{ id:string; occurredAt:string; previousBuyers:Array<{partyId:string;name:string;role:string}>; currentBuyers:Array<{partyId:string;name:string;role:string}>; reason:string; actor:string; sourceContractId?:string|null; sourceContractReference?:string|null }>;
  interests: Array<{ date: string; partyId: string; name: string; type: string; result: string }>;
  stage: string | null;
  hold: { id: string; type: string; expiresAt: string } | null;
};
export type PriceHistoryRecord={id:string;unit:string;type:string;amount:number;amountNet?:number;currency:string;validFrom:string;validTo:string|null;reason:string;author:string;approver:string|null};
export type ContractHistoryEvent={id:string;fromStatus:string|null;toStatus:string;occurredAt:string;actor:string;note:string;source:"manual"|"automation"|"signature"|"import"};
export type ContractRecord={id?:string;salesCaseId?:string;unit:string;client:string;projectId?:string;project:string;type:string;typeCode?:string;state:string;statusCode?:string;updated:string;updatedAt?:string;owner:string;action:string;title?:string;reference?:string;parentContractId?:string|null;parentReference?:string|null;assignmentEffectiveAt?:string|null;missingData?:number;missingAttachments?:number;history?:ContractHistoryEvent[];parties?:Array<{id:string;partyId?:string;name:string;role:string;signatureStatus:string;isCurrent?:boolean;effectiveFrom?:string;effectiveTo?:string|null;assignmentReason?:string|null;isPrimaryBuyer?:boolean;ownershipShare?:number|null}>;versions?:Array<{id:string;number:number;name:string;status:string;basedOnVersionId:string|null;source:string;createdAt:string;signedAt:string|null}>};

export const units: UnitRecord[] = [...dejviceUnits as UnitRecord[]];
export const projects:ProjectRecord[] = [dejviceProject];
export const tasks: TaskRecord[] = [];
export const contracts:ContractRecord[] = [...dejviceContracts];
export const unitPriceHistories:Record<string,PriceHistoryRecord[]>={...dejvicePriceHistories};
export const payments: Array<{unit:string;client:string;project:string;installment:string;amount:number;due:string;paid:number;state:string}> = [];
export const clients: ClientRecord[] = [...dejviceClients as ClientRecord[]];
export const unitCommercialContexts: Record<string, UnitCommercialContext> = {...dejviceUnitContexts};
export const activity: Array<{time:string;title:string;meta:string;kind:string}> = [];
export const unitTimeline: Array<{date:string;title:string;detail:string;icon:string}> = [];

export const formatMoney = (value: number) =>
  new Intl.NumberFormat("cs-CZ", { style: "currency", currency: "CZK", maximumFractionDigits: 0 }).format(value);

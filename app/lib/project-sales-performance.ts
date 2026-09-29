export type ProjectSalesCounts={units:number;available:number;preReserved:number;reserved:number;sold:number;handedOver:number};

export type ProjectSalesAggregation={available:number;inNegotiation:number;sold:number;performance:number};
export type ProjectSalesBucket="available"|"in_negotiation"|"sold";

/** Backendový katalog posílá salesBucket přímo z app.unit_business_projection. Starší preview data používají stejný tříkošový fallback. */
export function projectUnitSalesBucket(unit:{salesBucket?:ProjectSalesBucket;status:string}):ProjectSalesBucket{
  if(unit.salesBucket)return unit.salesBucket;
  const status=unit.status.trim().toLocaleLowerCase("cs-CZ");
  if(status==="volný"||status==="volné")return "available";
  if(["prodaná","prodané","ks","předáno","předaná","předané"].includes(status))return "sold";
  return "in_negotiation";
}

/** Jediná prezentační agregace detailních obchodních stavů pro projektové KPI. */
export function projectSalesAggregation(project:ProjectSalesCounts):ProjectSalesAggregation{
  const inNegotiation=project.preReserved+project.reserved;
  const sold=project.sold+project.handedOver;
  return {available:project.available,inNegotiation,sold,performance:sold};
}

export function projectSalesPerformanceCount(project:ProjectSalesCounts):number{
  return projectSalesAggregation(project).performance;
}

export function projectSalesPerformancePercent(project:ProjectSalesCounts):number{
  return project.units?Math.round(projectSalesPerformanceCount(project)/project.units*100):0;
}

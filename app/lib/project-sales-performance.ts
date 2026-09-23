export type ProjectSalesCounts={units:number;available:number;preReserved:number;reserved:number;sold:number;handedOver:number};

export type ProjectSalesAggregation={available:number;inNegotiation:number;sold:number;performance:number};

/** Jediná prezentační agregace detailních obchodních stavů pro projektové KPI. */
export function projectSalesAggregation(project:ProjectSalesCounts):ProjectSalesAggregation{
  const inNegotiation=project.preReserved+project.reserved;
  const sold=project.sold+project.handedOver;
  return {available:project.available,inNegotiation,sold,performance:inNegotiation+sold};
}

export function projectSalesPerformanceCount(project:ProjectSalesCounts):number{
  return projectSalesAggregation(project).performance;
}

export function projectSalesPerformancePercent(project:ProjectSalesCounts):number{
  return project.units?Math.round(projectSalesPerformanceCount(project)/project.units*100):0;
}

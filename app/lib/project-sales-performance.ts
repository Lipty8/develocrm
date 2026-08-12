export type ProjectSalesCounts={units:number;available:number;preReserved:number;reserved:number;sold:number;handedOver:number};

export type ProjectSalesAggregation={available:number;preReservation:number;sold:number;performance:number};

/** Jediná prezentační agregace detailních obchodních stavů pro projektové KPI. */
export function projectSalesAggregation(project:ProjectSalesCounts):ProjectSalesAggregation{
  const preReservation=project.preReserved;
  const sold=project.reserved+project.sold+project.handedOver;
  return {available:project.available,preReservation,sold,performance:sold};
}

export function projectSalesPerformanceCount(project:ProjectSalesCounts):number{
  return projectSalesAggregation(project).performance;
}

export function projectSalesPerformancePercent(project:ProjectSalesCounts):number{
  return project.units?Math.round(projectSalesPerformanceCount(project)/project.units*100):0;
}

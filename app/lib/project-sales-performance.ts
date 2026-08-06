export type ProjectSalesCounts={units:number;reserved:number;sold:number;handedOver:number};

export function projectSalesPerformanceCount(project:ProjectSalesCounts):number{
  return project.reserved+project.sold+project.handedOver;
}

export function projectSalesPerformancePercent(project:ProjectSalesCounts):number{
  return project.units?Math.round(projectSalesPerformanceCount(project)/project.units*100):0;
}

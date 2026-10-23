/** URL filters are business context, not authorization. An unknown project
 * remains explicit and must never silently become the all-projects query. */
export function templateListContext(params:Pick<URLSearchParams,'get'>){
  return{projectId:params.get('project')??'',typeCode:params.get('templateType')??''};
}

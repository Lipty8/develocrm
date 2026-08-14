const roleNames:Record<string,string>={
  admin:"Administrátor",
  executive:"Jednatel",
  project_manager:"Projektový manažer",
  sales:"Obchod",
  back_office:"Obchodní administrativa",
  finance:"Finance",
  handover_complaints:"Předání a reklamace",
  read_only:"Pouze pro čtení",
  crm_user:"Uživatel CRM",
  sales_user:"Obchod",
};

export function roleDisplayName(code:string,fallback?:string):string{
  const normalized=code.trim().toLowerCase();
  if(roleNames[normalized])return roleNames[normalized];
  if(fallback?.trim()&&!/[._]/.test(fallback))return fallback.trim();
  return "Vlastní role";
}

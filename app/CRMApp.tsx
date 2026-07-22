"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Banknote,
  Bell,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  ClipboardCheck,
  CreditCard,
  Download,
  ExternalLink,
  Eye,
  FileCheck2,
  FileText,
  Filter,
  FolderOpen,
  HardHat,
  History,
  Home,
  ImagePlus,
  KeyRound,
  LayoutDashboard,
  LayoutGrid,
  Link2,
  List,
  Mail,
  MapPin,
  Menu,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Upload,
  UserRound,
  Users,
  LogOut,
  X,
} from "lucide-react";
import {
  activity,
  clients,
  contracts,
  formatMoney,
  payments,
  projects,
  tasks as initialTasks,
  unitCommercialContexts,
  unitPriceHistories,
  units,
  type UnitRecord,
  type CatalogAccessoryRecord,
  type MembershipOption,
  type ProjectStructureOption,
  type ProjectRecord,
  type TaskRecord,
} from "./crm-data";
import { identityRepository, prototypeSession, type IdentitySession } from "./repositories/identity-repository";
import { catalogRepository } from "./repositories/catalog-repository";
import { clientRepository } from "./repositories/client-repository";
import { commercialRepository } from "./repositories/commercial-repository";
import { salesCommandRepository } from "./repositories/sales-command-repository";
import { mediaRepository } from "./repositories/media-repository";
import { taskRepository } from "./repositories/task-repository";
import { activityRepository, recordPreviewActivity, type TimelineRecord } from "./repositories/activity-repository";
import { documentRepository, previewConnection, type DocumentConnectionState, type DocumentRecord } from "./repositories/document-repository";
import { clientRoute, contractRoute, listParam, pageRoute, parseCrmRoute, projectRoute, unitRoute, updateSearch } from "./crm-routing.mjs";

type Page = "dashboard" | "projects" | "clients" | "contracts" | "payments" | "handovers" | "tasks";
type UnitTab = "overview" | "contracts" | "payments" | "changes" | "documents" | "handover" | "tasks" | "history";
type ProjectTab = "overview" | "units" | "clients" | "contracts" | "payments" | "changes" | "handovers" | "documents";

const navItems: { id: Page; label: string; icon: typeof Home }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "projects", label: "Projekty", icon: Building2 },
  { id: "clients", label: "Klienti", icon: Users },
  { id: "contracts", label: "Smlouvy", icon: FileText },
  { id: "payments", label: "Platby", icon: CircleDollarSign },
  { id: "handovers", label: "Předání", icon: KeyRound },
  { id: "tasks", label: "Úkoly", icon: ClipboardCheck },
];

const pageTitles: Record<Page, { title: string; subtitle: string }> = {
  dashboard: { title: "Dobré ráno, Ivo", subtitle: "Tady je přehled toho, co dnes vyžaduje vaši pozornost." },
  projects: { title: "Projekty", subtitle: "Portfolio developerských projektů a jejich aktuální stav." },
  clients: { title: "Klienti a zájemci", subtitle: "Jedno místo pro kontakty, jednotky a historii zájmu." },
  contracts: { title: "Smlouvy", subtitle: "Rozpracované smlouvy napříč všemi projekty." },
  payments: { title: "Platby", subtitle: "Splátkový kalendář, úhrady a položky vyžadující pozornost." },
  handovers: { title: "Předání", subtitle: "Termíny, připravenost jednotek a otevřené nedodělky." },
  tasks: { title: "Úkoly", subtitle: "Moje práce a automaticky vytvořené úkoly v souvislostech." },
};

const statusClass = (value: string) => {
  if (["Uhrazeno", "Podepsána", "Podepsaná KS", "Předáno", "Dokončeno", "Hotovo"].includes(value)) return "success";
  if (["Po splatnosti", "Vyžaduje pozornost", "Vysoká", "Blokováno"].includes(value)) return "danger";
  if (["Předrezervace", "Odeslána", "Čeká na úhradu", "Střední"].includes(value)) return "warning";
  if (["KS", "SBK", "Ve vyjednávání", "Ke kontrole", "Předání"].includes(value)) return "purple";
  if (["RS", "V přípravě", "Aktivní klient"].includes(value)) return "blue";
  return "neutral";
};

function Badge({ children, tone }: { children: React.ReactNode; tone?: string }) {
  return <span className={`badge ${tone || statusClass(String(children))}`}>{children}</span>;
}

function TableColumnFilter({ label, active = false, className = "", children }: { label: string; active?: boolean; className?: string; children?: React.ReactNode }) {
  const [open,setOpen]=useState(false); const root=useRef<HTMLTableCellElement>(null);
  useEffect(()=>{const close=(event:MouseEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false)};document.addEventListener("mousedown",close);return()=>document.removeEventListener("mousedown",close)},[]);
  return <th ref={root} className={`column-filter ${active ? "active" : ""} ${open ? "open" : ""} ${className}`.trim()}>{children?<><button type="button" className="column-filter-heading" onClick={()=>setOpen(value=>!value)} aria-expanded={open} aria-label={`Filtrovat: ${label}`}><span>{label}</span><ChevronDown className="column-filter-chevron" size={12}/>{active&&<i />}</button>{open&&<span className="column-filter-control">{children}</span>}</>:<span className="column-filter-heading plain"><span>{label}</span></span>}</th>;
}

function MultiSelectFilter({ options, selected, onChange, allLabel, ariaLabel }: { options: string[]; selected: string[]; onChange: (value: string[]) => void; allLabel: string; ariaLabel: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, []);

  const toggle = (option: string) => onChange(selected.includes(option) ? selected.filter((item) => item !== option) : [...selected, option]);
  const summary = selected.length === 0 ? allLabel : selected.length === 1 ? selected[0] : `${selected.length} vybráno`;

  return (
    <div className={`multi-select-filter ${open ? "open" : ""}`} ref={rootRef} onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}>
      <button type="button" className="multi-select-trigger" onClick={() => setOpen((value) => !value)} aria-label={ariaLabel} aria-expanded={open} title={selected.join(", ")}>
        <span>{summary}</span><ChevronDown size={14} />
      </button>
      {open && <div className="multi-select-menu" role="group" aria-label={ariaLabel}>
        <button type="button" className={`multi-select-all ${selected.length === 0 ? "selected" : ""}`} onClick={() => onChange([])}><span className="filter-check">{selected.length === 0 && <Check size={11} />}</span>{allLabel}</button>
        <div className="multi-select-options">{options.map((option) => <label key={option}><input type="checkbox" checked={selected.includes(option)} onChange={() => toggle(option)} /><span className="filter-check">{selected.includes(option) && <Check size={11} />}</span><span>{option}</span></label>)}</div>
        {selected.length > 0 && <button type="button" className="multi-select-clear" onClick={() => onChange([])}>Zrušit výběr</button>}
      </div>}
    </div>
  );
}

function Avatar({ initials, small = false }: { initials: string; small?: boolean }) {
  return <span className={`avatar ${small ? "avatar-small" : ""}`}>{initials}</span>;
}

function SectionTitle({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <div className="section-title">
      <h2>{title}</h2>
      {action && (
        <button className="text-button" onClick={onAction}>
          {action} <ArrowRight size={15} />
        </button>
      )}
    </div>
  );
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "U";
}

function roleLabel(roles: string[]): string {
  const labels: Record<string, string> = {
    admin: "Administrátor",
    project_manager: "Vedoucí projektu",
    sales: "Obchod",
    back_office: "Obchodní administrativa",
  };
  return labels[roles[0]] ?? "Uživatel CRM";
}

function vocativeFirstName(displayName: string): string {
  const firstName = displayName.trim().split(/\s+/)[0] || "";
  return firstName === "Iva" ? "Ivo" : firstName;
}

export default function CRMApp() {
  const router=useRouter();
  const pathname=usePathname();
  const searchParams=useSearchParams();
  const [identitySession, setIdentitySession] = useState<IdentitySession>(prototypeSession);
  const [catalogVersion, setCatalogVersion] = useState(0);
  const [catalogReloadKey, setCatalogReloadKey] = useState(0);
  const [clientDataVersion, setClientDataVersion] = useState(0);
  const [clientReloadKey, setClientReloadKey] = useState(0);
  const [, setCommercialDataVersion] = useState(0);
  const [commercialReloadKey, setCommercialReloadKey] = useState(0);
  const [activityReloadKey,setActivityReloadKey]=useState(0);
  const [page, setPage] = useState<Page>("dashboard");
  const [mobileNav, setMobileNav] = useState(false);
  const [unitDetail, setUnitDetail] = useState<UnitRecord | null>(null);
  const [unitPreview, setUnitPreview] = useState<UnitRecord | null>(null);
  const [unitTab, setUnitTab] = useState<UnitTab>("overview");
  const [selectedProject, setSelectedProject] = useState<ProjectRecord | null>(null);
  const [projectTab, setProjectTab] = useState<ProjectTab>("overview");
  const [selectedClientName, setSelectedClientName] = useState<string | null>(null);
  const [unitView, setUnitView] = useState<"table" | "cards">("table");
  const [projectFilter, setProjectFilter] = useState("Všechny projekty");
  const [buildingFilter, setBuildingFilter] = useState<string[]>([]);
  const [floorFilter, setFloorFilter] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [layoutFilter, setLayoutFilter] = useState<string[]>([]);
  const [areaFrom, setAreaFrom] = useState("");
  const [areaTo, setAreaTo] = useState("");
  const [priceFrom, setPriceFrom] = useState("");
  const [priceTo, setPriceTo] = useState("");
  const [unitQuery,setUnitQuery]=useState("");
  const [unitClientQuery,setUnitClientQuery]=useState("");
  const [search, setSearch] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [taskRows, setTaskRows] = useState(initialTasks);
  const [taskOpenCount,setTaskOpenCount]=useState(initialTasks.filter(item=>!item.done&&item.owner==="Iva").length);
  const [taskScope,setTaskScope]=useState<"mine"|"all"|"completed">("mine");
  const [taskLoading,setTaskLoading]=useState(false);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [projectEdit, setProjectEdit] = useState<ProjectRecord | null>(null);
  const [unitEdit, setUnitEdit] = useState<UnitRecord | null>(null);
  const [priceEdit, setPriceEdit] = useState<UnitRecord | null>(null);
  const [clientEdit, setClientEdit] = useState<(typeof clients)[number] | null>(null);
  const [catalogAccessories,setCatalogAccessories]=useState<CatalogAccessoryRecord[]>([]);
  const [catalogMemberships,setCatalogMemberships]=useState<MembershipOption[]>([]);
  const [catalogStructures,setCatalogStructures]=useState<ProjectStructureOption[]>([]);
  const [accessoryUnit,setAccessoryUnit]=useState<UnitRecord|null>(null);
  const [salesAction,setSalesAction]=useState<{unit:UnitRecord;mode:"interest"|"pre_reservation"|"reservation"|"convert"|"cancel"}|null>(null);
  const [contractEdit,setContractEdit]=useState<(typeof contracts)[number]|null>(null);
  const [routedContractId,setRoutedContractId]=useState<string|null>(null);
  const [profileOpen,setProfileOpen]=useState(false);
  const [mediaEdit,setMediaEdit]=useState<{entityType:"project"|"unit";entityId:string;kind:"cover"|"floorplan";title:string;unitKey?:string}|null>(null);
  const [documentConnection,setDocumentConnection]=useState<DocumentConnectionState>(previewConnection);
  const can=(permission:string)=>identitySession.workspace.permissions.includes(permission);
  const routeSearch=searchParams.toString();
  const routeState=useMemo(()=>parseCrmRoute(pathname,routeSearch),[pathname,routeSearch]);

  useEffect(()=>{
    if(routeState.kind==="not-found"){router.replace("/dashboard");return;}
    // Frameworkový router je externí zdroj pravdy; lokální stav pouze promítá právě obnovenou URL.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(routeState.page as Page);
    setSearch(routeState.params.get("q")??"");
    if(routeState.params.get("q"))setSearchFocused(true);
    setProfileOpen(routeState.kind==="admin-users");
    setRoutedContractId(routeState.kind==="contract"?routeState.contractId??null:null);
    if(routeState.page==="tasks")setTaskScope((routeState.taskScope??"mine") as "mine"|"all"|"completed");

    if(routeState.kind==="project"){
      const project=projects.find(item=>projectRouteId(item)===routeState.projectId);
      if(project){setSelectedProject(project);setProjectFilter(project.name);}
      setProjectTab((routeState.projectTab??"overview") as ProjectTab);
      setUnitDetail(null);setUnitPreview(null);setSelectedClientName(null);
      setBuildingFilter(listParam(routeState.params,"building"));
      setFloorFilter(listParam(routeState.params,"floor"));
      setStatusFilter(listParam(routeState.params,"status"));
      setLayoutFilter(listParam(routeState.params,"layout"));
      setAreaFrom(routeState.params.get("areaFrom")??"");setAreaTo(routeState.params.get("areaTo")??"");
      setPriceFrom(routeState.params.get("priceFrom")??"");setPriceTo(routeState.params.get("priceTo")??"");
      setUnitView(routeState.params.get("view")==="cards"?"cards":"table");
      setUnitQuery(routeState.params.get("unit")??"");setUnitClientQuery(routeState.params.get("client")??"");
    }else if(routeState.kind==="unit"){
      const unit=units.find(item=>unitRouteId(item)===routeState.unitId);
      if(unit){const project=projects.find(item=>unitBelongsToProject(unit,item))??null;setUnitDetail(unit);setSelectedProject(project);setProjectFilter(project?.name??unit.project);}
      setProjectTab("units");setUnitTab((routeState.unitTab??"overview") as UnitTab);setUnitPreview(null);setSelectedClientName(null);
    }else if(routeState.kind==="client"){
      const client=clients.find(item=>item.id===routeState.clientId);
      setSelectedClientName(client?.name??null);setSelectedProject(null);setUnitDetail(null);setUnitPreview(null);
    }else if(routeState.kind!=="admin-users"){
      setSelectedProject(null);setUnitDetail(null);setUnitPreview(null);
      setSelectedClientName(null);
    }
  },[routeState,catalogVersion,clientDataVersion,router]);

  useEffect(() => {
    const controller = new AbortController();
    identityRepository.getSession(controller.signal).then(setIdentitySession).catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(()=>{const controller=new AbortController();documentRepository.connection(controller.signal).then(setDocumentConnection).catch(()=>setDocumentConnection(previewConnection));return()=>controller.abort();},[]);

  useEffect(() => {
    const controller = new AbortController();
    clientRepository.getDirectory(controller.signal).then((snapshot) => {
      clients.splice(0,clients.length,...snapshot.clients);
      for (const key of Object.keys(unitCommercialContexts)) delete unitCommercialContexts[key];
      Object.assign(unitCommercialContexts,snapshot.unitContexts);
      for (const unit of units) {
        const buyers=unitCommercialContexts[unit.id]?.buyers ?? [];
        if (buyers.length) unit.client=buyers.map((buyer)=>buyer.name).join(" a ");
      }
      setClientDataVersion((version)=>version+1);
    }).catch(()=>undefined);
    return ()=>controller.abort();
  },[catalogVersion,clientReloadKey]);

  useEffect(()=>{
    const controller=new AbortController();
    commercialRepository.getSnapshot(controller.signal).then(snapshot=>{
      contracts.splice(0,contracts.length,...snapshot.contracts);
      for(const key of Object.keys(unitPriceHistories))delete unitPriceHistories[key];
      Object.assign(unitPriceHistories,snapshot.priceHistories);
      for(const unit of units)if(snapshot.currentPrices[unit.id]!=null)unit.price=snapshot.currentPrices[unit.id];
      setCommercialDataVersion(version=>version+1);
    }).catch(()=>undefined);
    return()=>controller.abort();
  },[catalogVersion,commercialReloadKey]);

  useEffect(() => {
    const controller = new AbortController();
    catalogRepository.getCatalog(controller.signal).then((catalog) => {
      projects.splice(0, projects.length, ...catalog.projects);
      units.splice(0, units.length, ...catalog.units);
      setCatalogAccessories(catalog.accessories||[]);setCatalogMemberships(catalog.memberships||[]);setCatalogStructures(catalog.structures||[]);
      setSelectedProject((current) => current ? catalog.projects.find((project) => project.code === current.code) ?? current : current);
      setUnitDetail((current) => current ? catalog.units.find((unit) => unit.id === current.id) ?? current : current);
      setUnitPreview((current) => current ? catalog.units.find((unit) => unit.id === current.id) ?? current : current);
      setCatalogVersion((version) => version + 1);
    }).catch(() => undefined);
    return () => controller.abort();
  }, [catalogReloadKey]);

  useEffect(()=>{const controller=new AbortController();taskRepository.list(taskScope,identitySession.user.displayName,controller.signal).then(saved=>{setTaskRows(saved);if(taskScope==="mine")setTaskOpenCount(saved.filter(item=>!item.done).length);else void taskRepository.list("mine",identitySession.user.displayName,controller.signal).then(mine=>setTaskOpenCount(mine.filter(item=>!item.done).length));}).catch(()=>{const fallback=taskScope==="completed"?initialTasks.filter(item=>item.done):taskScope==="all"?initialTasks:initialTasks.filter(item=>!item.done&&item.owner==="Iva");setTaskRows(fallback);setTaskOpenCount(initialTasks.filter(item=>!item.done&&item.owner==="Iva").length);}).finally(()=>setTaskLoading(false));return()=>controller.abort();},[taskScope,identitySession.user.displayName]);

  const filteredUnits = useMemo(() => {
    void catalogVersion;
    const selectedProjectRecord=projects.find(project=>project.name===projectFilter);
    return units.filter((unit) => {
      const matchesProject = projectFilter === "Všechny projekty" || (selectedProjectRecord ? unitBelongsToProject(unit,selectedProjectRecord) : unit.project === projectFilter);
      const matchesBuilding = buildingFilter.length === 0 || buildingFilter.includes(unit.building);
      const matchesFloor = floorFilter.length === 0 || floorFilter.includes(unit.floor);
      const matchesStatus = statusFilter.length === 0 || statusFilter.includes(unit.status);
      const matchesLayout = layoutFilter.length === 0 || layoutFilter.includes(unit.layout);
      const matchesAreaFrom = !areaFrom || unit.area >= Number(areaFrom);
      const matchesAreaTo = !areaTo || unit.area <= Number(areaTo);
      const matchesPriceFrom = !priceFrom || unit.price >= Number(priceFrom) * 1_000_000;
      const matchesPriceTo = !priceTo || unit.price <= Number(priceTo) * 1_000_000;
      return matchesProject && matchesBuilding && matchesFloor && matchesStatus && matchesLayout && matchesAreaFrom && matchesAreaTo && matchesPriceFrom && matchesPriceTo;
    });
  }, [projectFilter, buildingFilter, floorFilter, statusFilter, layoutFilter, areaFrom, areaTo, priceFrom, priceTo, catalogVersion]);

  const searchResults = useMemo(() => {
    void catalogVersion;
    void clientDataVersion;
    const query = search.trim().toLowerCase();
    if (query.length < 2) return [];
    const unitResults = units
      .filter((unit) => `${unit.id} ${unit.client || ""} ${unit.project}`.toLowerCase().includes(query))
      .slice(0, 4)
      .map((unit) => ({ type: "Jednotka", title: unit.id, detail: `${unit.layout} · ${unit.project}`, unit }));
    const clientResults = clients
      .filter((client) => `${client.name} ${client.contact}`.toLowerCase().includes(query))
      .slice(0, 3)
      .map((client) => ({ type: "Klient", title: client.name, detail: client.projects, unit: undefined }));
    return [...unitResults, ...clientResults];
  }, [search, catalogVersion, clientDataVersion]);

  const navigate = (nextPage: Page) => {
    setMobileNav(false);
    router.push(pageRoute(nextPage));
  };

  const openProject = (project: ProjectRecord, tab: ProjectTab = "overview") => {
    setMobileNav(false);
    router.push(projectRoute(projectRouteId(project),tab));
  };

  const openUnit = (unit: UnitRecord) => {
    setSearchFocused(false);
    router.push(unitRoute(unitRouteId(unit)));
  };

  const openClient = (identity: string) => {
    const client=clients.find(item=>item.id===identity||item.name===identity);
    if(client)router.push(clientRoute(client.id));
  };

  const openContract=(contract:(typeof contracts)[number])=>{const id=contract.id??contract.reference;if(id)router.push(contractRoute(id));};
  const navigateProjectTab=(tab:ProjectTab)=>{if(selectedProject)router.push(projectRoute(projectRouteId(selectedProject),tab,tab==="units"?searchParams.toString():""));};
  const navigateUnitTab=(tab:UnitTab)=>{if(unitDetail)router.push(unitRoute(unitRouteId(unitDetail),tab));};
  const updateUnitListRoute=(patch:Record<string,string|string[]>)=>router.replace(updateSearch(pathname,searchParams.toString(),patch),{scroll:false});
  const updateTaskScope=(scope:"mine"|"all"|"completed")=>router.push(updateSearch("/tasks","",{scope:scope==="mine"?"":scope}));
  const updateGlobalSearch=(value:string)=>{setSearch(value);router.replace(updateSearch(pathname,searchParams.toString(),{q:value}),{scroll:false});};

  const browsePreview = (direction: -1 | 1) => {
    if (!unitPreview || !filteredUnits.length) return;
    const currentIndex = filteredUnits.findIndex((item) => item.id === unitPreview.id);
    const nextIndex = (currentIndex + direction + filteredUnits.length) % filteredUnits.length;
    setUnitPreview(filteredUnits[nextIndex]);
  };

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2800);
  };
  const refreshCatalog = () => setCatalogReloadKey((key) => key + 1);
  const refreshClients = () => setClientReloadKey((key) => key + 1);
  const refreshCommercial = () => setCommercialReloadKey((key) => key + 1);

  const toggleTask = (id: string|number) => {
    const row=taskRows.find(task=>task.id===id);if(!row)return;const done=!row.done;
    setTaskRows((rows) => rows.map((task) => (task.id === id ? { ...task, done } : task)));
    if(row.owner==="Iva"||row.owner===identitySession.user.displayName)setTaskOpenCount(count=>Math.max(0,count+(done?-1:1)));
    void taskRepository.complete(id,done).then(()=>notify(done?"Úkol byl dokončen":"Úkol byl znovu otevřen")).catch(error=>{setTaskRows(rows=>rows.map(task=>task.id===id?{...task,done:!done}:task));if(row.owner==="Iva"||row.owner===identitySession.user.displayName)setTaskOpenCount(count=>Math.max(0,count+(done?1:-1)));notify(error instanceof Error?error.message:"Úkol nelze aktualizovat");});
  };

  const saveTask = async (value:{title:string;description:string;objectType:string;objectId:string;assigneeId:string|null;priority:"low"|"medium"|"high";dueAt:string}) => {
    const created=await taskRepository.create({title:value.title,description:value.description,objectType:value.objectType,objectId:value.objectId,assignedToUserId:value.assigneeId,assigneeName:catalogMemberships.find(item=>item.id===value.assigneeId)?.name,priority:value.priority,dueAt:value.dueAt},identitySession.user.displayName);
    setTaskRows((rows) => [created, ...rows]);if(created.owner==="Iva"||created.owner===identitySession.user.displayName)setTaskOpenCount(count=>count+1);setNewTaskOpen(false);notify(`Úkol „${value.title}“ byl vytvořen`);
    if(value.objectType==="unit"){recordPreviewActivity({unitKey:value.objectId,title:"Vytvořen úkol",detail:`${identitySession.user.displayName} · ${value.title}`,action:"task.created"});setActivityReloadKey(key=>key+1);}
  };

  return (
    <div className="crm-shell">
      <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
        <div className="brand">
          <span className="brand-mark" aria-label="Místo pro logo IMMO Building"><Building2 size={20} /></span>
          <span className="brand-copy"><strong>DeveloCRM</strong><small>IMMO Building</small></span>
          <button className="mobile-close" onClick={() => setMobileNav(false)} aria-label="Zavřít navigaci"><X size={20} /></button>
        </div>

        <nav className="main-nav" aria-label="Hlavní navigace">
          <p className="nav-label">PRACOVNÍ PROSTOR</p>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} className={page === item.id && !unitDetail ? "active" : ""} onClick={() => navigate(item.id)}>
                <Icon size={19} strokeWidth={1.8} />
                <span>{item.label}</span>
                {item.id === "tasks" && <span className="nav-count">{taskOpenCount}</span>}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-project">
          <p className="nav-label">AKTUÁLNÍ PROJEKT</p>
          <button onClick={() => openProject(projects[0])}>
            <span className="project-mini-icon">RJ</span>
            <span><strong>Rezidence Javorová</strong><small>68 jednotek</small></span>
            <ChevronRight size={16} />
          </button>
        </div>

        <div className="sidebar-footer">
          <div className={`sync-state ${documentConnection.status==="connected"?"":"disconnected"}`}>{documentConnection.status==="connected"?<CheckCircle2 size={15}/>:<AlertTriangle size={15}/>}<span>{documentConnection.status==="connected"?"SharePoint připojen":"SharePoint nepřipojen"}</span></div>
          <button className="user-profile" onClick={()=>setProfileOpen(true)} aria-label="Otevřít uživatelský profil">
            <Avatar initials={initials(identitySession.user.displayName)} />
            <span><strong>{identitySession.user.displayName}</strong><small>{roleLabel(identitySession.workspace.roles)}</small></span>
            <MoreHorizontal size={17} />
          </button>
        </div>
      </aside>

      {mobileNav && <button className="nav-scrim" aria-label="Zavřít navigaci" onClick={() => setMobileNav(false)} />}

      <div className="workspace">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMobileNav(true)} aria-label="Otevřít navigaci"><Menu size={21} /></button>
          <div className="global-search">
            <Search size={19} />
            <input
              value={search}
              onChange={(event) => updateGlobalSearch(event.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => window.setTimeout(() => setSearchFocused(false), 160)}
              placeholder="Hledat jednotku, klienta, smlouvu…"
              aria-label="Globální hledání"
            />
            <span className="search-shortcut">⌘ K</span>
            {searchFocused && search.length >= 2 && (
              <div className="search-results">
                <p>Výsledky hledání</p>
                {searchResults.length ? searchResults.map((result, index) => (
                  <button key={`${result.title}-${index}`} onClick={() => result.unit ? openUnit(result.unit) : openClient(result.title)}>
                    <span className="search-result-icon">{result.type === "Jednotka" ? <Home size={17} /> : <UserRound size={17} />}</span>
                    <span><strong>{result.title}</strong><small>{result.detail}</small></span>
                    <Badge tone="neutral">{result.type}</Badge>
                  </button>
                )) : <div className="empty-search">Nic jsme nenašli. Zkuste jiný výraz.</div>}
              </div>
            )}
          </div>
          <div className="topbar-actions">
            <button className="icon-button" aria-label="Nápověda"><span className="help-icon">?</span></button>
            <button className="icon-button bell-button" aria-label="Oznámení"><Bell size={19} /><span /></button>
            <Avatar initials={initials(identitySession.user.displayName)} small />
          </div>
        </header>

        <main className="main-content">
          {unitDetail ? (
            <UnitDetail unit={unitDetail} tab={unitTab} onTab={navigateUnitTab} onBack={() => selectedProject&&router.push(projectRoute(projectRouteId(selectedProject),"units"))} openProjects={()=>router.push("/projects")} openProject={()=>selectedProject&&router.push(projectRoute(projectRouteId(selectedProject)))} notify={notify} openTask={() => setNewTaskOpen(true)} openClient={openClient} openContract={openContract} onEdit={can("unit.manage")?()=>setUnitEdit(unitDetail):undefined} onEditPrice={can("price.manage")||can("prices.change")?()=>setPriceEdit(unitDetail):undefined} onManageAccessories={can("accessory.manage")?()=>setAccessoryUnit(unitDetail):undefined} onEditFloorplan={(can("media.manage")||can("unit.manage"))?()=>setMediaEdit({entityType:"unit",entityId:unitDetail.backendId??unitDetail.id,unitKey:unitDetail.id,kind:"floorplan",title:`Půdorys · ${unitDetail.id}`}):undefined} onSalesAction={(can("holds.manage")||can("interests.manage"))?(mode)=>setSalesAction({unit:unitDetail,mode}):undefined} canCancelHold={can("holds.cancel")||can("holds.manage")} onContractWorkflow={can("contract.manage")?setContractEdit:undefined} timelineVersion={catalogReloadKey+clientReloadKey+commercialReloadKey+activityReloadKey} />
          ) : selectedProject ? (
            <ProjectDetail
              project={selectedProject}
              tab={projectTab}
              onTab={navigateProjectTab}
              onBack={() => router.push("/projects")}
              openClient={openClient}
              openContract={openContract}
              unitView={unitView}
              setUnitView={(value)=>{setUnitView(value);updateUnitListRoute({view:value==="cards"?"cards":""});}}
              filteredUnits={filteredUnits}
              previewUnit={setUnitPreview}
              openUnit={openUnit}
              buildingFilter={buildingFilter}
              setBuildingFilter={(value)=>{setBuildingFilter(value);updateUnitListRoute({building:value});}}
              floorFilter={floorFilter}
              setFloorFilter={(value)=>{setFloorFilter(value);updateUnitListRoute({floor:value});}}
              statusFilter={statusFilter}
              setStatusFilter={(value)=>{setStatusFilter(value);updateUnitListRoute({status:value});}}
              layoutFilter={layoutFilter}
              setLayoutFilter={(value)=>{setLayoutFilter(value);updateUnitListRoute({layout:value});}}
              areaFrom={areaFrom}
              setAreaFrom={(value)=>{setAreaFrom(value);updateUnitListRoute({areaFrom:value});}}
              areaTo={areaTo}
              setAreaTo={(value)=>{setAreaTo(value);updateUnitListRoute({areaTo:value});}}
              priceFrom={priceFrom}
              setPriceFrom={(value)=>{setPriceFrom(value);updateUnitListRoute({priceFrom:value});}}
              priceTo={priceTo}
              setPriceTo={(value)=>{setPriceTo(value);updateUnitListRoute({priceTo:value});}}
              unitQuery={unitQuery}
              setUnitQuery={(value)=>{setUnitQuery(value);updateUnitListRoute({unit:value});}}
              clientQuery={unitClientQuery}
              setClientQuery={(value)=>{setUnitClientQuery(value);updateUnitListRoute({client:value});}}
              resetFilters={()=>{setBuildingFilter([]);setFloorFilter([]);setStatusFilter([]);setLayoutFilter([]);setAreaFrom("");setAreaTo("");setPriceFrom("");setPriceTo("");setUnitQuery("");setUnitClientQuery("");updateUnitListRoute({building:"",floor:"",status:"",layout:"",areaFrom:"",areaTo:"",priceFrom:"",priceTo:"",unit:"",client:""});}}
              notify={notify}
              onEditProject={can("project.manage")?() => setProjectEdit(selectedProject):undefined}
              onEditCover={(can("media.manage")||can("project.manage"))?()=>setMediaEdit({entityType:"project",entityId:selectedProject.backendId??selectedProject.code,kind:"cover",title:`Titulní obrázek · ${selectedProject.name}`}):undefined}
            />
          ) : (
            <>
              <div className="page-header">
                <div>
                  <div className="eyebrow">ÚTERÝ 21. ČERVENCE 2026</div>
                  <h1>{page === "dashboard" ? `Dobré ráno, ${vocativeFirstName(identitySession.user.displayName)}` : pageTitles[page].title}</h1>
                  <p>{pageTitles[page].subtitle}</p>
                </div>
                <div className="page-actions">
                  {page === "projects" && <button className="secondary-button" onClick={() => notify("Ceník se připravuje ke stažení")}><Download size={17} /> Export ceníku</button>}
                  {page === "contracts" && <button className="secondary-button" onClick={() => notify("Otevírám správu šablon")}><FileCheck2 size={17} /> Šablony</button>}
                  <button className="primary-button" onClick={() => page === "tasks" || page === "dashboard" ? setNewTaskOpen(true) : notify(page === "clients" ? "Formulář nového klienta je připraven" : "Nový záznam lze nyní založit")}>
                    <Plus size={18} /> {page === "tasks" ? "Nový úkol" : page === "clients" ? "Nový klient" : page === "contracts" ? "Nová smlouva" : page === "payments" ? "Přidat platbu" : page === "handovers" ? "Naplánovat předání" : page === "projects" ? "Nový projekt" : "Přidat úkol"}
                  </button>
                </div>
              </div>

              {page === "dashboard" && <Dashboard navigate={navigate} openUnit={openUnit} taskRows={taskRows} toggleTask={toggleTask} />}
              {page === "projects" && <Projects openProject={openProject} />}
              {page === "clients" && <ClientsPage openUnit={openUnit} openProject={project=>router.push(projectRoute(projectRouteId(project)))} selectedClientName={selectedClientName} setSelectedClientName={(value)=>value?openClient(value):router.push("/clients")} notify={notify} onEditClient={can("clients.manage")?setClientEdit:undefined} />}
              {page === "contracts" && <ContractsPage openUnit={openUnit} openClient={openClient} openContract={openContract} selectedContractId={routedContractId} notify={notify} onWorkflow={can("contract.manage")?setContractEdit:undefined} />}
              {page === "payments" && <PaymentsPage openUnit={openUnit} notify={notify} />}
              {page === "handovers" && <HandoversPage openUnit={openUnit} notify={notify} />}
              {page === "tasks" && <TasksPage rows={taskRows} toggleTask={toggleTask} openUnit={openUnit} scope={taskScope} onScope={updateTaskScope} loading={taskLoading} />}
            </>
          )}
        </main>
      </div>

      {unitPreview && <UnitPreview unit={unitPreview} close={() => setUnitPreview(null)} open={() => openUnit(unitPreview)} previous={() => browsePreview(-1)} next={() => browsePreview(1)} position={Math.max(1, filteredUnits.findIndex((item) => item.id === unitPreview.id) + 1)} total={filteredUnits.length} />}
      {unitPreview && <button className="panel-scrim" aria-label="Zavřít náhled" onClick={() => setUnitPreview(null)} />}
      {newTaskOpen && <TaskModal close={() => setNewTaskOpen(false)} save={saveTask} memberships={[{id:"",name:identitySession.user.displayName},...catalogMemberships.filter(item=>item.name!==identitySession.user.displayName)]} defaultUnit={unitDetail?.id} />}
      {profileOpen&&<ProfileModal session={identitySession} close={()=>routeState.kind==="admin-users"?router.push("/dashboard"):setProfileOpen(false)} openAdmin={()=>router.push("/admin/users")} canAdmin={can("users.manage")||identitySession.workspace.roles.includes("admin")}/>}
      {mediaEdit&&<MediaModal value={mediaEdit} close={()=>setMediaEdit(null)} save={async file=>{const media=await mediaRepository.upload(mediaEdit.entityType,mediaEdit.entityId,mediaEdit.kind,file);if(mediaEdit.entityType==="project"){setSelectedProject(current=>current?{...current,coverImageUrl:media.url}:current);}else{setUnitDetail(current=>current?{...current,floorplanAvailable:true,floorplanImageUrl:media.url}:current);recordPreviewActivity({unitKey:mediaEdit.unitKey??mediaEdit.entityId,title:"Změněn půdorys jednotky",detail:`${identitySession.user.displayName} · ${file.name}`,icon:"document",action:"unit.floorplan_changed"});setActivityReloadKey(key=>key+1);}setMediaEdit(null);notify("Obrázek byl uložen");}}/>}
      {projectEdit && <EditProjectModal project={projectEdit} memberships={catalogMemberships} canChangeManager={can("projects.change_manager")} canChangeStatus={can("projects.change_status")} close={() => setProjectEdit(null)} save={async (value) => { const id=projectEdit.backendId??projectEdit.code;await catalogRepository.updateProject({id,name:value.name,location:value.location,lifecycleStatus:value.lifecycleStatus,managerMembershipId:value.managerMembershipId,plannedHandoverFrom:value.plannedCompletionFrom,plannedHandoverTo:value.plannedCompletionTo});if(value.stageCode!==labelToConstructionCode(projectEdit.stage))await catalogRepository.recordProjectConstructionStatus({projectId:id,statusCode:value.stageCode,effectiveAt:new Date().toISOString(),note:value.stageReason||"Aktualizace fáze projektu"}); setSelectedProject({...projectEdit,name:value.name,location:value.location,lifecycleStatus:value.lifecycleStatus,managerMembershipId:value.managerMembershipId,manager:catalogMemberships.find(item=>item.id===value.managerMembershipId)?.name??projectEdit.manager,stage:constructionCodeToLabel(value.stageCode),plannedCompletionFrom:value.plannedCompletionFrom,plannedCompletionTo:value.plannedCompletionTo,plannedHandover:quarterFromDate(value.plannedCompletionFrom)}); setProjectEdit(null); notify("Projekt byl uložen"); refreshCatalog(); }} />}
      {unitEdit && <EditUnitModal unit={unitEdit} structures={catalogStructures.filter(item=>item.project===unitEdit.project)} close={() => setUnitEdit(null)} save={async (value) => { await catalogRepository.updateUnit({id: unitEdit.backendId??unitEdit.id,...value}); setUnitDetail({...unitEdit,structureId:value.structureId,building:catalogStructures.find(item=>item.id===value.structureId)?.name??"Bez zařazení",layout:value.layout,area:value.areaM2,usableArea:value.usableAreaM2,floor:value.floorLabel,orientation:value.orientation,balcony:value.balconyM2,terrace:value.terraceM2,garden:value.gardenM2}); setUnitEdit(null); notify("Jednotka byla uložena"); refreshCatalog(); }} />}
      {priceEdit && <EditPriceModal unit={priceEdit} close={() => setPriceEdit(null)} save={async (value) => { await commercialRepository.recordPrice({unitId:priceEdit.backendId??priceEdit.id,unitKey:priceEdit.id,actorName:identitySession.user.displayName,...value}); setUnitDetail({...priceEdit,price:value.priceType==="individual_discount"?priceEdit.price-value.amount:value.amount}); setPriceEdit(null); notify("Nový záznam ceny byl uložen"); refreshCommercial(); }} />}
      {accessoryUnit&&<AccessoryModal unit={accessoryUnit} inventory={catalogAccessories.filter(item=>item.project===accessoryUnit.project)} close={()=>setAccessoryUnit(null)} assign={async accessory=>{await catalogRepository.assignAccessory(accessoryUnit.backendId??accessoryUnit.id,accessory.id);notify(`${accessory.type} ${accessory.code} bylo přiřazeno`);setAccessoryUnit(null);refreshCatalog();}} remove={async assignment=>{if(!window.confirm(`Opravdu uvolnit ${assignment.type} ${assignment.code}?`))return;await catalogRepository.removeAccessory(assignment.assignmentId??assignment.id);notify(`${assignment.type} ${assignment.code} bylo uvolněno`);setAccessoryUnit(null);refreshCatalog();}}/>}
      {salesAction&&<SalesActionModal action={salesAction} clientRows={clients} close={()=>setSalesAction(null)} save={async value=>{const unitId=salesAction.unit.backendId??salesAction.unit.id;const unitKey=salesAction.unit.id;const context=unitCommercialContexts[unitKey]??{buyers:[],interests:[],stage:null,hold:null};let nextStatus:string|undefined;if(salesAction.mode==="interest"){await salesCommandRepository.addInterest({unitId,unitKey,partyId:value.partyId,eventType:"inquiry",note:value.reason});const party=clients.find(item=>item.id===value.partyId);if(party&&!context.interests.some(item=>item.partyId===party.id))context.interests.unshift({date:new Date().toLocaleDateString("cs-CZ"),partyId:party.id,name:party.name,type:"Aktivní zájem",result:"Aktivní"});}else if(salesAction.mode==="convert"&&context.hold){await salesCommandRepository.convertHold({holdId:context.hold.id,unitKey,expiresAt:value.expiresAt,reason:value.reason});context.hold={...context.hold,type:"reservation",expiresAt:value.expiresAt};context.stage="reservation";nextStatus="Rezervace";}else if(salesAction.mode==="cancel"&&context.hold){await salesCommandRepository.cancelHold({holdId:context.hold.id,unitKey,reason:value.reason});context.hold=null;context.stage="interest";nextStatus="Volný";}else{await salesCommandRepository.createHold({unitId,unitKey,type:salesAction.mode as "pre_reservation"|"reservation",partyIds:[value.partyId],expiresAt:value.expiresAt,reason:value.reason});context.hold={id:`local-${Date.now()}`,type:salesAction.mode,expiresAt:value.expiresAt};context.stage=salesAction.mode;nextStatus=salesAction.mode==="reservation"?"Rezervace":"Předrezervace";}unitCommercialContexts[unitKey]=context;if(nextStatus)setUnitDetail(current=>current?.id===unitKey?{...current,status:nextStatus}:current);setSalesAction(null);notify("Obchodní operace byla dokončena");refreshClients();if(salesAction.mode!=="interest")refreshCatalog();}}/>}
      {contractEdit&&<ContractWorkflowModal contract={contractEdit} close={()=>setContractEdit(null)} save={async value=>{if(!contractEdit.id)throw new Error("Smlouva nemá backendový identifikátor");await commercialRepository.transitionContract({contractId:contractEdit.id,to:value.to,reason:value.reason});setContractEdit(null);notify("Stav smlouvy byl změněn");refreshCommercial();}}/>}
      {clientEdit && <EditClientModal client={clientEdit} close={() => setClientEdit(null)} save={async (value) => { await clientRepository.updateProfile({id:clientEdit.id,firstName:value.firstName,lastName:value.lastName,legalName:value.legalName,registrationNumber:value.registrationNumber,vatNumber:value.vatNumber,contactPerson:value.contactPerson});if(value.email!==clientEdit.email) await clientRepository.upsertContact({partyId:clientEdit.id,contactType:"email",value:value.email,isPrimary:true});if(value.phone!==clientEdit.phone) await clientRepository.upsertContact({partyId:clientEdit.id,contactType:"phone",value:value.phone,isPrimary:true});if(value.line1&&value.city)await clientRepository.upsertAddress({partyId:clientEdit.id,addressType:clientEdit.kind==="FO"?"residence":"registered_office",line1:value.line1,line2:value.line2,city:value.city,postalCode:value.postalCode,countryCode:value.countryCode});const name=value.legalName||`${value.firstName} ${value.lastName}`.trim();const current=clients.find(c=>c.id===clientEdit.id);if(current)Object.assign(current,{...value,name});setSelectedClientName(name);setClientEdit(null);notify("Klient byl uložen");refreshClients(); }} />}
      {toast && <div className="toast"><CheckCircle2 size={18} /> {toast}</div>}
    </div>
  );
}

function Dashboard({ navigate, openUnit, taskRows, toggleTask }: { navigate: (page: Page) => void; openUnit: (unit: UnitRecord) => void; taskRows: TaskRecord[]; toggleTask: (id: string|number) => void }) {
  return (
    <div className="dashboard-grid">
      <section className="attention-card card span-8">
        <div className="attention-heading">
          <div><span className="attention-icon"><Sparkles size={19} /></span><div><h2>Vyžaduje pozornost</h2><p>5 věcí, které je dobré dnes vyřešit</p></div></div>
          <button className="text-button" onClick={() => navigate("tasks")}>Zobrazit vše <ArrowRight size={15} /></button>
        </div>
        <div className="attention-list">
          <button onClick={() => openUnit(units[0])}>
            <span className="attention-type danger"><AlertTriangle size={18} /></span>
            <span><strong>A203 · SBK nelze vygenerovat</strong><small>Chybí číslo účtu klienta · Rezidence Javorová</small></span>
            <Badge tone="danger">Dnes</Badge><ChevronRight size={18} />
          </button>
          <button onClick={() => openUnit(units[6])}>
            <span className="attention-type warning"><KeyRound size={18} /></span>
            <span><strong>C102 · Předání není připraveno</strong><small>Chybí revize wallboxu · termín 26. 7.</small></span>
            <Badge tone="warning">5 dní</Badge><ChevronRight size={18} />
          </button>
          <button onClick={() => openUnit(units[8])}>
            <span className="attention-type danger"><Banknote size={18} /></span>
            <span><strong>D404 · 2. splátka po splatnosti</strong><small>Zbývá uhradit 998 000 Kč · 5 dní po splatnosti</small></span>
            <Badge tone="danger">Urgentní</Badge><ChevronRight size={18} />
          </button>
          <button onClick={() => openUnit(units[2])}>
            <span className="attention-type blue"><FileText size={18} /></span>
            <span><strong>A305 · RS čeká na podpis</strong><small>Odesláno klientovi před 3 dny</small></span>
            <Badge tone="neutral">3 dny</Badge><ChevronRight size={18} />
          </button>
        </div>
      </section>

      <section className="today-card card span-4">
        <SectionTitle title="Dnes" />
        <div className="today-date"><strong>21</strong><span>ČERVENEC<small>Úterý</small></span></div>
        <div className="today-events">
          <div><span className="event-time">10:00</span><span className="event-line green" /><span><strong>Kontrola předání C102</strong><small>Parková čtvrť · 45 min</small></span></div>
          <div><span className="event-time">13:30</span><span className="event-line purple" /><span><strong>Podpis SBK · A203</strong><small>Online schůzka · 30 min</small></span></div>
          <div><span className="event-time">15:00</span><span className="event-line sand" /><span><strong>Porada projektu</strong><small>Rezidence Javorová</small></span></div>
        </div>
        <button className="calendar-link" onClick={() => navigate("handovers")}><CalendarDays size={16} /> Otevřít kalendář</button>
      </section>

      <section className="card span-7">
        <SectionTitle title="Moje projekty" action="Všechny projekty" onAction={() => navigate("projects")} />
        <div className="project-list">
          {projects.map((project) => (
            <button key={project.name} onClick={() => navigate("projects")} className="project-row">
              <span className={`project-avatar ${project.color}`}>{project.name.split(" ").map((part) => part[0]).join("").slice(0, 2)}</span>
              <span className="project-copy"><strong>{project.name}</strong><small>{project.location} · {project.stage}</small></span>
              <span className="project-progress"><small>{project.sold} z {project.units} prodáno</small><span><i style={{ width: `${(project.sold / project.units) * 100}%` }} /></span></span>
              <span className="project-attention">{project.attention}<small>k řešení</small></span>
              <ChevronRight size={18} />
            </button>
          ))}
        </div>
      </section>

      <section className="card span-5 task-card">
        <SectionTitle title="Moje úkoly" action="Zobrazit vše" onAction={() => navigate("tasks")} />
        <div className="mini-task-list">
          {taskRows.filter(task=>!task.done).slice(0, 4).map((task) => (
            <div key={task.id} className={task.done ? "done" : ""}>
              <button onClick={() => toggleTask(task.id)} className="task-check" aria-label={`Dokončit úkol ${task.title}`}>{task.done && <Check size={14} />}</button>
              <span><strong>{task.title}</strong><small>{task.object}</small></span>
              <Badge tone={task.due === "Dnes" ? "danger" : "neutral"}>{task.due}</Badge>
            </div>
          ))}
        </div>
      </section>

      <section className="card span-12 activity-card">
        <SectionTitle title="Poslední aktivita" action="Celá historie" onAction={() => navigate("projects")} />
        <div className="activity-table">
          {activity.map((item, index) => (
            <div key={`${item.time}-${index}`}>
              <span className={`activity-dot ${item.kind}`} />
              <span className="activity-copy"><strong>{item.title}</strong><small>{item.meta}</small></span>
              <time>{item.time}</time>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Projects({ openProject }: { openProject: (project: ProjectRecord) => void }) {
  const totals = projects.reduce((sum, project) => ({
    units: sum.units + project.units,
    reserved: sum.reserved + project.reserved,
    sold: sum.sold + project.sold + project.handedOver,
  }), { units: 0, reserved: 0, sold: 0 });
  return (
    <div className="projects-page">
      <div className="portfolio-summary card">
        <div><span className="metric-icon green"><Building2 size={20} /></span><span><small>Aktivní projekty</small><strong>3</strong></span></div>
        <div><span className="metric-icon blue"><Home size={20} /></span><span><small>Jednotky celkem</small><strong>{totals.units}</strong></span></div>
        <div><span className="metric-icon sand"><Clock3 size={20} /></span><span><small>Rezervované</small><strong>{totals.reserved}</strong></span></div>
        <div><span className="metric-icon purple"><CheckCircle2 size={20} /></span><span><small>Prodané a předané</small><strong>{totals.sold}</strong></span></div>
      </div>
      <div className="project-cards">
        {projects.map((project) => (
          <article className="project-card card" key={project.name} role="button" tabIndex={0} aria-label={`Otevřít projekt ${project.name}`} onClick={() => openProject(project)} onKeyDown={(event) => { if(event.key==="Enter"||event.key===" "){event.preventDefault();openProject(project);} }}>
            <ProjectCover project={project}/>
            <div className="project-card-body">
              <div><h3>{project.name}</h3><p><MapPin size={14} /> {project.location}</p></div>
              <div className="project-unit-stats">
                <span><i className="available" /><strong>{project.available}</strong><small>volných</small></span>
                <span><i className="reserved" /><strong>{project.reserved}</strong><small>rezervovaných</small></span>
                <span><i className="sold" /><strong>{project.sold}</strong><small>prodaných</small></span>
                <span><strong>{project.units}</strong><small>celkem</small></span>
              </div>
              <div className="large-progress"><span><small>Prodejnost projektu</small><strong>{Math.round((project.sold + project.handedOver) / project.units * 100)} %</strong></span><div><i style={{ width: `${(project.sold + project.handedOver) / project.units * 100}%` }} /></div></div>
              <div className="project-card-meta"><span><small>VEDOUCÍ PROJEKTU</small><strong>{project.manager}</strong></span><span><small>PLÁNOVANÉ DOKONČENÍ</small><strong>{project.plannedHandover}</strong></span></div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function ProjectCover({project}:{project:ProjectRecord}){const [url,setUrl]=useState(project.coverImageUrl??null);useEffect(()=>{if(url)return;const controller=new AbortController();mediaRepository.get("project",project.backendId??project.code,controller.signal).then(media=>{if(media)setUrl(media.url);}).catch(()=>undefined);return()=>controller.abort();},[project.backendId,project.code,url]);return <div className={`project-cover ${project.color} ${url?"has-image":""}`} style={url?{backgroundImage:`linear-gradient(180deg,rgba(10,28,22,.05),rgba(10,28,22,.42)),url(${JSON.stringify(url).slice(1,-1)})`}:undefined}><span>{project.code}</span><Badge tone="neutral">{project.stage}</Badge></div>}

type UnitListProps = {
  project: ProjectRecord;
  unitView: "table" | "cards";
  setUnitView: (value: "table" | "cards") => void;
  filteredUnits: UnitRecord[];
  previewUnit: (unit: UnitRecord) => void;
  openUnit: (unit: UnitRecord) => void;
  buildingFilter: string[];
  setBuildingFilter: (value: string[]) => void;
  floorFilter: string[];
  setFloorFilter: (value: string[]) => void;
  statusFilter: string[];
  setStatusFilter: (value: string[]) => void;
  layoutFilter: string[];
  setLayoutFilter: (value: string[]) => void;
  areaFrom: string;
  setAreaFrom: (value: string) => void;
  areaTo: string;
  setAreaTo: (value: string) => void;
  priceFrom: string;
  setPriceFrom: (value: string) => void;
  priceTo: string;
  setPriceTo: (value: string) => void;
  unitQuery:string;
  setUnitQuery:(value:string)=>void;
  clientQuery:string;
  setClientQuery:(value:string)=>void;
  resetFilters:()=>void;
};

function ProjectDetail({ project, tab, onTab, onBack, notify, openClient,openContract, onEditProject,onEditCover, ...unitListProps }: UnitListProps & { tab: ProjectTab; onTab: (tab: ProjectTab) => void; onBack: () => void; notify: (message: string) => void; openClient: (name: string) => void;openContract:(contract:(typeof contracts)[number])=>void; onEditProject?: () => void;onEditCover?:()=>void }) {
  const projectClients = clients.filter((client) => client.projectNames.some(name=>projectMatchesName(project,name)));
  const projectContracts = contracts.filter((contract) => projectMatchesName(project,contract.project));
  const projectPayments = payments.filter((payment) => projectMatchesName(project,payment.project));
  const projectHandovers = units.filter((unit) => unitBelongsToProject(unit,project) && unit.handover !== "Neplánováno");
  const salePercent = Math.round((project.sold + project.handedOver) / project.units * 100);
  const soldAndHandedOver = project.sold + project.handedOver;
  const unitDistribution = [
    { label: "Volné", value: project.available, className: "available" },
    { label: "Předrezervované", value: project.preReserved, className: "pre-reserved" },
    { label: "Rezervované", value: project.reserved, className: "reserved" },
    { label: "Prodané", value: project.sold, className: "sold" },
    { label: "Předané", value: project.handedOver, className: "handed-over" },
  ];
  const tabs: { id: ProjectTab; label: string; icon: typeof Home; count?: number }[] = [
    { id: "overview", label: "Přehled", icon: LayoutDashboard },
    { id: "units", label: "Jednotky", icon: Home, count: project.units },
    { id: "clients", label: "Klienti", icon: Users, count: projectClients.length },
    { id: "contracts", label: "Smlouvy", icon: FileText, count: projectContracts.length },
    { id: "payments", label: "Platby", icon: CircleDollarSign, count: projectPayments.length },
    { id: "changes", label: "Klientské změny", icon: SlidersHorizontal, count: 4 },
    { id: "handovers", label: "Předání", icon: KeyRound, count: projectHandovers.length },
    { id: "documents", label: "Dokumenty", icon: FolderOpen },
  ];
  return (
    <div className="project-detail">
      <div className="unit-breadcrumb"><button onClick={onBack}><ArrowLeft size={16} /> Všechny projekty</button><ChevronRight size={14} /><strong>{project.name}</strong></div>
      <div className="project-detail-hero card">
        <div className={`project-detail-mark ${project.color}`}>{project.code}</div>
        <div><span className="eyebrow">AKTUÁLNÍ PROJEKT</span><h1>{project.name} <Badge tone="neutral">{project.stage}</Badge></h1><p><MapPin size={14} /> {project.location} · {project.buildings.join(" · ")}</p></div>
        <div className="project-detail-actions">{onEditProject&&<button className="secondary-button" onClick={onEditProject}><MoreHorizontal size={16} /> Upravit projekt</button>}{onEditCover&&<button className="secondary-button" onClick={onEditCover}><ImagePlus size={16}/> Titulní obrázek</button>}<button className="secondary-button" onClick={() => notify("Ceník se připravuje ke stažení")}><Download size={16} /> Export ceníku</button><button className="primary-button" onClick={() => onTab("units")}><Home size={16} /> Otevřít jednotky</button></div>
      </div>
      <section className="card project-context-card" aria-label="Souhrn projektu">
        <div className="project-context-summary">
          <div><span className="project-summary-icon phase"><HardHat size={19} /></span><span><small>AKTUÁLNÍ FÁZE</small><strong>{project.stage}</strong></span></div>
          <div><span className="project-summary-icon manager"><UserRound size={19} /></span><span><small>VEDOUCÍ PROJEKTU</small><strong>{project.manager}</strong></span></div>
          <div><span className="project-summary-icon handover"><CalendarDays size={19} /></span><span><small>PLÁNOVANÉ DOKONČENÍ</small><strong>{project.plannedHandover}</strong></span></div>
        </div>
        <div className="project-context-visual">
          <div className="project-sale-rate-card">
            <div className="project-sale-ring" style={{ background: `conic-gradient(var(--green) 0 ${salePercent}%, #e5ece8 ${salePercent}% 100%)` }}><span><strong>{salePercent} %</strong><small>prodejnost</small></span></div>
            <div><small>PRODEJNÍ VÝKON</small><strong>{soldAndHandedOver} z {project.units} jednotek</strong><p>je prodaných nebo již předaných</p></div>
          </div>
          <div className="project-unit-distribution">
            <div className="project-distribution-head"><div><small>STAV JEDNOTEK</small><strong>Rozložení projektu</strong></div><span>{project.units} jednotek celkem</span></div>
            <div className="project-distribution-bar" role="img" aria-label={`Rozložení ${project.units} jednotek`}>{unitDistribution.map((item) => <i key={item.label} className={item.className} style={{ width: `${item.value / project.units * 100}%` }} title={`${item.label}: ${item.value}`} />)}</div>
            <div className="project-distribution-legend">{unitDistribution.map((item) => <span key={item.label}><i className={item.className} /><span><small>{item.label}</small><strong>{item.value}</strong></span></span>)}</div>
          </div>
        </div>
      </section>
      <nav className="unit-tabs project-tabs" aria-label="Navigace projektu">{tabs.map((item) => { const TabIcon = item.icon; return <button key={item.id} className={tab === item.id ? "active" : ""} aria-current={tab === item.id ? "page" : undefined} onClick={() => onTab(item.id)}><TabIcon className="project-tab-icon" size={17} />{item.label}{item.count !== undefined && <span aria-label={`${item.count} položek`}>{item.count}</span>}</button>; })}</nav>
      {tab === "overview" && <ProjectOverview project={project} onTab={onTab} />}
      {tab === "units" && <ProjectUnitList project={project} {...unitListProps} />}
      {tab === "clients" && <ProjectClients project={project} openClient={openClient} openUnit={unitListProps.openUnit} notify={notify} />}
      {tab === "contracts" && <ProjectContracts project={project} openUnit={unitListProps.openUnit} openContract={openContract} notify={notify} />}
      {tab === "payments" && <ProjectPayments project={project} openUnit={unitListProps.openUnit} />}
      {tab === "changes" && <ProjectClientChanges project={project} openUnit={unitListProps.openUnit} notify={notify} />}
      {tab === "handovers" && <ProjectHandovers project={project} openUnit={unitListProps.openUnit} notify={notify} />}
      {tab === "documents" && <ProjectDocuments project={project} notify={notify} />}
    </div>
  );
}

function ProjectOverview({ project, onTab }: { project: ProjectRecord; onTab: (tab: ProjectTab) => void }) {
  const projectTasks = initialTasks.filter((task) => projectMatchesName(project,task.project));
  const projectPayments = payments.filter((payment) => projectMatchesName(project,payment.project));
  const projectHandovers = units.filter((unit) => unitBelongsToProject(unit,project) && unit.handover !== "Neplánováno");
  const projectUnitIds = units.filter((unit) => unitBelongsToProject(unit,project)).map((unit) => unit.id);
  const projectActivity = activity.filter((item) => projectUnitIds.some((unitId) => item.meta.includes(unitId)));
  const firstUnit = projectUnitIds[0] || "—";
  const nextPayment = projectPayments.find((payment) => payment.state !== "Uhrazeno");
  const nextHandover = projectHandovers[0];
  const deadlines = [
    { date: "23. 7.", detail: `Kontrola smluvních dat ${firstUnit}`, tab: "contracts" as ProjectTab, icon: FileText },
    { date: nextPayment?.due || "31. 7.", detail: nextPayment ? `Splatnost · ${nextPayment.unit}` : "Kontrola splátkového kalendáře", tab: "payments" as ProjectTab, icon: Clock3 },
    { date: project.plannedHandover, detail: nextHandover ? `Příprava předání ${nextHandover.id}` : "Milník předávání projektu", tab: "handovers" as ProjectTab, icon: CalendarDays },
  ];
  const paid = projectPayments.reduce((sum, payment) => sum + payment.paid, 0);
  const expected = projectPayments.reduce((sum, payment) => sum + payment.amount, 0);
  return (
    <div className="project-dashboard-grid">
      <div className="project-main-column">
        <section className="card project-work-card">
          <div className="project-section-head"><div><h2>Úkoly a vyžaduje pozornost</h2><p>Nejdůležitější práce v kontextu projektu.</p></div><Badge tone="danger">{project.attention} položek</Badge></div>
          <div className="project-work-list">
            {projectTasks.slice(0, 3).map((task) => { const title = task.title.toLowerCase(); return <button key={task.id} onClick={() => onTab(title.includes("platb") ? "payments" : title.includes("předání") ? "handovers" : "units")}><span className={`attention-type ${task.priority === "Vysoká" ? "danger" : "warning"}`}><AlertTriangle size={17} /></span><span><strong>{task.title}</strong><small>{task.object} · {task.owner}</small></span><Badge>{task.due}</Badge><ChevronRight size={16} /></button>; })}
            <button onClick={() => onTab("contracts")}><span className="attention-type blue"><FileText size={17} /></span><span><strong>Dokončit rozpracované smlouvy</strong><small>{contracts.filter((contract) => projectMatchesName(project,contract.project) && contract.state !== "Podepsána").length} smlouvy čekají na další krok</small></span><Badge tone="blue">Smlouvy</Badge><ChevronRight size={16} /></button>
          </div>
        </section>
        <section className="card project-activity-card"><div className="project-section-head"><div><h2>Poslední aktivita</h2><p>Smlouvy, platby, dokumenty a změny jednotek.</p></div><Badge tone="neutral">{project.name}</Badge></div><div className="timeline-mini project-activity-list">{projectActivity.length ? projectActivity.slice(0, 5).map((item, index) => <div key={`${item.title}-${index}`}><span className={`timeline-icon ${item.kind}`}>{item.kind === "payment" ? <Banknote size={16} /> : item.kind === "handover" ? <KeyRound size={16} /> : <FileText size={16} />}</span><span><strong>{item.title}</strong><small>{item.meta}</small></span><time>{item.time}</time></div>) : <div><span className="timeline-icon"><Activity size={16} /></span><span><strong>Zatím bez nové aktivity</strong><small>Nové změny projektu se zobrazí zde.</small></span></div>}</div></section>
      </div>
      <aside className="project-side-column">
        <section className="card project-deadlines-card"><SectionTitle title="Nejbližší termíny" /><div>{deadlines.map((deadline) => { const Icon = deadline.icon; return <button key={`${deadline.date}-${deadline.detail}`} onClick={() => onTab(deadline.tab)}><Icon size={18} /><span><strong>{deadline.date}</strong><small>{deadline.detail}</small></span><ChevronRight size={16} /></button>; })}</div></section>
        <section className="card project-brief-card"><div className="project-section-head"><div><h2>Platby</h2><p>Stručný finanční přehled.</p></div><button className="text-button" onClick={() => onTab("payments")}>Detail <ArrowRight size={14} /></button></div><strong>{formatMoney(paid)}</strong><small>uhrazeno z evidovaných {formatMoney(expected)}</small><span className="payment-progress"><i style={{ width: `${expected ? paid / expected * 100 : 0}%` }} /></span><p>{projectPayments.filter((payment) => payment.state === "Po splatnosti").length} položek po splatnosti</p></section>
        <section className="card project-brief-card"><div className="project-section-head"><div><h2>Připravovaná předání</h2><p>Nejbližší jednotky k dokončení.</p></div><button className="text-button" onClick={() => onTab("handovers")}>Detail <ArrowRight size={14} /></button></div>{projectHandovers.length ? projectHandovers.slice(0, 3).map((unit) => <button className="project-brief-row" key={unit.id} onClick={() => onTab("handovers")}><span><strong>{unit.id}</strong><small>{unit.client || "Bez klienta"}</small></span><Badge>{unit.handover}</Badge></button>) : <p>Termíny předání zatím nejsou naplánované.</p>}</section>
      </aside>
    </div>
  );
}

function ProjectUnitList(props: UnitListProps) {
  const { project, unitView, setUnitView, filteredUnits, previewUnit, openUnit, buildingFilter, floorFilter, statusFilter, layoutFilter, areaFrom, areaTo, priceFrom, priceTo,unitQuery,setUnitQuery,clientQuery,setClientQuery } = props;
  const projectUnits = units.filter((unit) => unitBelongsToProject(unit,project));
  const buildings = Array.from(new Set(projectUnits.map((unit) => unit.building)));
  const floors = Array.from(new Set(projectUnits.map((unit) => unit.floor)));
  const visibleUnits = filteredUnits.filter((unit) => unit.id.toLowerCase().includes(unitQuery.toLowerCase()) && (unit.client || "").toLowerCase().includes(clientQuery.toLowerCase()));
  const activeCount = [unitQuery, buildingFilter.length, floorFilter.length, statusFilter.length, layoutFilter.length, areaFrom, areaTo, priceFrom, priceTo, clientQuery].filter(Boolean).length;
  const reset = props.resetFilters;
  return (
    <section className="card units-section">
      <div className="project-scope-banner"><Building2 size={17} /><span><strong>{project.name}</strong><small>Zobrazeny jsou pouze jednotky tohoto projektu.</small></span><span className="compact-result-count"><strong>{visibleUnits.length}</strong> jednotek {activeCount>0&&<Badge tone="blue">{activeCount} filtrů</Badge>}{activeCount>0&&<button className="text-button" onClick={reset}>Vymazat</button>}<span className="view-toggle"><button className={unitView === "table" ? "active" : ""} onClick={() => setUnitView("table")} aria-label="Tabulkové zobrazení" title="Seznam"><List size={17} /></button><button className={unitView === "cards" ? "active" : ""} onClick={() => setUnitView("cards")} aria-label="Kartové zobrazení" title="Karty"><LayoutGrid size={17} /></button></span></span></div>
      {unitView === "table" ? <div className="unit-table-wrap"><table className="data-table unit-table filter-table"><thead><tr><TableColumnFilter label="Jednotka" active={Boolean(unitQuery)}><input value={unitQuery} onChange={(event) => setUnitQuery(event.target.value)} placeholder="A203…" aria-label="Filtrovat jednotky" /></TableColumnFilter><TableColumnFilter label="Budova / etapa" active={buildingFilter.length > 0}><MultiSelectFilter options={buildings} selected={buildingFilter} onChange={props.setBuildingFilter} allLabel="Všechny budovy / etapy" ariaLabel="Filtrovat budovu nebo etapu" /></TableColumnFilter><TableColumnFilter label="Podlaží" active={floorFilter.length > 0}><MultiSelectFilter options={floors} selected={floorFilter} onChange={props.setFloorFilter} allLabel="Všechna podlaží" ariaLabel="Filtrovat podlaží" /></TableColumnFilter><TableColumnFilter label="Dispozice" active={layoutFilter.length > 0}><MultiSelectFilter options={["1+kk", "2+kk", "3+kk", "4+kk", "5+kk"]} selected={layoutFilter} onChange={props.setLayoutFilter} allLabel="Všechny dispozice" ariaLabel="Filtrovat dispozici" /></TableColumnFilter><TableColumnFilter label="Plocha m²" active={Boolean(areaFrom || areaTo)}><span className="column-range"><input inputMode="decimal" value={areaFrom} onChange={(event) => props.setAreaFrom(event.target.value)} placeholder="Od" aria-label="Plocha od" /><i>–</i><input inputMode="decimal" value={areaTo} onChange={(event) => props.setAreaTo(event.target.value)} placeholder="Do" aria-label="Plocha do" /></span></TableColumnFilter><TableColumnFilter label="Aktuální cena" active={Boolean(priceFrom || priceTo)}><span className="column-range"><input inputMode="decimal" value={priceFrom} onChange={(event) => props.setPriceFrom(event.target.value)} placeholder="Od mil." aria-label="Cena od" /><i>–</i><input inputMode="decimal" value={priceTo} onChange={(event) => props.setPriceTo(event.target.value)} placeholder="Do mil." aria-label="Cena do" /></span></TableColumnFilter><TableColumnFilter label="Obchodní stav" active={statusFilter.length > 0}><MultiSelectFilter options={["Volný", "Předrezervace", "RS", "SBK", "KS", "Předáno"]} selected={statusFilter} onChange={props.setStatusFilter} allLabel="Všechny stavy" ariaLabel="Filtrovat obchodní stav" /></TableColumnFilter><TableColumnFilter label="Klient" active={Boolean(clientQuery)}><input value={clientQuery} onChange={(event) => setClientQuery(event.target.value)} placeholder="Jméno…" aria-label="Filtrovat klienta" /></TableColumnFilter><th /></tr></thead><tbody>{visibleUnits.map((unit) => <tr key={unit.id} onClick={() => openUnit(unit)} tabIndex={0} onKeyDown={(event) => event.key === "Enter" && openUnit(unit)}><td><strong>{unit.id}</strong></td><td>{unit.building}</td><td>{unit.floor}</td><td>{unit.layout}</td><td>{unit.area.toLocaleString("cs-CZ")} m²</td><td><strong>{formatMoney(unit.price)}</strong></td><td><Badge>{unit.status}</Badge></td><td>{unit.client || <span className="muted">—</span>}</td><td><ChevronRight size={18} /></td></tr>)}</tbody></table></div> : <div className="unit-card-grid">{visibleUnits.map((unit) => <button className="unit-card" key={unit.id} onClick={() => previewUnit(unit)}><span className="unit-card-top"><strong>{unit.id}</strong><Badge>{unit.status}</Badge></span><span className="unit-card-plan"><span className="plan-room r1" /><span className="plan-room r2" /><span className="plan-room r3" /><Home size={22} /></span><span className="unit-card-info"><strong>{unit.layout} · {unit.area.toLocaleString("cs-CZ")} m²</strong><small>{unit.building} · {unit.floor}</small></span><span className="unit-card-price"><strong>{formatMoney(unit.price)}</strong><ChevronRight size={17} /></span></button>)}</div>}
      {!visibleUnits.length && <div className="empty-filter-state"><Search size={22} /><strong>Žádná jednotka neodpovídá kombinaci filtrů</strong><small>Zkuste upravit filtry přímo v hlavičce tabulky.</small><button className="secondary-button compact" onClick={reset}>Vymazat filtry</button></div>}
      <div className="table-footer compact-pagination"><div><button disabled><ChevronRight className="rotate-180" size={16} /></button><button className="active">1</button><button><ChevronRight size={16} /></button></div></div>
    </section>
  );
}

function ProjectClients({ project, openClient, openUnit, notify }: { project: ProjectRecord; openClient: (name: string) => void; openUnit: (unit: UnitRecord) => void; notify: (message: string) => void }) {
  const rows = clients.filter((client) => client.projectNames.some(name=>projectMatchesName(project,name)));
  return <ProjectModuleFrame project={project} title="Klienti projektu" description="Klienti a zájemci filtrovaní pouze pro tento projekt." action="Přidat klienta" onAction={() => notify("Formulář nového klienta je připraven")}><table className="data-table"><thead><tr><th>Klient</th><th>Typ</th><th>Jednotky v projektu</th><th>Stav vztahu</th><th>Smluvní stav</th><th>Telefon</th><th>E-mail</th><th /></tr></thead><tbody>{rows.map((client) => { const projectUnits = client.units.filter((code) => units.some((unit) => unit.id === code && unitBelongsToProject(unit,project))); return <tr key={client.id} onClick={() => openClient(client.name)}><td><span className="client-name-cell"><Avatar initials={client.initials} small /><strong>{client.name}</strong></span></td><td><Badge tone="neutral">{client.kind}</Badge></td><td>{projectUnits.map((code) => <button className="unit-link" key={code} onClick={(event) => { event.stopPropagation(); const unit = units.find((item) => item.id === code); if (unit) openUnit(unit); }}>{code}</button>)}</td><td><Badge>{client.state}</Badge></td><td>{client.contractStatus}</td><td>{client.phone}</td><td>{client.email}</td><td><ChevronRight size={17} /></td></tr>; })}</tbody></table></ProjectModuleFrame>;
}

function ProjectContracts({ project, openUnit,openContract, notify }: { project: ProjectRecord; openUnit: (unit: UnitRecord) => void;openContract:(contract:(typeof contracts)[number])=>void; notify: (message: string) => void }) {
  const rows = contracts.filter((contract) => projectMatchesName(project,contract.project));
  return <ProjectModuleFrame project={project} title="Smlouvy projektu" description="Rezervační, budoucí kupní a kupní smlouvy v projektu." action="Nová smlouva" onAction={() => notify("Formulář nové smlouvy je připraven")}><table className="data-table"><thead><tr><th>Jednotka</th><th>Klient</th><th>Typ smlouvy</th><th>Stav</th><th>Aktualizováno</th><th>Odpovědná osoba</th><th>Další krok</th><th /></tr></thead><tbody>{rows.map((contract) => <tr key={`${contract.unit}-${contract.type}`} onClick={() => openContract(contract)}><td><button className="unit-link" onClick={event=>{event.stopPropagation();const unit=units.find(item=>item.id===contract.unit);if(unit)openUnit(unit);}}>{contract.unit}</button></td><td>{contract.client}</td><td><Badge tone="blue">{contract.type}</Badge></td><td><Badge>{contract.state}</Badge></td><td>{contract.updated}</td><td>{contract.owner}</td><td>{contract.action}</td><td><ChevronRight size={17} /></td></tr>)}</tbody></table></ProjectModuleFrame>;
}

function ProjectPayments({ project, openUnit }: { project: ProjectRecord; openUnit: (unit: UnitRecord) => void }) {
  const rows = payments.filter((payment) => projectMatchesName(project,payment.project));
  const total = rows.reduce((sum, payment) => sum + payment.amount, 0);
  const paid = rows.reduce((sum, payment) => sum + payment.paid, 0);
  return <div className="project-module-stack"><div className="metric-row payments-metrics"><div className="metric-card"><span className="metric-icon green"><Banknote size={20} /></span><span><small>Uhrazeno</small><strong>{formatMoney(paid)}</strong><em>evidované platby projektu</em></span></div><div className="metric-card"><span className="metric-icon blue"><CircleDollarSign size={20} /></span><span><small>Předepsáno</small><strong>{formatMoney(total)}</strong><em>v aktuálním přehledu</em></span></div><div className="metric-card danger-metric"><span className="metric-icon red"><AlertTriangle size={20} /></span><span><small>Po splatnosti</small><strong>{rows.filter((payment) => payment.state === "Po splatnosti").length}</strong><em>vyžaduje pozornost</em></span></div></div><ProjectModuleFrame project={project} title="Platby projektu" description="Splátkový kalendář a skutečné úhrady jednotek."><table className="data-table"><thead><tr><th>Jednotka</th><th>Klient</th><th>Splátka</th><th>Splatnost</th><th>Předpis</th><th>Uhrazeno</th><th>Stav</th><th /></tr></thead><tbody>{rows.map((payment) => <tr key={`${payment.unit}-${payment.installment}`} onClick={() => { const unit = units.find((item) => item.id === payment.unit); if (unit) openUnit(unit); }}><td><strong>{payment.unit}</strong></td><td>{payment.client}</td><td>{payment.installment}</td><td>{payment.due}</td><td><strong>{formatMoney(payment.amount)}</strong></td><td>{formatMoney(payment.paid)}</td><td><Badge>{payment.state}</Badge></td><td><ChevronRight size={17} /></td></tr>)}</tbody></table></ProjectModuleFrame></div>;
}

function ProjectClientChanges({ project, openUnit, notify }: { project: ProjectRecord; openUnit: (unit: UnitRecord) => void; notify: (message: string) => void }) {
  const projectUnits = units.filter((unit) => unitBelongsToProject(unit,project) && unit.client).slice(0, 4);
  const states = ["Ke schválení", "Schváleno", "V realizaci", "Uzavřeno"];
  return <ProjectModuleFrame project={project} title="Klientské změny" description="Požadavky klientů na standardy a provedení jednotek." action="Nový požadavek" onAction={() => notify("Formulář klientské změny je připraven")}><table className="data-table"><thead><tr><th>Jednotka</th><th>Klient</th><th>Požadavek</th><th>Termín rozhodnutí</th><th>Dopad do ceny</th><th>Stav</th><th /></tr></thead><tbody>{projectUnits.map((unit, index) => <tr key={unit.id} onClick={() => openUnit(unit)}><td><strong>{unit.id}</strong></td><td>{unit.client}</td><td>{["Změna podlahy v obytných místnostech", "Doplnění elektro vývodů", "Úprava dispozice koupelny", "Příprava pro venkovní žaluzie"][index]}</td><td>{24 + index}. 7. 2026</td><td>{index === 1 ? "18 500 Kč" : index === 3 ? "42 000 Kč" : "K nacenění"}</td><td><Badge>{states[index]}</Badge></td><td><ChevronRight size={17} /></td></tr>)}</tbody></table></ProjectModuleFrame>;
}

function ProjectHandovers({ project, openUnit, notify }: { project: ProjectRecord; openUnit: (unit: UnitRecord) => void; notify: (message: string) => void }) {
  const rows = units.filter((unit) => unitBelongsToProject(unit,project) && unit.handover !== "Neplánováno");
  return <ProjectModuleFrame project={project} title="Předání projektu" description="Termíny a připravenost jednotek k předání." action="Naplánovat předání" onAction={() => notify("Kalendář předání je připraven")}><table className="data-table"><thead><tr><th>Jednotka</th><th>Klient</th><th>Budova</th><th>Stavební stav</th><th>Termín / stav předání</th><th>Připravenost</th><th /></tr></thead><tbody>{rows.map((unit, index) => <tr key={unit.id} onClick={() => openUnit(unit)}><td><strong>{unit.id}</strong></td><td>{unit.client || "—"}</td><td>{unit.building}</td><td><Badge tone="blue">{unit.construction}</Badge></td><td>{unit.handover}</td><td><span className="readiness"><span><strong>{index === 0 ? 72 : 88} %</strong></span><div><i style={{ width: `${index === 0 ? 72 : 88}%` }} /></div></span></td><td><ChevronRight size={17} /></td></tr>)}</tbody></table></ProjectModuleFrame>;
}

function ProjectDocuments({ project, notify }: { project: ProjectRecord; notify: (message: string) => void }) {
  const [documents,setDocuments]=useState<DocumentRecord[]>([]);const [connection,setConnection]=useState<DocumentConnectionState>(previewConnection);const [loading,setLoading]=useState(true);
  const [category,setCategory]=useState("");const [unitId,setUnitId]=useState("");const [partyId,setPartyId]=useState("");
  const projectUnits=units.filter(unit=>unitBelongsToProject(unit,project));const projectClients=clients.filter(client=>client.projectNames.some(name=>projectMatchesName(project,name)));
  useEffect(()=>{const controller=new AbortController();documentRepository.listProject(project.backendId??project.code,{category:category||undefined,unitId:unitId||undefined,partyId:partyId||undefined},controller.signal).then(result=>{setDocuments(result.documents);setConnection(result.connection);}).catch(()=>{setDocuments([]);setConnection(previewConnection);}).finally(()=>setLoading(false));return()=>controller.abort();},[project.backendId,project.code,category,unitId,partyId]);
  return <ProjectModuleFrame project={project} title="Dokumenty projektu" description="Projektové dokumenty a dokumenty souvisejících jednotek, klientů a smluv."><DocumentConnectionBanner connection={connection}/><div className="module-toolbar document-toolbar"><div className="inline-search"><Search size={17}/><span>{loading?"Načítám dokumenty…":`${documents.length} dokumentů`}</span></div><label><span>Kategorie</span><select value={category} onChange={event=>{setLoading(true);setCategory(event.target.value);}}><option value="">Všechny kategorie</option>{documentCategoryOptions.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label><span>Jednotka</span><select value={unitId} onChange={event=>{setLoading(true);setUnitId(event.target.value);}}><option value="">Všechny jednotky</option>{projectUnits.map(unit=><option key={unit.id} value={unit.backendId??unit.id}>{unit.id}</option>)}</select></label><label><span>Klient</span><select value={partyId} onChange={event=>{setLoading(true);setPartyId(event.target.value);}}><option value="">Všichni klienti</option>{projectClients.map(client=><option key={client.id} value={client.id}>{client.name}</option>)}</select></label></div><DocumentList documents={documents} loading={loading} notify={notify}/></ProjectModuleFrame>;
}

function ProjectModuleFrame({ project, title, description, action, onAction, children }: { project: ProjectRecord; title: string; description: string; action?: string; onAction?: () => void; children: React.ReactNode }) {
  return <section className="card detail-tab-card project-module-card"><div className="project-scope-banner"><Building2 size={17} /><span><strong>{project.name}</strong><small>Pracujete uvnitř konkrétního projektu.</small></span></div><div className="tab-card-header"><div><h2>{title}</h2><p>{description}</p></div>{action && <button className="primary-button" onClick={onAction}><Plus size={16} /> {action}</button>}</div><div className="unit-table-wrap">{children}</div></section>;
}

function ClientsPage({ openUnit,openProject, selectedClientName, setSelectedClientName, notify, onEditClient }: { openUnit: (unit: UnitRecord) => void;openProject:(project:ProjectRecord)=>void; selectedClientName: string | null; setSelectedClientName: (name: string | null) => void; notify: (message: string) => void; onEditClient?: (client: (typeof clients)[number]) => void }) {
  const clientRouter=useRouter();const clientPathname=usePathname();const clientParams=useSearchParams();
  const [query, setQuery] = useState(clientParams.get("cq")??"");
  const [quickProject, setQuickProject] = useState(clientParams.get("cp")??"Všichni");
  const [typeFilter, setTypeFilter] = useState<string[]>(listParam(clientParams,"ct"));
  const [projectFilter, setProjectFilter] = useState<string[]>(listParam(clientParams,"cproj"));
  const [unitFilter, setUnitFilter] = useState(clientParams.get("cu")??"");
  const [relationFilter, setRelationFilter] = useState<string[]>(listParam(clientParams,"cr"));
  const [contractFilter, setContractFilter] = useState<string[]>(listParam(clientParams,"cc"));
  const [phoneFilter, setPhoneFilter] = useState(clientParams.get("cph")??"");
  const [emailFilter, setEmailFilter] = useState(clientParams.get("cem")??"");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(()=>{
    // URL parametry jsou sdílitelný stav seznamu a při Back/Forward se musí znovu propsat do ovládacích prvků.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuery(clientParams.get("cq")??"");setQuickProject(clientParams.get("cp")??"Všichni");setTypeFilter(listParam(clientParams,"ct"));setProjectFilter(listParam(clientParams,"cproj"));setUnitFilter(clientParams.get("cu")??"");setRelationFilter(listParam(clientParams,"cr"));setContractFilter(listParam(clientParams,"cc"));setPhoneFilter(clientParams.get("cph")??"");setEmailFilter(clientParams.get("cem")??"");
  },[clientParams]);
  const writeClientFilter=(key:string,value:string|string[])=>clientRouter.replace(updateSearch(clientPathname,clientParams.toString(),{[key]:value}),{scroll:false});
  const writeClientText=(key:string,value:string,setter:React.Dispatch<React.SetStateAction<string>>)=>{setter(value);writeClientFilter(key,value);};
  const writeClientList=(key:string,value:string[],setter:React.Dispatch<React.SetStateAction<string[]>>)=>{setter(value);writeClientFilter(key,value);};
  const selectedClient = selectedClientName ? clients.find((client) => client.name === selectedClientName) : undefined;
  const filtered = useMemo(() => clients.filter((client) => {
    const searchMatch = client.name.toLowerCase().includes(query.toLowerCase());
    const quickProjectRecord=projects.find(project=>project.name===quickProject);
    const quickMatch = quickProject === "Všichni" || client.projectNames.some(name=>quickProjectRecord?projectMatchesName(quickProjectRecord,name):name===quickProject);
    const typeMatch = typeFilter.length === 0 || typeFilter.includes(client.kind);
    const projectMatch = projectFilter.length === 0 || projectFilter.some((name) => {const project=projects.find(item=>item.name===name);return client.projectNames.some(clientProject=>project?projectMatchesName(project,clientProject):clientProject===name);});
    const unitMatch = client.units.join(" ").toLowerCase().includes(unitFilter.toLowerCase());
    const relationMatch = relationFilter.length === 0 || relationFilter.includes(client.state);
    const contractMatch = contractFilter.length === 0 || contractFilter.includes(client.contractStatus);
    const phoneMatch = client.phone.toLowerCase().includes(phoneFilter.toLowerCase());
    const emailMatch = client.email.toLowerCase().includes(emailFilter.toLowerCase());
    return searchMatch && quickMatch && typeMatch && projectMatch && unitMatch && relationMatch && contractMatch && phoneMatch && emailMatch;
  }), [query, quickProject, typeFilter, projectFilter, unitFilter, relationFilter, contractFilter, phoneFilter, emailFilter]);
  const pageRows = filtered.slice(0, 7);
  const allPageSelected = pageRows.length > 0 && pageRows.every((client) => selected.has(client.id));
  const selectedRows = clients.filter((client) => selected.has(client.id));
  const toggle = (id: string) => setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const togglePage = () => setSelected((current) => { const next = new Set(current); pageRows.forEach((client) => allPageSelected ? next.delete(client.id) : next.add(client.id)); return next; });
  const selectAllResults = () => setSelected(new Set(filtered.map((client) => client.id)));
  const copyEmails = async () => { try { const result=await clientRepository.exportContacts(selectedRows.map((client)=>client.id),"bcc"); await navigator.clipboard.writeText(result.value); notify(`${result.count} e-mailů bylo zkopírováno pro BCC`); } catch { notify("Export není v tomto rozsahu povolen"); } };
  const downloadCsv = async (onlyEmails = false) => {
    try {
      const result=await clientRepository.exportContacts(selectedRows.map((client)=>client.id),onlyEmails?"bcc":"csv");
      const csv=onlyEmails?`\ufeffE-mail\n${result.value.split("; ").map((email)=>`"${email}"`).join("\n")}`:result.value;
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); const link = document.createElement("a"); link.href = url; link.download = onlyEmails ? "develocrm-emaily.csv" : "develocrm-klienti.csv"; link.click(); URL.revokeObjectURL(url); notify("Export byl stažen");
    } catch { notify("Export není v tomto rozsahu povolen"); }
  };
  if (selectedClient) return <ClientDetail client={selectedClient} onBack={() => setSelectedClientName(null)} openUnit={openUnit} openProject={openProject} onEdit={onEditClient?() => onEditClient(selectedClient):undefined} />;
  return (
    <section className="card module-card">
      <div className="client-quick-views"><div className="client-view-title"><span><Building2 size={17} /></span><span><small>RYCHLÝ POHLED</small><strong>Klienti podle projektu</strong></span></div><div className="client-view-options" role="tablist" aria-label="Klienti podle projektu"><button role="tab" aria-selected={quickProject==="Všichni"} className={quickProject === "Všichni" ? "active" : ""} onClick={() => writeClientText("cp","Všichni",setQuickProject)}>Všichni <span>{clients.length}</span></button>{projects.map((project) => <button role="tab" aria-selected={quickProject===project.name} key={project.name} className={quickProject === project.name ? "active" : ""} onClick={() => writeClientText("cp",project.name,setQuickProject)}>{project.name}</button>)}</div></div>
      {selected.size > 0 && <div className="bulk-action-bar"><span><CheckCircle2 size={18} /><strong>Vybráno {selected.size} klientů</strong></span><div><button onClick={copyEmails}><Mail size={15} /> Kopírovat e-maily pro BCC</button><button onClick={() => downloadCsv(false)}><Download size={15} /> Excel / CSV</button><button onClick={() => downloadCsv(true)}><FileText size={15} /> Pouze e-maily</button><button className="ghost-icon" onClick={() => setSelected(new Set())} aria-label="Zrušit výběr"><X size={17} /></button></div></div>}
      {allPageSelected && filtered.length > pageRows.length && selected.size < filtered.length && <div className="select-all-results"><Check size={15} /> Vybráno všech {pageRows.length} klientů na této stránce. <button onClick={selectAllResults}>Vybrat všech {filtered.length} výsledků aktuálního filtru</button></div>}
      <div className="unit-table-wrap"><table className="data-table client-table filter-table"><thead><tr><th className="checkbox-cell"><button className={`table-checkbox ${allPageSelected ? "checked" : ""}`} onClick={togglePage} aria-label="Vybrat klienty na stránce">{allPageSelected && <Check size={13} />}</button></th><TableColumnFilter label="Jméno / název" active={Boolean(query)}><input value={query} onChange={(event) => writeClientText("cq",event.target.value,setQuery)} placeholder="Hledat jméno…" aria-label="Filtrovat jméno nebo název" /></TableColumnFilter><TableColumnFilter label="Typ" active={typeFilter.length > 0}><MultiSelectFilter options={["FO", "PO"]} selected={typeFilter} onChange={value=>writeClientList("ct",value,setTypeFilter)} allLabel="Všechny typy" ariaLabel="Filtrovat typ klienta" /></TableColumnFilter><TableColumnFilter label="Projekt" active={projectFilter.length > 0}><MultiSelectFilter options={projects.map((project) => project.name)} selected={projectFilter} onChange={value=>writeClientList("cproj",value,setProjectFilter)} allLabel="Všechny projekty" ariaLabel="Filtrovat projekt" /></TableColumnFilter><TableColumnFilter label="Jednotka / jednotky" active={Boolean(unitFilter)}><input value={unitFilter} onChange={(event) => writeClientText("cu",event.target.value,setUnitFilter)} placeholder="A203…" aria-label="Filtrovat jednotku" /></TableColumnFilter><TableColumnFilter label="Stav vztahu" active={relationFilter.length > 0}><MultiSelectFilter options={["Zájemce", "Aktivní klient", "Předání", "Předáno"]} selected={relationFilter} onChange={value=>writeClientList("cr",value,setRelationFilter)} allLabel="Všechny vztahy" ariaLabel="Filtrovat stav vztahu" /></TableColumnFilter><TableColumnFilter label="Smluvní stav" active={contractFilter.length > 0}><MultiSelectFilter options={["Podepsaná KS", "Podepsaná SBK", "RS k podpisu", "Předrezervace", "Bez smlouvy"]} selected={contractFilter} onChange={value=>writeClientList("cc",value,setContractFilter)} allLabel="Všechny smluvní stavy" ariaLabel="Filtrovat smluvní stav" /></TableColumnFilter><TableColumnFilter label="Telefon" active={Boolean(phoneFilter)}><input value={phoneFilter} onChange={(event) => writeClientText("cph",event.target.value,setPhoneFilter)} placeholder="Telefon…" aria-label="Filtrovat telefon" /></TableColumnFilter><TableColumnFilter label="E-mail" active={Boolean(emailFilter)}><input value={emailFilter} onChange={(event) => writeClientText("cem",event.target.value,setEmailFilter)} placeholder="E-mail…" aria-label="Filtrovat e-mail" /></TableColumnFilter><th /></tr></thead><tbody>{pageRows.map((client) => <tr key={client.id} onClick={() => setSelectedClientName(client.name)}><td className="checkbox-cell"><button className={`table-checkbox ${selected.has(client.id) ? "checked" : ""}`} onClick={(event) => { event.stopPropagation(); toggle(client.id); }} aria-label={`Vybrat ${client.name}`}>{selected.has(client.id) && <Check size={13} />}</button></td><td><span className="client-name-cell"><Avatar initials={client.initials} small /><span><strong>{client.name}</strong></span></span></td><td><Badge tone="neutral">{client.kind}</Badge></td><td><ClientRelationColumn client={client} mode="project" openUnit={openUnit}/></td><td><ClientRelationColumn client={client} mode="unit" openUnit={openUnit}/></td><td><Badge>{client.state}</Badge></td><td>{client.contractStatus}</td><td>{client.phone}</td><td><a href={`mailto:${client.email}`} onClick={(event) => event.stopPropagation()}>{client.email}</a></td><td><ChevronRight size={17} /></td></tr>)}</tbody></table></div>
      {!filtered.length && <div className="empty-filter-state"><Search size={22} /><strong>Žádný klient neodpovídá filtrům</strong><small>Změňte projekt, stav vztahu nebo hledaný výraz.</small></div>}
      <div className="table-footer"><span>Zobrazeno {pageRows.length} z {filtered.length} výsledků · jedna společná databáze napříč firmou</span><div><button disabled><ChevronRight className="rotate-180" size={16} /></button><button className="active">1</button><button><ChevronRight size={16} /></button></div></div>
    </section>
  );
}

function ClientRelationColumn({client,mode,openUnit}:{client:(typeof clients)[number];mode:"project"|"unit";openUnit:(unit:UnitRecord)=>void}){const relations=client.projectNames.map(project=>({project,codes:client.units.filter(code=>units.find(unit=>unit.id===code)?.project===project)})).filter(row=>row.codes.length||client.projectNames.includes(row.project));return <span className="client-relation-map">{relations.map(row=><span key={row.project}>{mode==="project"?<small>{row.project}</small>:row.codes.length?row.codes.map(code=><button className="unit-link" key={code} onClick={event=>{event.stopPropagation();const unit=units.find(item=>item.id===code);if(unit)openUnit(unit);}}>{code}</button>):<small>bez konkrétní jednotky</small>}</span>)}</span>}

function ClientDetail({ client, onBack, openUnit,openProject, onEdit }: { client: (typeof clients)[number]; onBack: () => void; openUnit: (unit: UnitRecord) => void;openProject:(project:ProjectRecord)=>void; onEdit?: () => void }) {
  const history=client.interestHistory?.length?client.interestHistory:[{date:"—",project:client.projectNames[0]??"—",unit:client.units[0]??"—",type:"Bez evidované události",result:client.state}];
  return <div className="client-detail"><div className="unit-breadcrumb"><button onClick={onBack}><ArrowLeft size={16} /> Klienti a zájemci</button><ChevronRight size={14} /><strong>{client.name}</strong></div><div className="client-detail-hero card"><Avatar initials={client.initials} /><div><span className="eyebrow">{client.type.toUpperCase()}</span><h1>{client.name} <Badge>{client.state}</Badge></h1><p><Mail size={14} /> {client.email} <span>·</span> <UserRound size={14} /> {client.phone}</p></div><div className="project-detail-actions">{onEdit&&<button className="secondary-button" onClick={onEdit}><MoreHorizontal size={16} /> Upravit klienta</button>}<button className="primary-button"><MessageSquare size={16} /> Přidat aktivitu</button></div></div><div className="client-detail-grid"><section className="card client-relations"><SectionTitle title="Projekty a jednotky" /><p className="section-description">Všechny vztahy klienta napříč společnou firemní databází.</p><div className="client-project-links">{client.projectNames.map(name=>{const project=projects.find(item=>projectMatchesName(item,name));return project?<button className="unit-link" key={name} onClick={()=>openProject(project)}><Building2 size={14}/>{project.name}</button>:null;})}</div>{client.units.map((unitCode, index) => { const unit = units.find((item) => item.id === unitCode) || units[0]; return <button key={unitCode} onClick={() => openUnit(unit)}><span className="unit-symbol"><Home size={18} /></span><span><strong>{unit.id} · {unit.layout}</strong><small>{unit.project} · {unit.building}</small></span><Badge>{index === 0 ? client.state : "Zájemce"}</Badge><ChevronRight size={17} /></button>; })}</section><aside className="card client-contact-panel"><SectionTitle title="Kontaktní údaje" /><dl><div><dt>E-mail</dt><dd>{client.email}</dd></div><div><dt>Telefon</dt><dd>{client.phone}</dd></div><div><dt>Typ osoby</dt><dd>{client.kind}</dd></div><div><dt>Smluvní stav</dt><dd>{client.contractStatus}</dd></div></dl></aside><section className="card client-history"><SectionTitle title="Historie zájmu" /><div className="unit-table-wrap"><table className="data-table"><thead><tr><th>Datum</th><th>Projekt / jednotka</th><th>Typ zájmu</th><th>Výsledek</th></tr></thead><tbody>{history.map((row,index)=><tr key={`${row.unit}-${row.date}-${index}`}><td>{row.date}</td><td><strong>{row.project} · {row.unit}</strong></td><td>{row.type}</td><td><Badge tone={row.result.includes("Pokračuje")||row.result.includes("Aktivní")?"success":"neutral"}>{row.result}</Badge></td></tr>)}</tbody></table></div></section></div></div>;
}

function ContractsPage({ openUnit,openClient,openContract,selectedContractId, notify,onWorkflow }: { openUnit: (unit: UnitRecord) => void;openClient:(identity:string)=>void;openContract:(contract:(typeof contracts)[number])=>void;selectedContractId:string|null; notify: (message: string) => void;onWorkflow?: (contract:(typeof contracts)[number])=>void }) {
  const stages = ["V přípravě", "Odeslána", "Ve vyjednávání", "Podepsána"];
  return (
    <div className="module-stack">
      <div className="metric-row">
        <div className="metric-card"><span className="metric-icon blue"><FileText size={20} /></span><span><small>V přípravě</small><strong>{contracts.filter(item=>item.state==="V přípravě").length}</strong><em>pracovní smlouvy</em></span></div>
        <div className="metric-card"><span className="metric-icon sand"><Mail size={20} /></span><span><small>Odeslané</small><strong>{contracts.filter(item=>item.state==="Odeslána").length}</strong><em>čekají na reakci</em></span></div>
        <div className="metric-card"><span className="metric-icon purple"><MessageSquare size={20} /></span><span><small>Ve vyjednávání</small><strong>{contracts.filter(item=>item.state==="Ve vyjednávání").length}</strong><em>aktivní připomínky</em></span></div>
        <div className="metric-card"><span className="metric-icon green"><FileCheck2 size={20} /></span><span><small>Podepsané</small><strong>{contracts.filter(item=>item.state==="Podepsána").length}</strong><em>v evidenci CRM</em></span></div>
      </div>
      <section className="card module-card">
        <div className="module-toolbar"><div className="inline-search"><Search size={17} /><input placeholder="Hledat smlouvu, klienta…" /></div><button className="filter-button"><Filter size={16} /> Stav</button><button className="filter-button"><Building2 size={16} /> Projekt</button><span className="result-count">{contracts.length} smluv</span></div>
        <div className="contract-list">
          {contracts.map((contract) => {
            const activeIndex = Math.max(0, stages.indexOf(contract.state));
            return (
              <article key={`${contract.unit}-${contract.type}`} className={selectedContractId&&(contract.id===selectedContractId||contract.reference===selectedContractId)?"selected":""}>
                <button className="contract-main" aria-current={selectedContractId&&(contract.id===selectedContractId||contract.reference===selectedContractId)?"page":undefined} onClick={() => openContract(contract)}>
                  <span className="contract-type">{contract.type}</span><span className="contract-copy"><strong>{contract.unit} · {contract.client}</strong><small>{contract.project} · změněno {contract.updated}</small></span><Badge>{contract.state}</Badge><span className="contract-action"><small>DOPORUČENÁ AKCE</small><strong>{contract.action}</strong></span><ChevronRight size={18} />
                </button>
                <div className="contract-flow">{stages.map((stage, index) => <span key={stage} className={index <= activeIndex ? "complete" : ""}><i>{index < activeIndex ? <Check size={11} /> : index + 1}</i>{stage}</span>)}<button className="text-button" onClick={()=>openClient(contract.client)}>Otevřít klienta</button><button className="text-button" onClick={()=>openUnit(units.find(unit=>unit.id===contract.unit)??units[0])}>Otevřít jednotku</button>{onWorkflow&&contract.id&&<button className="secondary-button compact contract-workflow-button" onClick={()=>onWorkflow(contract)}>Změnit stav</button>}</div>
              </article>
            );
          })}
        </div>
        <div className="table-footer"><span>Zobrazeno {contracts.length} z {contracts.length} smluv</span><button className="text-button" onClick={() => notify("Všechny smlouvy jsou načteny")}>Aktualizovat <ChevronDown size={15} /></button></div>
      </section>
    </div>
  );
}

function PaymentsPage({ openUnit, notify }: { openUnit: (unit: UnitRecord) => void; notify: (message: string) => void }) {
  const [paymentQuery, setPaymentQuery] = useState("");
  const [installmentFilter, setInstallmentFilter] = useState<string[]>([]);
  const [dueFilter, setDueFilter] = useState<string[]>([]);
  const [amountFrom, setAmountFrom] = useState("");
  const [coverageFilter, setCoverageFilter] = useState<string[]>([]);
  const [paymentStateFilter, setPaymentStateFilter] = useState<string[]>([]);
  const installmentOptions = Array.from(new Set(payments.map((payment) => payment.installment)));
  const dueOptions = Array.from(new Set(payments.map((payment) => payment.due)));
  const paymentStates = Array.from(new Set(payments.map((payment) => payment.state)));
  const filteredPayments = payments.filter((payment) => {
    const queryMatch = `${payment.unit} ${payment.client} ${payment.project}`.toLowerCase().includes(paymentQuery.toLowerCase());
    const installmentMatch = installmentFilter.length === 0 || installmentFilter.includes(payment.installment);
    const dueMatch = dueFilter.length === 0 || dueFilter.includes(payment.due);
    const amountMatch = !amountFrom || payment.amount >= Number(amountFrom.replace(",", ".")) * 1000000;
    const coverage = payment.paid === payment.amount ? "Uhrazeno" : payment.paid > 0 ? "Částečně uhrazeno" : "Neuhrazeno";
    const coverageMatch = coverageFilter.length === 0 || coverageFilter.includes(coverage);
    const stateMatch = paymentStateFilter.length === 0 || paymentStateFilter.includes(payment.state);
    return queryMatch && installmentMatch && dueMatch && amountMatch && coverageMatch && stateMatch;
  });
  return (
    <div className="module-stack">
      <div className="metric-row payments-metrics">
        <div className="metric-card wide"><span className="metric-icon green"><Banknote size={20} /></span><span><small>Uhrazeno tento měsíc</small><strong>28,4 mil. Kč</strong><em>18 spárovaných plateb</em></span></div>
        <div className="metric-card wide"><span className="metric-icon sand"><Clock3 size={20} /></span><span><small>Splatné do 14 dní</small><strong>16,2 mil. Kč</strong><em>9 očekávaných plateb</em></span></div>
        <div className="metric-card wide danger-metric"><span className="metric-icon red"><AlertTriangle size={20} /></span><span><small>Po splatnosti</small><strong>1,7 mil. Kč</strong><em>3 jednotky</em></span></div>
      </div>
      <section className="card module-card">
        <div className="table-action-bar"><span><strong>{filteredPayments.length}</strong> plateb odpovídá filtrům</span><button className="secondary-button compact" onClick={() => notify("Bankovní výpis byl načten")}><Upload size={16} /> Import výpisu</button></div>
        <div className="unit-table-wrap"><table className="data-table payment-table filter-table"><thead><tr><TableColumnFilter label="Jednotka / klient" active={Boolean(paymentQuery)}><input value={paymentQuery} onChange={(event) => setPaymentQuery(event.target.value)} placeholder="Jednotka, klient…" aria-label="Filtrovat platbu podle jednotky nebo klienta" /></TableColumnFilter><TableColumnFilter label="Splátka" active={installmentFilter.length > 0}><MultiSelectFilter options={installmentOptions} selected={installmentFilter} onChange={setInstallmentFilter} allLabel="Všechny splátky" ariaLabel="Filtrovat splátku" /></TableColumnFilter><TableColumnFilter label="Splatnost" active={dueFilter.length > 0}><MultiSelectFilter options={dueOptions} selected={dueFilter} onChange={setDueFilter} allLabel="Všechny termíny" ariaLabel="Filtrovat splatnost" /></TableColumnFilter><TableColumnFilter label="Předpis" active={Boolean(amountFrom)}><input inputMode="decimal" value={amountFrom} onChange={(event) => setAmountFrom(event.target.value)} placeholder="Od mil. Kč" aria-label="Filtrovat minimální předpis" /></TableColumnFilter><TableColumnFilter label="Uhrazeno" active={coverageFilter.length > 0}><MultiSelectFilter options={["Uhrazeno", "Částečně uhrazeno", "Neuhrazeno"]} selected={coverageFilter} onChange={setCoverageFilter} allLabel="Všechny úhrady" ariaLabel="Filtrovat úhradu" /></TableColumnFilter><TableColumnFilter label="Stav" active={paymentStateFilter.length > 0}><MultiSelectFilter options={paymentStates} selected={paymentStateFilter} onChange={setPaymentStateFilter} allLabel="Všechny stavy" ariaLabel="Filtrovat stav platby" /></TableColumnFilter><th /></tr></thead><tbody>
          {filteredPayments.map((payment) => {
            const percent = Math.round(payment.paid / payment.amount * 100);
            return <tr key={`${payment.unit}-${payment.installment}`} onClick={() => openUnit(units.find((unit) => unit.id === payment.unit) || units[0])}><td><strong>{payment.unit} · {payment.client}</strong><small>{payment.project}</small></td><td>{payment.installment}</td><td>{payment.due}</td><td><strong>{formatMoney(payment.amount)}</strong></td><td><strong>{formatMoney(payment.paid)}</strong><span className="payment-progress"><i style={{ width: `${percent}%` }} /></span></td><td><Badge>{payment.state}</Badge></td><td><ChevronRight size={18} /></td></tr>;
          })}
        </tbody></table></div>
      </section>
    </div>
  );
}

function HandoversPage({ openUnit, notify }: { openUnit: (unit: UnitRecord) => void; notify: (message: string) => void }) {
  const handovers = [
    { date: "23", day: "ČT", time: "9:00", unit: "C118", client: "Lenka Procházková", readiness: 100, issues: 0 },
    { date: "24", day: "PÁ", time: "13:30", unit: "C206", client: "Ondřej Horák", readiness: 92, issues: 1 },
    { date: "26", day: "NE", time: "10:00", unit: "C102", client: "Marek Veselý", readiness: 76, issues: 1 },
    { date: "28", day: "ÚT", time: "14:00", unit: "C309", client: "Petra Konečná", readiness: 88, issues: 2 },
  ];
  return (
    <div className="handover-layout">
      <section className="card handover-calendar">
        <SectionTitle title="Červenec 2026" action="Dnes" onAction={() => notify("Zobrazen dnešní den")} />
        <div className="week-strip"><button><ChevronRight className="rotate-180" size={17} /></button>{["PO 20", "ÚT 21", "ST 22", "ČT 23", "PÁ 24", "SO 25", "NE 26"].map((day) => <span key={day} className={day === "ÚT 21" ? "today" : day.includes("23") || day.includes("24") || day.includes("26") ? "has-event" : ""}><small>{day.split(" ")[0]}</small><strong>{day.split(" ")[1]}</strong></span>)}<button><ChevronRight size={17} /></button></div>
        <div className="handover-list">
          {handovers.map((handover) => <article key={handover.unit} onClick={() => openUnit(units.find((unit) => unit.id === handover.unit) || units[6])}>
            <div className="handover-date"><strong>{handover.date}</strong><span>{handover.day}</span></div><div className="handover-time"><Clock3 size={15} />{handover.time}</div><div className="handover-copy"><strong>{handover.unit} · {handover.client}</strong><small>Parková čtvrť · Etapa I</small></div><div className="readiness"><span><small>Připravenost</small><strong>{handover.readiness} %</strong></span><div><i style={{ width: `${handover.readiness}%` }} /></div></div>{handover.issues ? <Badge tone="warning">{handover.issues} překážka</Badge> : <Badge tone="success">Připraveno</Badge>}<ChevronRight size={18} />
          </article>)}
        </div>
      </section>
      <aside className="card readiness-card">
        <div className="readiness-ring"><span>76<small>%</small></span></div>
        <h3>C102 · připravenost</h3><p>Předání 26. 7. v 10:00</p>
        <div className="checklist-summary"><span><CheckCircle2 size={17} />Dokumentace<strong>6/6</strong></span><span><CheckCircle2 size={17} />Měřidla a odečty<strong>4/4</strong></span><span><CheckCircle2 size={17} />Klíče a čipy<strong>8/8</strong></span><span className="missing"><AlertTriangle size={17} />Revize wallboxu<strong>Chybí</strong></span></div>
        <button className="primary-button full" onClick={() => openUnit(units[6])}>Dokončit přípravu <ArrowRight size={16} /></button>
      </aside>
    </div>
  );
}

function TasksPage({ rows, toggleTask, openUnit,scope,onScope,loading }: { rows: TaskRecord[]; toggleTask: (id: string|number) => void; openUnit: (unit: UnitRecord) => void;scope:"mine"|"all"|"completed";onScope:(scope:"mine"|"all"|"completed")=>void;loading:boolean }) {
  return (
    <section className="card module-card tasks-module">
      <nav className="task-tabs" aria-label="Pohledy úkolů"><button className={scope==="mine"?"active":""} aria-current={scope==="mine"?"page":undefined} onClick={()=>onScope("mine")}><UserRound className="task-tab-icon" size={17} /> Moje úkoly {scope==="mine"&&<span>{rows.length}</span>}</button><button className={scope==="all"?"active":""} aria-current={scope==="all"?"page":undefined} onClick={()=>onScope("all")}><List className="task-tab-icon" size={17} /> Všechny {scope==="all"&&<span>{rows.length}</span>}</button><button className={scope==="completed"?"active":""} aria-current={scope==="completed"?"page":undefined} onClick={()=>onScope("completed")}><CheckCircle2 className="task-tab-icon" size={17} /> Dokončené {scope==="completed"&&<span>{rows.length}</span>}</button><div /><button className="filter-button task-filter-action"><Filter size={16} /> Filtry</button></nav>
      <div className="task-section-label"><span>Dnes</span><i /></div>
      <div className="large-task-list">
        {loading?<div className="empty-next"><Clock3 size={20}/><span><strong>Načítám úkoly…</strong><small>Aktualizuji zvolený pohled.</small></span></div>:rows.map((task) => <article key={task.id} className={task.done ? "done" : ""}>
          <button onClick={() => toggleTask(task.id)} className="task-check large" aria-label={`Dokončit úkol ${task.title}`}>{task.done && <Check size={15} />}</button>
          <span className={`priority-bar ${task.priority.toLowerCase().replace("á", "a").replace("ř", "r")}`} />
          <button className="task-main-copy" onClick={() => openUnit(units.find((unit) => unit.id === task.object.split(" · ")[0]) || units[0])}><strong>{task.title}</strong><small>{task.object} · {task.project}</small></button>
          <Badge tone={task.priority === "Vysoká" ? "danger" : task.priority === "Střední" ? "warning" : "neutral"}>{task.priority}</Badge>
          <span className={`task-due ${task.due === "Dnes" ? "urgent" : ""}`}><Clock3 size={15} />{task.due}</span>
          <Avatar initials={initials(task.owner)} small />
          <button className="ghost-icon"><MoreHorizontal size={18} /></button>
        </article>)}
      </div>
      <div className="task-section-label muted-label"><span>Následující</span><i /></div>
      <div className="empty-next"><CheckCircle2 size={22} /><span><strong>Máte hotovo</strong><small>Další úkoly se zobrazí podle termínu a priority.</small></span></div>
    </section>
  );
}

function UnitPreview({ unit, close, open, previous, next, position, total }: { unit: UnitRecord; close: () => void; open: () => void; previous: () => void; next: () => void; position: number; total: number }) {
  return (
    <aside className="preview-panel">
      <div className="preview-browser"><span>{position} z {total} jednotek ve výběru</span><div><button onClick={previous} aria-label="Předchozí jednotka"><ChevronRight className="rotate-180" size={17} /></button><button onClick={next} aria-label="Další jednotka"><ChevronRight size={17} /></button><button onClick={close} aria-label="Zavřít náhled"><X size={18} /></button></div></div>
      <div className="preview-header"><div><span className="preview-project">{unit.project} · {unit.building}</span><h2>{unit.id} <Badge>{unit.status}</Badge></h2><p>{unit.layout} · {unit.area.toLocaleString("cs-CZ")} m² · {unit.floor}</p></div></div>
      <div className={`preview-attention ${unit.attention ? "" : "calm"}`}><AlertTriangle size={18} /><span><strong>{unit.attention ? "Nejbližší důležitý krok" : "Doporučený další krok"}</strong><small>{unit.attention || (unit.status === "Volný" ? "Jednotka je připravena k nabídnutí zájemci" : "Pokračovat podle obchodního workflow")}</small></span></div>
      <div className="mini-floorplan"><div className="room living"><span>Obývací pokoj + kk</span></div><div className="room bed"><span>Ložnice</span></div><div className="room bath"><span>Koupelna</span></div><div className="room hall"><span>Chodba</span></div><div className="room bed2"><span>Pokoj</span></div><div className="balcony">Lodžie 8,2 m²</div></div>
      <div className="preview-grid"><span><small>Aktuální cena</small><strong>{formatMoney(unit.price)}</strong></span><span><small>Obchodní stav</small><strong><Badge>{unit.status}</Badge></strong></span><span><small>Stavební stav</small><strong>{unit.construction}</strong></span><span><small>Klient</small><strong>{unit.client || "Bez klienta"}</strong></span></div>
      <div className="preview-section"><h3>Příslušenství</h3><p>{unit.accessory}</p></div>
      <div className="preview-flow"><h3>Prodejní proces</h3><div>{["Zájem", "RS", "SBK", "KS", "Předání"].map((stage, index) => <span className={index <= ["Volný", "Předrezervace", "RS", "SBK", "KS", "Předáno"].indexOf(unit.status) - 1 ? "complete" : ""} key={stage}><i>{index + 1}</i><small>{stage}</small></span>)}</div></div>
      <div className="preview-footer"><button className="secondary-button" onClick={close}>Zavřít</button><button className="primary-button" onClick={open}>Otevřít celý detail <ArrowRight size={17} /></button></div>
    </aside>
  );
}

function UnitDetail({ unit, tab, onTab, onBack,openProjects,openProject, notify, openTask, openClient,openContract, onEdit, onEditPrice,onManageAccessories,onEditFloorplan,onSalesAction,canCancelHold,onContractWorkflow,timelineVersion }: { unit: UnitRecord; tab: UnitTab; onTab: (tab: UnitTab) => void; onBack: () => void;openProjects:()=>void;openProject:()=>void; notify: (message: string) => void; openTask: () => void; openClient: (name: string) => void;openContract:(contract:(typeof contracts)[number])=>void; onEdit?: () => void; onEditPrice?: () => void;onManageAccessories?:()=>void;onEditFloorplan?:()=>void;onSalesAction?:(mode:"interest"|"pre_reservation"|"reservation"|"convert"|"cancel")=>void;canCancelHold?:boolean;onContractWorkflow?:(contract:(typeof contracts)[number])=>void;timelineVersion:number }) {
  const [timeline,setTimeline]=useState<TimelineRecord[]>([]);useEffect(()=>{const controller=new AbortController();activityRepository.unitTimeline(unit.backendId??unit.id,unit.id,controller.signal).then(setTimeline).catch(()=>setTimeline([]));return()=>controller.abort();},[unit.backendId,unit.id,tab,timelineVersion]);
  const tabs: { id: UnitTab; label: string; icon: typeof Home; count?: number }[] = [
    { id: "overview", label: "Přehled", icon: LayoutDashboard }, { id: "contracts", label: "Smlouvy", icon: FileText, count: 4 }, { id: "payments", label: "Platby", icon: CircleDollarSign, count: 3 }, { id: "changes", label: "Klientské změny", icon: SlidersHorizontal, count: 3 }, { id: "documents", label: "Dokumenty", icon: FolderOpen }, { id: "handover", label: "Předání", icon: KeyRound }, { id: "tasks", label: "Úkoly", icon: ClipboardCheck, count: 2 }, { id: "history", label: "Historie", icon: History },
  ];
  return (
    <div className="unit-detail">
      <div className="unit-breadcrumb"><button onClick={openProjects}>Všechny projekty</button><ChevronRight size={14}/><button onClick={openProject}>{unit.project}</button><ChevronRight size={14}/><button onClick={onBack}>Jednotky</button><ChevronRight size={14}/><strong>{unit.id}</strong></div>
      <div className="unit-hero">
        <div className="unit-identity"><span className="unit-symbol"><Home size={23} /></span><div><span>{unit.project} · {unit.building}</span><h1>{unit.id} <Badge>{unit.status}</Badge></h1><p>{unit.layout} · {unit.area.toLocaleString("cs-CZ")} m² · {unit.floor} · orientace {unit.orientation}</p></div></div>
        <div className="unit-hero-actions">{onEdit&&<button className="secondary-button" onClick={onEdit}><MoreHorizontal size={17} /> Upravit jednotku</button>}<button className="secondary-button" onClick={() => notify("Odkaz na jednotku byl zkopírován")}><Link2 size={17} /> Sdílet odkaz</button><button className="primary-button" onClick={() => notify("Kontrola dat: chybí číslo účtu klienta")}><FileText size={17} /> Vygenerovat SBK</button></div>
      </div>
      <div className="unit-status-strip">
        <span><small>OBCHODNÍ STAV</small><strong><Badge>{unit.status}</Badge> Ve vyjednávání</strong></span>
        <span><small>STAV VÝSTAVBY</small><strong><HardHat size={16} /> {unit.construction}</strong></span>
        <span><small>PŘEDÁNÍ</small><strong><KeyRound size={16} /> {unit.handover}</strong></span>
        <span className="attention-status"><small>VYŽADUJE POZORNOST</small><strong><AlertTriangle size={16} /> {unit.attention || "Bez otevřených bodů"}</strong></span>
      </div>
      <nav className="unit-tabs unit-detail-tabs" aria-label="Navigace jednotky">{tabs.map((item) => { const TabIcon = item.icon; return <button key={item.id} className={`${tab === item.id ? "active" : ""} ${item.id === "changes" ? "client-changes-tab" : ""}`.trim()} aria-current={tab === item.id ? "page" : undefined} onClick={() => onTab(item.id)}><TabIcon className="unit-tab-icon" size={17} />{item.label}{item.id === "changes" && <em className="unit-tab-new">NOVÉ</em>}{item.count && <span aria-label={`${item.count} položek`}>{item.count}</span>}</button>; })}</nav>

      {tab === "overview" && <UnitOverview unit={unit} notify={notify} openClient={openClient} onEditPrice={onEditPrice} onManageAccessories={onManageAccessories} onEditFloorplan={onEditFloorplan} onSalesAction={onSalesAction} canCancelHold={canCancelHold} timeline={timeline} />}
      {tab === "contracts" && <UnitContracts unit={unit} notify={notify} openContract={openContract} onWorkflow={onContractWorkflow} />}
      {tab === "payments" && <UnitPayments unit={unit} />}
      {tab === "changes" && <UnitClientChanges unit={unit} notify={notify} />}
      {tab === "documents" && <UnitDocuments unit={unit} notify={notify} />}
      {tab === "handover" && <UnitHandover unit={unit} notify={notify} />}
      {tab === "tasks" && <UnitTasks unit={unit} openTask={openTask} />}
      {tab === "history" && <UnitHistory unit={unit} timeline={timeline} />}
    </div>
  );
}

function UnitOverview({ unit, notify, openClient, onEditPrice,onManageAccessories,onEditFloorplan,onSalesAction,canCancelHold,timeline }: { unit: UnitRecord; notify: (message: string) => void; openClient: (name: string) => void; onEditPrice?: () => void;onManageAccessories?:()=>void;onEditFloorplan?:()=>void;onSalesAction?:(mode:"interest"|"pre_reservation"|"reservation"|"convert"|"cancel")=>void;canCancelHold?:boolean;timeline:TimelineRecord[] }) {
  const [floorplanOpen, setFloorplanOpen] = useState(false);
  const [loadedFloorplanUrl,setLoadedFloorplanUrl]=useState<string|null>(null);const floorplanUrl=unit.floorplanImageUrl??loadedFloorplanUrl;useEffect(()=>{if(floorplanUrl)return;const controller=new AbortController();mediaRepository.get("unit",unit.backendId??unit.id,controller.signal).then(media=>{if(media)setLoadedFloorplanUrl(media.url);}).catch(()=>undefined);return()=>controller.abort();},[unit.backendId,unit.id,floorplanUrl]);
  const [priceHistoryOpen, setPriceHistoryOpen] = useState(false);
  const commercial=unitCommercialContexts[unit.id];
  const buyers=commercial?.buyers ?? [];
  const interestRows=commercial?.interests ?? [];
  const isDejvice=isDejviceUnit(unit);
  const accessoryItems=unit.accessories?.length?unit.accessories.map(item=>`${item.type} ${item.code}${item.areaM2?` (${item.areaM2} m²)`:""}`):unit.accessory.split(" · ").filter(Boolean);
  const stageIndex=({interest:0,pre_reservation:1,reservation:2,rs:2,sbk:3,ks:4,handover:5} as Record<string,number>)[commercial?.stage ?? ""] ?? -1;
  return (
    <>
    <div className="unit-overview-grid">
      <div className="unit-main-column">
        <section className="card sales-process-card">
          <SectionTitle title="Prodejní proces" />
          <div className="sales-progress">{["Zájem", "Předrezervace", "RS", "SBK", "KS", "Předání"].map((stage, index) => <div key={stage} className={index < stageIndex ? "complete" : index === stageIndex ? "current" : ""}><span>{index < stageIndex ? <Check size={14} /> : index + 1}</span><strong>{stage}</strong><small>{index === stageIndex ? (commercial?.hold ? `Platí do ${new Date(commercial.hold.expiresAt).toLocaleDateString("cs-CZ")}` : "Aktuální etapa") : index < stageIndex ? "Hotovo" : "Čeká"}</small></div>)}</div>
          <div className="next-action"><span className="next-action-icon"><Sparkles size={19} /></span><div><small>DOPORUČENÝ DALŠÍ KROK</small><strong>{isDejvice?(unit.attention?"Ověřit vazbu importovanou ze zdroje":commercial?.stage==="rs"?"Ověřit aktuální stav rezervační smlouvy":"Bez nutné obchodní akce"):"Doplňte číslo účtu a vygenerujte novou verzi SBK"}</strong><p>{isDejvice?(unit.attention??"Zdroj neobsahuje další potvrzený krok."):"Kontrola našla 1 chybějící povinný údaj."}</p></div><button className="primary-button" onClick={() => notify(isDejvice?"Otevírám importní kontext":"Otevírám údaje klienta")}>{isDejvice?"Zobrazit kontext":"Doplnit údaj"} <ArrowRight size={16} /></button></div>
          {onSalesAction&&<div className="sales-action-strip"><span><small>OBCHODNÍ AKCE</small><strong>Stav se mění pouze řízenou operací</strong></span><div>{!commercial?.hold&&<><button className="secondary-button compact" onClick={()=>onSalesAction("pre_reservation")}>Předrezervace</button><button className="secondary-button compact" onClick={()=>onSalesAction("reservation")}>Rezervace</button></>}{commercial?.hold?.type==="pre_reservation"&&<button className="primary-button compact" onClick={()=>onSalesAction("convert")}>Převést na rezervaci</button>}{commercial?.hold&&canCancelHold&&<button className="secondary-button compact danger-text" onClick={()=>onSalesAction("cancel")}>Zrušit / uvolnit</button>}</div></div>}
        </section>
        <section className="card client-detail-card">
          <SectionTitle title="Klient" action="Otevřít kartu klienta" onAction={() => buyers[0] ? openClient(buyers[0].name) : notify("Jednotka zatím nemá přiřazeného klienta")} />
          <div className="buyers">{buyers.length?buyers.map((buyer)=><div key={buyer.partyId}><Avatar initials={initials(buyer.name)} /><span><strong>{buyer.name}</strong><small>{buyer.role==="co_buyer"?"Spolukupující":"Kupující"}{buyer.share?` · podíl ${Math.round(buyer.share*100)} %`:""}</small><em><Mail size={14} /> {buyer.email}</em></span></div>):<div className="empty-client-row"><span><strong>Bez přiřazeného klienta</strong><small>Vyhledejte existující canonical party a zaznamenejte zájem.</small></span>{onSalesAction&&<button className="secondary-button compact" onClick={()=>onSalesAction("interest")}><Plus size={15}/> Přidat zájemce</button>}</div>}</div>
          {!isDejvice&&<div className="client-note"><MessageSquare size={16} /><span><small>INTERNÍ POZNÁMKA</small><p>Preferují komunikaci e-mailem. Financování z vlastních zdrojů.</p></span></div>}
        </section>
        <section className="card accessories-card">
          <SectionTitle title="Příslušenství" action={onManageAccessories?"Spravovat":undefined} onAction={onManageAccessories} />
          <div className="accessory-list">{accessoryItems.length?accessoryItems.map(item=><span key={item}><i className="accessory-icon">{item.startsWith("Sklep")?<Home size={17}/>:item.startsWith("Wallbox")?<Activity size={17}/>:<KeyRound size={17}/>}</i><span><strong>{item}</strong><small>Přiřazeno přes časově platnou vazbu{item.startsWith("Wallbox")?" · vazba na parking zachována":""}</small></span><Badge tone="success">Přiřazeno</Badge></span>):<div className="empty-inline"><strong>Bez příslušenství</strong><small>Vyberte dostupný sklep, parking nebo wallbox projektu.</small></div>}</div>
        </section>
        <section className="card price-card">
          <SectionTitle title="Cena" action="Otevřít historii cen" onAction={() => setPriceHistoryOpen(true)} />
          <div className="price-summary"><span><small>AKTUÁLNÍ CENA CELKEM</small><strong>{formatMoney(unit.price)}</strong><em>včetně DPH</em></span>{onEditPrice&&<button className="secondary-button compact" onClick={onEditPrice}><CreditCard size={16} /> Upravit cenu</button>}</div>
          <div className="price-breakdown">{isDejvice?<span><i className="price-dot apartment" /><span><strong>První známá ceníková cena</strong><small>{unit.layout} · {unit.area.toLocaleString("cs-CZ")} m²{unit.priceNet?" · bez DPH":""}</small></span><b>{unit.priceNet?formatMoney(unit.priceNet):formatMoney(unit.price)}</b></span>:<><span><i className="price-dot apartment" /><span><strong>Základní cena jednotky</strong><small>{unit.layout} · {unit.area.toLocaleString("cs-CZ")} m²</small></span><b>8 350 000 Kč</b></span><span><i className="price-dot storage" /><span><strong>Příslušenství</strong><small>sklep, parkovací stání a wallbox</small></span><b>640 000 Kč</b></span></>}</div>
        </section>
        <section className="card interest-history-card">
          <SectionTitle title="Historie zájmu" />
          <p className="section-description">Záznam zůstává uložený i po ukončení zájmu nebo opětovném uvolnění jednotky.</p>
          <div className="unit-table-wrap"><table className="data-table"><thead><tr><th>Datum</th><th>Zájemce</th><th>Typ / stupeň zájmu</th><th>Výsledek</th></tr></thead><tbody>{interestRows.map((interest)=><tr key={`${interest.partyId}-${interest.date}`}><td>{interest.date}</td><td><strong>{interest.name}</strong></td><td>{interest.type}</td><td><Badge tone={interest.result.includes("Aktivní")?"success":"neutral"}>{interest.result}</Badge></td></tr>)}</tbody></table></div>
        </section>
        <section className="card recent-card">
          <SectionTitle title="Poslední aktivita" action="Celá historie" onAction={() => notify("Otevřete záložku Historie")} />
          <div className="timeline-mini">{timeline.slice(0,4).map((item) => <div key={item.id}><span className={`timeline-icon ${item.icon}`}>{item.icon === "contract" ? <FileText size={16} /> : item.icon === "payment" ? <Banknote size={16} /> : item.icon === "build" ? <HardHat size={16} /> : <History size={16} />}</span><span><strong>{item.title}</strong><small>{item.detail}</small></span><time>{item.date}</time></div>)}</div>
        </section>
      </div>
      <aside className="unit-side-column">
        {unit.floorplanAvailable===false&&!floorplanUrl?<section className="card floorplan-card"><SectionTitle title="Půdorys" action={onEditFloorplan?"Nahrát půdorys":undefined} onAction={onEditFloorplan}/><div className="empty-filter-state"><FileText size={22}/><strong>Půdorys není ve zdroji</strong><small>Pilotní Excel neobsahuje soubor ani odkaz na půdorys.</small></div></section>:<section className="card floorplan-card"><div className="section-title"><h2>Půdorys</h2><span className="floorplan-actions">{onEditFloorplan&&<button className="text-button" onClick={onEditFloorplan}><ImagePlus size={15}/> Změnit</button>}<button className="ghost-icon" onClick={() => setFloorplanOpen(true)} aria-label="Otevřít velký půdorys"><ExternalLink size={17} /></button></span></div><button className="floorplan-preview-button" onClick={() => setFloorplanOpen(true)} aria-label="Zvětšit půdorys">{floorplanUrl?<img className="floorplan-image" src={floorplanUrl} alt={`Půdorys jednotky ${unit.id}`}/>:<div className="large-floorplan"><div className="room living"><span>OBÝVACÍ POKOJ + KK<small>32,1 m²</small></span></div><div className="room bed"><span>LOŽNICE<small>14,8 m²</small></span></div><div className="room bath"><span>KOUPELNA<small>5,4 m²</small></span></div><div className="room hall"><span>CHODBA<small>8,3 m²</small></span></div><div className="room bed2"><span>POKOJ<small>12,4 m²</small></span></div><div className="room wc"><span>WC</span></div><div className="balcony">LODŽIE · 8,2 m²</div></div>}<span className="enlarge-hint"><Eye size={15} /> Otevřít větší náhled</span></button><button className="secondary-button full" onClick={() => notify(`Stahuji půdorys ${unit.id}`)}><Download size={16} /> Stáhnout půdorys</button></section>}
        <section className="card parameters-card"><SectionTitle title="Základní parametry" /><dl><div><dt>Dispozice</dt><dd>{unit.layout}</dd></div><div><dt>Podlahová plocha</dt><dd>{unit.area.toLocaleString("cs-CZ")} m²</dd></div>{unit.usableArea&&<div><dt>Užitná plocha</dt><dd>{unit.usableArea.toLocaleString("cs-CZ")} m²</dd></div>}<div><dt>Podlaží</dt><dd>{unit.floor}</dd></div>{unit.balcony!=null&&<div><dt>Balkon</dt><dd>{unit.balcony.toLocaleString("cs-CZ")} m²</dd></div>}{unit.terrace!=null&&<div><dt>Terasa</dt><dd>{unit.terrace.toLocaleString("cs-CZ")} m²</dd></div>}{unit.garden!=null&&<div><dt>Zahrada</dt><dd>{unit.garden.toLocaleString("cs-CZ")} m²</dd></div>}{!isDejvice&&<><div><dt>Orientace</dt><dd>{unit.orientation}</dd></div><div><dt>Standard</dt><dd>Premium</dd></div><div><dt>Vlastnictví</dt><dd>Osobní</dd></div></>}</dl></section>
      </aside>
    </div>
    {floorplanOpen && <div className="modal-layer"><button className="modal-scrim" onClick={() => setFloorplanOpen(false)} aria-label="Zavřít půdorys" /><div className="modal floorplan-modal"><div className="modal-head"><div><h2>Půdorys jednotky {unit.id}</h2><p>{unit.layout} · {unit.area.toLocaleString("cs-CZ")} m² · {unit.floor}</p></div><button className="icon-button" onClick={() => setFloorplanOpen(false)}><X size={19} /></button></div><div className="modal-floorplan">{floorplanUrl&&<img className="floorplan-image" src={floorplanUrl} alt={`Půdorys jednotky ${unit.id}`}/>}<div className="large-floorplan"><div className="room living"><span>OBÝVACÍ POKOJ + KK<small>32,1 m²</small></span></div><div className="room bed"><span>LOŽNICE<small>14,8 m²</small></span></div><div className="room bath"><span>KOUPELNA<small>5,4 m²</small></span></div><div className="room hall"><span>CHODBA<small>8,3 m²</small></span></div><div className="room bed2"><span>POKOJ<small>12,4 m²</small></span></div><div className="room wc"><span>WC</span></div><div className="balcony">LODŽIE · 8,2 m²</div></div></div></div></div>}
    {priceHistoryOpen && <div className="modal-layer"><button className="modal-scrim" onClick={() => setPriceHistoryOpen(false)} aria-label="Zavřít historii cen" /><div className="modal price-history-modal"><div className="modal-head"><div><h2>Historie ceny · {unit.id}</h2><p>Každá změna je samostatný auditovatelný záznam.</p></div><button className="icon-button" onClick={() => setPriceHistoryOpen(false)}><X size={19} /></button></div><table className="data-table"><thead><tr><th>Platnost od</th><th>Typ ceny</th><th>Cena / sleva</th><th>Důvod</th><th>Autor / schválil</th></tr></thead><tbody>{(unitPriceHistories[unit.id]??[]).map(row=><tr key={row.id}><td>{new Date(row.validFrom).toLocaleDateString("cs-CZ")}</td><td><Badge tone="neutral">{({list_price:"Ceníková",individual_discount:"Individuální sleva",sale_price:"Prodejní",contract_price:"Smluvní"} as Record<string,string>)[row.type]??row.type}</Badge></td><td><strong>{formatMoney(row.amount)}</strong></td><td>{row.reason}</td><td>{row.author}{row.approver?` · ${row.approver}`:""}</td></tr>)}</tbody></table></div></div>}
    </>
  );
}

function UnitContracts({ unit,notify,openContract,onWorkflow }: { unit:UnitRecord;notify: (message: string) => void;openContract:(contract:(typeof contracts)[number])=>void;onWorkflow?: (contract:(typeof contracts)[number])=>void }) {
  const rows=contracts.filter(contract=>contract.unit===unit.id);
  return <section className="card detail-tab-card"><div className="tab-card-header"><div><h2>Smlouvy jednotky {unit.id}</h2><p>Workflow a logické verze smluv používají jeden zdroj dat.</p></div><button className="primary-button" onClick={() => notify("Vyberte typ nové smlouvy")}><Plus size={17} /> Nová smlouva</button></div><div className="document-list">{rows.map(row=>{const latest=row.versions?.[0];return <article key={row.id??`${row.unit}-${row.type}`}><span className="document-icon"><FileText size={21} /></span><button className="document-link-copy" onClick={()=>openContract(row)}><strong>{row.title??row.type}</strong><small>{row.reference?`${row.reference} · `:""}{latest?`verze v${String(latest.number).padStart(2,"0")} · ${latest.name}`:"Bez verze"}</small></button><Badge>{row.state}</Badge>{onWorkflow&&row.id?<button className="secondary-button compact" onClick={()=>onWorkflow(row)}>{row.action} <ChevronRight size={15}/></button>:<span/>}</article>})}{!rows.length&&<div className="empty-filter-state"><FileText size={22}/><strong>Jednotka zatím nemá smlouvu</strong><small>Nová smlouva bude navázána na existující obchodní proces.</small></div>}</div><div className="sharepoint-banner"><FolderOpen size={21}/><span><strong>Repository je připravené pro budoucí dokumenty</strong><small>DOCX ani SharePoint synchronizace v této etapě nejsou aktivní.</small></span></div></section>;
}

function UnitPayments({unit}:{unit:UnitRecord}) {
  if(isDejviceUnit(unit))return <PilotEmptyState title="Platby" detail="Pilotní zdroj neobsahuje platební kalendář ani skutečné platby."/>;
  const rows = [
    { name: "Rezervační poplatek", due: "20. 3. 2026", amount: 250000, paid: 250000, state: "Uhrazeno" },
    { name: "2. splátka · 25 %", due: "15. 7. 2026", amount: 2247500, paid: 2247500, state: "Uhrazeno" },
    { name: "3. splátka · 30 %", due: "31. 7. 2026", amount: 2697000, paid: 0, state: "Čeká na úhradu" },
  ];
  return <div className="detail-tab-stack"><div className="metric-row"><div className="metric-card wide"><span className="metric-icon green"><Banknote size={20} /></span><span><small>Uhrazeno</small><strong>2 497 500 Kč</strong><em>28 % kupní ceny</em></span></div><div className="metric-card wide"><span className="metric-icon sand"><Clock3 size={20} /></span><span><small>Nejbližší splátka</small><strong>2 697 000 Kč</strong><em>splatnost 31. 7. 2026</em></span></div><div className="metric-card wide"><span className="metric-icon blue"><CircleDollarSign size={20} /></span><span><small>Zbývá uhradit</small><strong>6 492 500 Kč</strong><em>72 % kupní ceny</em></span></div></div><section className="card detail-tab-card"><div className="tab-card-header"><div><h2>Splátkový kalendář</h2><p>Plánované a skutečné platby včetně částečných úhrad.</p></div><button className="secondary-button"><Plus size={16} /> Upravit kalendář</button></div><div className="unit-table-wrap"><table className="data-table"><thead><tr><th>Splátka</th><th>Splatnost</th><th>Předpis</th><th>Uhrazeno</th><th>Stav</th></tr></thead><tbody>{rows.map((row) => <tr key={row.name}><td><strong>{row.name}</strong></td><td>{row.due}</td><td><strong>{formatMoney(row.amount)}</strong></td><td>{formatMoney(row.paid)}</td><td><Badge>{row.state}</Badge></td></tr>)}</tbody></table></div></section></div>;
}

function UnitClientChanges({ unit, notify }: { unit: UnitRecord; notify: (message: string) => void }) {
  if(isDejviceUnit(unit))return <PilotEmptyState title="Klientské změny" detail="Pilotní zdroj neobsahuje klientské změny."/>;
  const changes = [
    { name: "Změna podlahy v obytných místnostech", category: "Povrchy", source: "Individuální změna", state: "Ke schválení", tone: "warning", price: null, deadline: "24. 7. 2026", requested: "11. 7. 2026", documents: ["Specifikace_podlahy.pdf", "Nabídka_dodavatele.xlsx"] },
    { name: "Doplnění elektro vývodů", category: "Elektro", source: "Ceník standardních změn", state: "Schváleno", tone: "success", price: 18500, deadline: "29. 7. 2026", requested: "4. 7. 2026", documents: ["Objednávka_KZ-0142.pdf", "Výkres_elektro_rev02.pdf"] },
    { name: "Příprava pro venkovní žaluzie", category: "Stínění", source: "Ceník standardních změn", state: "V realizaci", tone: "blue", price: 42000, deadline: "15. 8. 2026", requested: "28. 6. 2026", documents: ["Potvrzení_KZ-0138.pdf"] },
  ];
  const totalSurcharge = changes.reduce((sum, change) => sum + (change.price || 0), 0);
  const documentCount = changes.reduce((sum, change) => sum + change.documents.length, 0);

  return (
    <div className="detail-tab-stack">
      <section className="card unit-change-context">
        <div className="change-context-copy">
          <span className="change-context-icon"><Link2 size={19} /></span>
          <span><strong>Provázané údaje bez duplikace</strong><small>Změny používají existující vazby na jednotku, klienta, platební předpisy a dokumenty.</small></span>
        </div>
        <div className="change-context-grid">
          <span><small>JEDNOTKA</small><strong>{unit.id}</strong><em>{unit.project}</em></span>
          <span><small>KLIENT</small><strong>{unit.client || "Bez přiřazeného klienta"}</strong><em>z karty klienta</em></span>
          <span><small>DOPLATKY CELKEM</small><strong>{formatMoney(totalSurcharge)}</strong><em>navázáno na platby</em></span>
          <span><small>DOKUMENTY</small><strong>{documentCount} souborů</strong><em>v dokumentech jednotky</em></span>
        </div>
      </section>
      <section className="card detail-tab-card">
        <div className="tab-card-header"><div><h2>Klientské změny jednotky {unit.id}</h2><p>Individuální požadavky i položky z ceníku standardních klientských změn.</p></div><button className="primary-button" onClick={() => notify(`Nová klientská změna pro ${unit.id}`)}><Plus size={17} /> Nová změna</button></div>
        <div className="unit-table-wrap"><table className="data-table unit-changes-table"><thead><tr><th>Změna</th><th>Kategorie</th><th>Stav</th><th>Cena / doplatek</th><th>Termín</th><th>Datum požadavku</th><th>Související dokumenty</th><th /></tr></thead><tbody>{changes.map((change) => <tr key={change.name} className="clickable-row" onClick={() => notify(`Otevírám detail změny: ${change.name}`)}><td><strong>{change.name}</strong><small className="change-source">{change.source}</small></td><td>{change.category}</td><td><Badge tone={change.tone}>{change.state}</Badge></td><td><strong>{change.price ? formatMoney(change.price) : "K nacenění"}</strong></td><td>{change.deadline}</td><td>{change.requested}</td><td><span className="change-documents">{change.documents.map((document) => <button key={document} onClick={(event) => { event.stopPropagation(); notify(`Otevírám ${document}`); }}><FileText size={14} /> {document}</button>)}</span></td><td><ChevronRight size={17} /></td></tr>)}</tbody></table></div>
      </section>
    </div>
  );
}

function UnitDocuments({ unit,notify }: { unit:UnitRecord;notify: (message: string) => void }) {
  const [documents,setDocuments]=useState<DocumentRecord[]>([]);const [connection,setConnection]=useState<DocumentConnectionState>(previewConnection);const [loading,setLoading]=useState(true);const [category,setCategory]=useState("");
  useEffect(()=>{const controller=new AbortController();documentRepository.listUnit(unit.backendId??unit.id,{category:category||undefined},controller.signal).then(result=>{setDocuments(result.documents);setConnection(result.connection);}).catch(()=>{setDocuments([]);setConnection(previewConnection);}).finally(()=>setLoading(false));return()=>controller.abort();},[unit.backendId,unit.id,category]);
  return <section className="card detail-tab-card"><div className="tab-card-header"><div><h2>Dokumenty jednotky {unit.id}</h2><p>Jeden přehled metadat, vazeb a fyzických verzí souborů.</p></div></div><DocumentConnectionBanner connection={connection}/><div className="module-toolbar document-toolbar"><div className="inline-search"><Search size={17}/><span>{loading?"Načítám dokumenty…":`${documents.length} dokumentů`}</span></div><label><span>Kategorie</span><select value={category} onChange={event=>{setLoading(true);setCategory(event.target.value);}}><option value="">Všechny kategorie</option>{documentCategoryOptions.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select></label></div><DocumentList documents={documents} loading={loading} notify={notify}/></section>;
}

const documentCategoryOptions=[
  {value:"contract",label:"Smlouva"},{value:"floor_plan",label:"Půdorys"},{value:"project_documentation",label:"Projektová dokumentace"},
  {value:"client_document",label:"Klientský dokument"},{value:"price_document",label:"Cenový dokument"},{value:"reservation",label:"Rezervace"},{value:"other",label:"Ostatní"},
];
function documentCategoryLabel(value:string){return documentCategoryOptions.find(option=>option.value===value)?.label??value;}
function DocumentConnectionBanner({connection}:{connection:DocumentConnectionState}){if(connection.status==="connected")return <div className="sharepoint-banner"><CheckCircle2 size={19}/><span><strong>SharePoint je připojen</strong><small>{connection.lastSuccessfulSyncAt?`Poslední úspěšná synchronizace ${new Date(connection.lastSuccessfulSyncAt).toLocaleString("cs-CZ")}`:"Připojení je připravené k synchronizaci."}</small></span></div>;return <div className="unassigned-doc document-connection-note"><AlertTriangle size={19}/><span><strong>SharePoint zatím není připojen</strong><small>Preview bezpečně zobrazuje pouze CRM metadata a existující preview média. Žádný soubor se nevydává za nahraný na SharePoint.</small></span></div>;}
function DocumentList({documents,loading,notify}:{documents:DocumentRecord[];loading:boolean;notify:(message:string)=>void}){if(loading)return <div className="empty-filter-state"><Clock3 size={21}/><strong>Načítám dokumenty</strong></div>;if(!documents.length)return <div className="empty-filter-state"><FolderOpen size={22}/><strong>Žádné dokumenty v tomto rozsahu</strong><small>Zdroj zatím neobsahuje odpovídající dokumentová metadata.</small></div>;return <div className="document-list document-metadata-list">{documents.map(document=>{const related=[...document.units,...document.parties,...document.contracts];return <article key={document.id}><span className="document-icon"><FileText size={21}/></span><span><strong>{document.name}</strong><small>{documentCategoryLabel(document.category)} · {related.length?related.join(" · "):document.projectName}</small></span><span className="document-meta"><small>Poslední změna</small><strong>{document.updatedAt?new Date(document.updatedAt).toLocaleDateString("cs-CZ"):"—"}</strong></span><span className="document-meta"><small>Autor</small><strong>{document.author??"—"}</strong></span><Badge tone="neutral">{document.version??"bez verze"}</Badge>{document.webUrl?<Link className="ghost-icon" href={document.webUrl} target="_blank" rel="noreferrer" aria-label={`Otevřít ${document.name}`}><ExternalLink size={18}/></Link>:<button className="ghost-icon" onClick={()=>notify("Dokument je v bezpečném preview pouze jako metadata; externí odkaz není k dispozici")} aria-label={`Informace o ${document.name}`}><Eye size={18}/></button>}</article>;})}</div>;}

function UnitHandover({ unit,notify }: { unit:UnitRecord;notify: (message: string) => void }) {
  if(isDejviceUnit(unit))return <PilotEmptyState title="Předání" detail="Pilotní zdroj neobsahuje termín ani data předání."/>;
  const checklist = ["Dokumentace jednotky", "Revize a certifikáty", "Odečty měřidel", "Sada klíčů a čipů", "Kontrola klientských změn", "Fotodokumentace"];
  return <div className="handover-detail-grid"><section className="card detail-tab-card"><div className="tab-card-header"><div><h2>Příprava předání</h2><p>Plánovaný termín: 30. 9. 2026 · 10:00</p></div><Badge tone="warning">Připravenost 72 %</Badge></div><div className="handover-big-progress"><span><strong>72 %</strong><small>4 z 6 oblastí připraveno</small></span><div><i style={{ width: "72%" }} /></div></div><div className="handover-checklist">{checklist.map((item, index) => <button key={item} onClick={() => notify(`${item}: stav byl aktualizován`)}><span className={index < 4 ? "checked" : ""}>{index < 4 && <Check size={14} />}</span><strong>{item}</strong><Badge tone={index < 4 ? "success" : "warning"}>{index < 4 ? "Hotovo" : "Doplnit"}</Badge><ChevronRight size={17} /></button>)}</div></section><aside className="card handover-side"><h3>Rychlé akce</h3><button><CreditCard size={18} /><span><strong>Zapsat odečty</strong><small>Elektřina, voda, teplo</small></span><ChevronRight size={16} /></button><button><KeyRound size={18} /><span><strong>Klíče a čipy</strong><small>Evidence předaných kusů</small></span><ChevronRight size={16} /></button><button><AlertTriangle size={18} /><span><strong>Nedodělky</strong><small>0 otevřených položek</small></span><ChevronRight size={16} /></button><button onClick={() => notify("Protokol je připraven ke generování")}><FileText size={18} /><span><strong>Vygenerovat protokol</strong><small>Word šablona · DOCX</small></span><ChevronRight size={16} /></button></aside></div>;
}

function UnitTasks({ unit,openTask }: { unit:UnitRecord;openTask: () => void }) {
  if(isDejviceUnit(unit))return <PilotEmptyState title="Úkoly" detail="K jednotce zatím nejsou importovány žádné úkoly."/>;
  return <section className="card detail-tab-card"><div className="tab-card-header"><div><h2>Úkoly jednotky</h2><p>Ruční i automatické úkoly navázané na A203.</p></div><button className="primary-button" onClick={openTask}><Plus size={17} /> Nový úkol</button></div><div className="large-task-list"><article><button className="task-check large" /><span className="priority-bar vysoka" /><span className="task-main-copy"><strong>Doplnit číslo účtu klienta</strong><small>Automaticky vytvořeno · blokuje generování SBK</small></span><Badge tone="danger">Vysoká</Badge><span className="task-due urgent"><Clock3 size={15} />Dnes</span><Avatar initials="IN" small /></article><article><button className="task-check large" /><span className="priority-bar stredni" /><span className="task-main-copy"><strong>Zapracovat připomínky klienta</strong><small>Smlouva SBK · verze v04</small></span><Badge tone="warning">Střední</Badge><span className="task-due"><Clock3 size={15} />Zítra</span><Avatar initials="PS" small /></article></div></section>;
}

function UnitHistory({unit,timeline}:{unit:UnitRecord;timeline:TimelineRecord[]}) {
  return <section className="card detail-tab-card history-tab"><div className="tab-card-header"><div><h2>Kompletní historie jednotky</h2><p>Jednotná auditní stopa obchodních, cenových, dokumentových a datových změn.</p></div><Badge tone="neutral">{unit.id}</Badge></div><div className="full-timeline">{timeline.map((item) => <article key={item.id}><div className={`timeline-icon ${item.icon}`}>{item.icon === "contract" ? <FileText size={17} /> : item.icon === "payment" ? <Banknote size={17} /> : item.icon === "build" ? <HardHat size={17} /> : <History size={17} />}</div><div><time>{item.date}</time><strong>{item.title}</strong><p>{item.detail}</p></div></article>)}{!timeline.length&&<div className="empty-filter-state"><History size={22}/><strong>Zatím bez auditních událostí</strong><small>První uložená změna se zobrazí zde i v poslední aktivitě.</small></div>}</div></section>;
}

function PilotEmptyState({title,detail}:{title:string;detail:string}){
  return <section className="card detail-tab-card"><div className="tab-card-header"><div><h2>{title}</h2><p>{detail}</p></div></div><div className="empty-filter-state"><FileText size={22}/><strong>Bez zdrojových dat</strong><small>Do CRM nebyla doplněna žádná zástupná data.</small></div></section>;
}

function EditProjectModal({project,memberships,canChangeManager,canChangeStatus,close,save}:{project:ProjectRecord;memberships:MembershipOption[];canChangeManager:boolean;canChangeStatus:boolean;close:()=>void;save:(value:{name:string;location:string;lifecycleStatus:string;managerMembershipId:string|null;plannedCompletionFrom:string|null;plannedCompletionTo:string|null;stageCode:string;stageReason:string})=>Promise<void>}){const [name,setName]=useState(project.name);const [location,setLocation]=useState(project.location);const [lifecycleStatus,setLifecycleStatus]=useState(project.lifecycleStatus??"active");const [manager,setManager]=useState(project.managerMembershipId??"");const [from,setFrom]=useState(project.plannedCompletionFrom??"");const [to,setTo]=useState(project.plannedCompletionTo??"");const [stage,setStage]=useState(labelToConstructionCode(project.stage));const [reason,setReason]=useState("");return <FormModal title="Upravit projekt" close={close} onSave={()=>save({name,location,lifecycleStatus,managerMembershipId:manager||null,plannedCompletionFrom:from||null,plannedCompletionTo:to||null,stageCode:stage,stageReason:reason})}><div className="form-row"><label><span>Název projektu</span><input value={name} onChange={e=>setName(e.target.value)} /></label><label><span>Lokalita</span><input value={location} onChange={e=>setLocation(e.target.value)} /></label></div><div className="form-row"><label><span>Životní cyklus projektu</span><select value={lifecycleStatus} onChange={e=>setLifecycleStatus(e.target.value)}><option value="preparation">Příprava</option><option value="active">Aktivní</option><option value="completed">Dokončený</option><option value="archived">Archivovaný</option></select></label><label><span>Vedoucí projektu</span><select value={manager} disabled={!canChangeManager} onChange={e=>setManager(e.target.value)}><option value="">Bez vedoucího</option>{memberships.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div><div className="form-row"><label><span>Plánované dokončení od</span><input type="date" value={from} onChange={e=>setFrom(e.target.value)} /></label><label><span>Plánované dokončení do</span><input type="date" value={to} min={from} onChange={e=>setTo(e.target.value)} /></label></div><label><span>Aktuální fáze projektu</span><select value={stage} disabled={!canChangeStatus} onChange={e=>setStage(e.target.value)}>{constructionStatusOptions.map(item=><option key={item.code} value={item.code}>{item.label}</option>)}</select></label>{stage!==labelToConstructionCode(project.stage)&&<label><span>Důvod změny fáze</span><textarea value={reason} onChange={e=>setReason(e.target.value)} rows={2} placeholder="Krátké vysvětlení pro historii projektu" /></label>}</FormModal>}
function EditUnitModal({unit,structures,close,save}:{unit:UnitRecord;structures:ProjectStructureOption[];close:()=>void;save:(value:{structureId:string|null;layout:string;areaM2:number;floorLabel:string;floorNumber?:number;orientation:string;usableAreaM2?:number;balconyM2?:number;terraceM2?:number;gardenM2?:number})=>Promise<void>}){const [layout,setLayout]=useState(unit.layout);const [area,setArea]=useState(String(unit.area));const [usable,setUsable]=useState(unit.usableArea?.toString()??"");const [floor,setFloor]=useState(unit.floor);const [floorNumber,setFloorNumber]=useState(unit.floor.match(/-?\d+(?:[.,]\d+)?/)?.[0]??"");const [orientation,setOrientation]=useState(unit.orientation);const [structure,setStructure]=useState(unit.structureId??"");const [balcony,setBalcony]=useState(unit.balcony?.toString()??"");const [terrace,setTerrace]=useState(unit.terrace?.toString()??"");const [garden,setGarden]=useState(unit.garden?.toString()??"");return <FormModal title={`Upravit jednotku ${unit.id}`} close={close} onSave={()=>save({structureId:structure||null,layout,areaM2:numberValue(area)!,usableAreaM2:numberValue(usable),floorLabel:floor,floorNumber:numberValue(floorNumber),orientation,balconyM2:numberValue(balcony),terraceM2:numberValue(terrace),gardenM2:numberValue(garden)})}><div className="form-row"><label><span>Dispozice</span><input value={layout} onChange={e=>setLayout(e.target.value)} /></label><label><span>Budova / etapa / sekce</span><select value={structure} onChange={e=>setStructure(e.target.value)}><option value="">Bez zařazení</option>{structures.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div><div className="form-row"><label><span>Podlahová plocha m²</span><input inputMode="decimal" value={area} onChange={e=>setArea(e.target.value)} /></label><label><span>Užitná plocha m²</span><input inputMode="decimal" value={usable} onChange={e=>setUsable(e.target.value)} /></label></div><div className="form-row"><label><span>Podlaží</span><input value={floor} onChange={e=>setFloor(e.target.value)} /></label><label><span>Číslo podlaží</span><input inputMode="decimal" value={floorNumber} onChange={e=>setFloorNumber(e.target.value)} /></label><label><span>Orientace</span><input value={orientation} onChange={e=>setOrientation(e.target.value)} /></label></div><div className="form-row"><label><span>Balkon m²</span><input inputMode="decimal" value={balcony} onChange={e=>setBalcony(e.target.value)} /></label><label><span>Terasa m²</span><input inputMode="decimal" value={terrace} onChange={e=>setTerrace(e.target.value)} /></label><label><span>Zahrada m²</span><input inputMode="decimal" value={garden} onChange={e=>setGarden(e.target.value)} /></label></div></FormModal>}
function EditPriceModal({unit,close,save}:{unit:UnitRecord;close:()=>void;save:(value:{priceType:string;amount:number;validFrom:string;reason:string})=>Promise<void>}){const [priceType,setPriceType]=useState("sale_price");const [amount,setAmount]=useState(String(unit.price));const [validFrom,setValidFrom]=useState(new Date().toISOString().slice(0,10));const [reason,setReason]=useState("");return <FormModal title={`Nový záznam ceny · ${unit.id}`} close={close} onSave={async()=>{if(!reason.trim())throw new Error("Doplňte důvod změny ceny");await save({priceType,amount:Number(amount.replace(/\s/g,"").replace(",",".")),validFrom,reason});}}><label><span>Typ cenového záznamu</span><select value={priceType} onChange={e=>setPriceType(e.target.value)}><option value="list_price">Ceníková cena</option><option value="sale_price">Aktuální prodejní cena</option><option value="individual_discount">Individuální sleva</option><option value="contract_price">Finální smluvní cena</option></select></label><label><span>{priceType==="individual_discount"?"Výše slevy v Kč":"Nová cena v Kč"}</span><input inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} /></label><label><span>Datum účinnosti</span><input type="date" value={validFrom} onChange={e=>setValidFrom(e.target.value)} /></label><label><span>Důvod změny</span><textarea required value={reason} onChange={e=>setReason(e.target.value)} rows={3} placeholder="Např. schválená individuální nabídka" /></label><p className="form-help"><History size={14}/> Stávající cena zůstane v append-only historii; nevzniká její přepis.</p></FormModal>}
function EditClientModal({client,close,save}:{client:(typeof clients)[number];close:()=>void;save:(value:{firstName:string;lastName:string;legalName:string;registrationNumber:string;vatNumber:string;contactPerson:string;email:string;phone:string;line1:string;line2:string;city:string;postalCode:string;countryCode:string})=>Promise<void>}){const parts=client.name.split(" ");const [firstName,setFirstName]=useState(client.firstName??parts[0]??"");const [lastName,setLastName]=useState(client.lastName??parts.slice(1).join(" "));const [legalName,setLegalName]=useState(client.legalName??client.name);const [registrationNumber,setRegistrationNumber]=useState(client.registrationNumber??"");const [vatNumber,setVatNumber]=useState(client.vatNumber??"");const [contactPerson,setContactPerson]=useState(client.contactPerson??"");const [email,setEmail]=useState(client.email);const [phone,setPhone]=useState(client.phone);const [line1,setLine1]=useState(client.address?.line1??"");const [line2,setLine2]=useState(client.address?.line2??"");const [city,setCity]=useState(client.address?.city??"");const [postalCode,setPostalCode]=useState(client.address?.postalCode??"");const [countryCode,setCountryCode]=useState(client.address?.countryCode??"CZ");return <FormModal title="Upravit klienta" close={close} onSave={()=>save({firstName,lastName,legalName,registrationNumber,vatNumber,contactPerson,email,phone,line1,line2,city,postalCode,countryCode})}>{client.kind==="FO"?<div className="form-row"><label><span>Jméno</span><input value={firstName} onChange={e=>setFirstName(e.target.value)}/></label><label><span>Příjmení</span><input value={lastName} onChange={e=>setLastName(e.target.value)}/></label></div>:<><label><span>Obchodní název</span><input value={legalName} onChange={e=>setLegalName(e.target.value)}/></label><div className="form-row"><label><span>IČO</span><input value={registrationNumber} onChange={e=>setRegistrationNumber(e.target.value)}/></label><label><span>DIČ</span><input value={vatNumber} onChange={e=>setVatNumber(e.target.value)}/></label><label><span>Kontaktní osoba</span><input value={contactPerson} onChange={e=>setContactPerson(e.target.value)}/></label></div></>}<div className="form-row"><label><span>E-mail</span><input type="email" value={email} onChange={e=>setEmail(e.target.value)}/></label><label><span>Telefon</span><input value={phone} onChange={e=>setPhone(e.target.value)}/></label></div><label><span>{client.kind==="FO"?"Adresa bydliště":"Sídlo společnosti"}</span><input value={line1} onChange={e=>setLine1(e.target.value)} placeholder="Ulice a číslo"/></label><label><span>Doplnění adresy</span><input value={line2} onChange={e=>setLine2(e.target.value)} placeholder="Budova, patro…"/></label><div className="form-row"><label><span>Město</span><input value={city} onChange={e=>setCity(e.target.value)}/></label><label><span>PSČ</span><input value={postalCode} onChange={e=>setPostalCode(e.target.value)}/></label><label><span>Země</span><input maxLength={2} value={countryCode} onChange={e=>setCountryCode(e.target.value.toUpperCase())}/></label></div></FormModal>}
function AccessoryModal({unit,inventory,close,assign,remove}:{unit:UnitRecord;inventory:CatalogAccessoryRecord[];close:()=>void;assign:(item:CatalogAccessoryRecord)=>Promise<void>;remove:(item:NonNullable<UnitRecord["accessories"]>[number])=>Promise<void>}){const [category,setCategory]=useState("all");const assigned=unit.accessories??[];const available=inventory.filter(item=>item.available&&(category==="all"||item.category===category));return <FormModal title={`Příslušenství · ${unit.id}`} close={close} onSave={async()=>close()} saveLabel="Hotovo"><div className="accessory-manager"><section><div className="modal-section-head"><strong>Aktuálně přiřazeno</strong><small>{assigned.length} položek</small></div>{assigned.length?assigned.map(item=><div className="accessory-choice assigned" key={item.assignmentId??item.id}><span><strong>{item.type} {item.code}</strong><small>{item.areaM2?`${item.areaM2} m² · `:""}{item.relation?`navázáno na ${item.relation}`:"Aktivní přiřazení"}</small></span><button type="button" className="text-button danger-text" onClick={()=>void remove(item)}>Uvolnit</button></div>):<p className="empty-copy">Jednotka nemá přiřazené příslušenství.</p>}</section><section><div className="modal-section-head"><strong>Dostupné v projektu</strong><select value={category} onChange={e=>setCategory(e.target.value)}><option value="all">Všechny typy</option><option value="cellar">Sklepy</option><option value="parking">Parkovací stání</option><option value="wallbox">Wallboxy</option><option value="garage">Garáže</option></select></div>{available.length?available.map(item=><button type="button" className="accessory-choice" key={item.id} onClick={()=>void assign(item)}><span><strong>{item.type} {item.code}</strong><small>{item.areaM2?`${item.areaM2} m² · `:""}{item.relation?`vazba na ${item.relation}`:"Volné k přiřazení"}</small></span><Plus size={16}/></button>):<p className="empty-copy">V této kategorii není volné příslušenství.</p>}</section></div></FormModal>}
function SalesActionModal({action,clientRows,close,save}:{action:{unit:UnitRecord;mode:"interest"|"pre_reservation"|"reservation"|"convert"|"cancel"};clientRows:typeof clients;close:()=>void;save:(value:{partyId:string;expiresAt:string;reason:string})=>Promise<void>}){
  const context=unitCommercialContexts[action.unit.id];
  const defaultParty=context?.buyers[0]?.partyId??context?.interests[0]?.partyId??clientRows[0]?.id??"";
  const [partyId,setPartyId]=useState(defaultParty);const [query,setQuery]=useState("");const [creatingNew,setCreatingNew]=useState(false);
  const [partyKind,setPartyKind]=useState<"individual"|"organization">("individual");const [firstName,setFirstName]=useState("");const [lastName,setLastName]=useState("");const [legalName,setLegalName]=useState("");const [registrationNumber,setRegistrationNumber]=useState("");const [email,setEmail]=useState("");const [phone,setPhone]=useState("");
  const [expiresAt,setExpiresAt]=useState(()=>new Date(Date.now()+(action.mode==="pre_reservation"?3:14)*86400000).toISOString().slice(0,16));const [reason,setReason]=useState("");
  const candidates=clientRows.filter(item=>item.name.toLowerCase().includes(query.toLowerCase())||item.email.toLowerCase().includes(query.toLowerCase())).slice(0,8);
  const titles={interest:"Přidat zájemce",pre_reservation:"Vytvořit předrezervaci",reservation:"Vytvořit rezervaci",convert:"Převést na rezervaci",cancel:"Zrušit a uvolnit jednotku"};const destructive=action.mode==="cancel";
  return <FormModal title={`${titles[action.mode]} · ${action.unit.id}`} close={close} onSave={async()=>{
    let selectedPartyId=partyId;
    if(creatingNew){const displayName=partyKind==="individual"?`${firstName} ${lastName}`.trim():legalName;if(!displayName)throw new Error("Doplňte jméno nebo název klienta");const created=await clientRepository.createParty({projectId:action.unit.projectBackendId??projects.find(item=>item.name===action.unit.project)?.backendId??projects.find(item=>item.name===action.unit.project)?.code??"",kind:partyKind,firstName,lastName,legalName,registrationNumber,email,phone});selectedPartyId=created.id;const project=action.unit.project;clientRows.push({id:created.id,name:displayName,type:partyKind==="individual"?"Fyzická osoba":"Právnická osoba",kind:partyKind==="individual"?"FO":"PO",email,phone,contact:[email,phone].filter(Boolean).join(" · "),units:[],projects:project,projectNames:[project],state:"Zájemce",contractStatus:"Bez smlouvy",initials:initials(displayName)});}
    if(!destructive&&!selectedPartyId)throw new Error("Vyberte klienta nebo zájemce");if(!reason.trim())throw new Error("Doplňte důvod operace");if(destructive&&!window.confirm("Tato akce uvolní jednotku. Opravdu pokračovat?"))return;await save({partyId:selectedPartyId,expiresAt:new Date(expiresAt).toISOString(),reason});
  }} saveLabel={destructive?"Potvrdit uvolnění":"Pokračovat"}>
    {!destructive&&action.mode!=="convert"&&<>{!creatingNew?<><label><span>Vyhledat v jednotné databázi klientů</span><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Jméno, e-mail…"/></label><div className="party-picker">{candidates.map(item=><label key={item.id} className={partyId===item.id?"selected":""}><input type="radio" name="party" checked={partyId===item.id} onChange={()=>setPartyId(item.id)}/><Avatar initials={item.initials} small/><span><strong>{item.name}</strong><small>{item.email||item.phone} · {item.projects}</small></span></label>)}</div><button type="button" className="text-button new-party-toggle" onClick={()=>setCreatingNew(true)}><Plus size={14}/> Klient v databázi není – založit nový</button></>:<div className="new-party-fields"><div className="modal-section-head"><strong>Nový canonical klient</strong><button type="button" className="text-button" onClick={()=>setCreatingNew(false)}>Vybrat existujícího</button></div><label><span>Typ</span><select value={partyKind} onChange={event=>setPartyKind(event.target.value as "individual"|"organization")}><option value="individual">Fyzická osoba</option><option value="organization">Právnická osoba</option></select></label>{partyKind==="individual"?<div className="form-row"><label><span>Jméno</span><input value={firstName} onChange={event=>setFirstName(event.target.value)}/></label><label><span>Příjmení</span><input value={lastName} onChange={event=>setLastName(event.target.value)}/></label></div>:<div className="form-row"><label><span>Obchodní název</span><input value={legalName} onChange={event=>setLegalName(event.target.value)}/></label><label><span>IČO</span><input value={registrationNumber} onChange={event=>setRegistrationNumber(event.target.value)}/></label></div>}<div className="form-row"><label><span>E-mail</span><input type="email" value={email} onChange={event=>setEmail(event.target.value)}/></label><label><span>Telefon</span><input value={phone} onChange={event=>setPhone(event.target.value)}/></label></div></div>}</>}
    {action.mode!=="interest"&&action.mode!=="cancel"&&<label><span>Platnost do</span><input type="datetime-local" value={expiresAt} onChange={event=>setExpiresAt(event.target.value)}/></label>}<label><span>{destructive?"Důvod zrušení":"Poznámka / důvod"}</span><textarea rows={3} value={reason} onChange={event=>setReason(event.target.value)} placeholder="Povinný kontext pro auditní stopu"/></label><p className="form-help"><History size={14}/> Operace atomicky aktualizuje sales case, hold, historii a obchodní stav jednotky.</p>
  </FormModal>
}
function ContractWorkflowModal({contract,close,save}:{contract:(typeof contracts)[number];close:()=>void;save:(value:{to:string;reason:string})=>Promise<void>}){const code=contract.statusCode??({"V přípravě":"draft","Odeslána":"sent","Ve vyjednávání":"negotiation","Schválena":"approved","K podpisu":"signing","Podepsána":"signed","Zrušena":"cancelled","Ukončena":"terminated"} as Record<string,string>)[contract.state]??"draft";const options=({draft:["sent","cancelled"],sent:["negotiation","approved","cancelled"],negotiation:["sent","approved","cancelled"],approved:["signing","negotiation","cancelled"],signing:["negotiation","cancelled"],signed:["terminated"]} as Record<string,string[]>)[code]??[];const [to,setTo]=useState(options[0]??"");const [reason,setReason]=useState("");return <FormModal title={`Workflow ${contract.type} · ${contract.unit}`} close={close} onSave={async()=>{if(!to)throw new Error("Pro aktuální stav není dostupný ruční přechod");if(!reason.trim())throw new Error("Doplňte důvod změny");if((to==="cancelled"||to==="terminated")&&!window.confirm("Tato změna je obchodně významná. Opravdu pokračovat?"))return;await save({to,reason});}}><label><span>Aktuální stav</span><input value={contract.state} disabled/></label><label><span>Nový stav</span><select value={to} onChange={e=>setTo(e.target.value)}>{options.map(item=><option key={item} value={item}>{({sent:"Odeslána",negotiation:"Ve vyjednávání",approved:"Schválena",signing:"K podpisu",cancelled:"Zrušena",terminated:"Ukončena"} as Record<string,string>)[item]}</option>)}</select></label><label><span>Důvod změny</span><textarea rows={3} value={reason} onChange={e=>setReason(e.target.value)}/></label><p className="form-help"><History size={14}/> Podepsaný stav vzniká pouze dokončením podpisů, nikoli ručním přepnutím.</p></FormModal>}
function FormModal({title,close,onSave,children,saveLabel="Uložit"}:{title:string;close:()=>void;onSave:()=>Promise<void>;children:React.ReactNode;saveLabel?:string}){const [busy,setBusy]=useState(false);const [error,setError]=useState("");const submit=async()=>{setBusy(true);setError("");try{await onSave();}catch(problem){setError(problem instanceof Error?problem.message:"Změnu se nepodařilo uložit");}finally{setBusy(false);}};return <div className="modal-layer"><button className="modal-scrim" onClick={close} aria-label="Zavřít dialog" /><div className="modal"><div className="modal-head"><div><h2>{title}</h2><p>Změna se uloží přes řízenou doménovou operaci.</p></div><button className="icon-button" onClick={close}><X size={19}/></button></div><div className="modal-form">{children}{error&&<div className="form-error"><AlertTriangle size={15}/>{error}</div>}</div><div className="modal-foot"><button className="secondary-button" onClick={close} disabled={busy}>Zrušit</button><button className="primary-button" onClick={()=>void submit()} disabled={busy}>{busy?"Ukládám…":saveLabel}</button></div></div></div>}

const constructionStatusOptions=[{code:"preparation",label:"Příprava"},{code:"permitting",label:"Povolování"},{code:"construction",label:"Ve výstavbě"},{code:"rough_construction",label:"Hrubá stavba"},{code:"installations",label:"Instalace"},{code:"fit_out",label:"Dokončovací práce"},{code:"completed",label:"Dokončeno"}];
function labelToConstructionCode(label:string){return constructionStatusOptions.find(item=>item.label===label)?.code??"preparation";}
function constructionCodeToLabel(code:string){return constructionStatusOptions.find(item=>item.code===code)?.label??code;}
function quarterFromDate(value:string|null){if(!value)return"Neplánováno";const date=new Date(`${value}T00:00:00Z`);return `Q${Math.floor(date.getUTCMonth()/3)+1} ${date.getUTCFullYear()}`;}
function numberValue(value:string){if(!value.trim())return undefined;const number=Number(value.replace(",","."));return Number.isFinite(number)?number:undefined;}
function projectMatchesName(project:ProjectRecord,name:string){return name===project.name||name===project.sourceName;}
function unitBelongsToProject(unit:UnitRecord,project:ProjectRecord){return Boolean((unit.projectBackendId&&project.backendId&&unit.projectBackendId===project.backendId)||(unit.projectCode&&unit.projectCode===project.code)||projectMatchesName(project,unit.project));}
function isDejviceUnit(unit:UnitRecord){return unit.projectCode==="DEJ"||unit.project==="Rezidence Dejvice"||unit.project==="Rezidence Dejvice Test";}
function projectRouteId(project:ProjectRecord){return project.backendId??project.code;}
function unitRouteId(unit:UnitRecord){return unit.backendId??unit.id;}

function TaskModal({ close, save,memberships,defaultUnit }: { close: () => void; save: (value:{title:string;description:string;objectType:string;objectId:string;assigneeId:string|null;priority:"low"|"medium"|"high";dueAt:string}) => Promise<void>;memberships:MembershipOption[];defaultUnit?:string }) {
  const [title,setTitle]=useState("");const [description,setDescription]=useState("");const [objectType,setObjectType]=useState("unit");const [objectId,setObjectId]=useState(defaultUnit??"A203");const [assigneeId,setAssigneeId]=useState(memberships[0]?.id??"");const [priority,setPriority]=useState<"low"|"medium"|"high">("medium");const [dueAt,setDueAt]=useState("2026-07-23");
  return <FormModal title="Nový úkol" close={close} saveLabel="Vytvořit úkol" onSave={async()=>{if(!title.trim())throw new Error("Doplňte název úkolu");await save({title:title.trim(),description:description.trim(),objectType,objectId,assigneeId:assigneeId||null,priority,dueAt});}}><label><span>Název úkolu</span><input autoFocus value={title} onChange={event=>setTitle(event.target.value)} placeholder="Co je potřeba udělat?"/></label><label><span>Popis</span><textarea rows={3} value={description} onChange={event=>setDescription(event.target.value)} placeholder="Kontext a očekávaný výsledek"/></label><div className="form-row"><label><span>Vazba na objekt</span><select value={objectType} onChange={event=>setObjectType(event.target.value)}><option value="unit">Jednotka</option><option value="project">Projekt</option><option value="party">Klient</option><option value="contract">Smlouva</option></select></label><label><span>Označení objektu</span><input value={objectId} onChange={event=>setObjectId(event.target.value)} placeholder="A203"/></label></div><div className="form-row"><label><span>Termín</span><input type="date" value={dueAt} onChange={event=>setDueAt(event.target.value)}/></label><label><span>Odpovědná osoba</span><select value={assigneeId} onChange={event=>setAssigneeId(event.target.value)}>{memberships.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}{!memberships.length&&<option value="">Aktuální uživatel</option>}</select></label><label><span>Priorita</span><select value={priority} onChange={event=>setPriority(event.target.value as "low"|"medium"|"high")}><option value="low">Nízká</option><option value="medium">Střední</option><option value="high">Vysoká</option></select></label></div></FormModal>;
}

function ProfileModal({session,close,openAdmin,canAdmin}:{session:IdentitySession;close:()=>void;openAdmin:()=>void;canAdmin:boolean}){const scopes=session.workspace.projectScopes??[];const [workspaces,setWorkspaces]=useState<Array<{tenantId:string;tenantName:string;tenantSlug:string}>>([]);useEffect(()=>{const controller=new AbortController();identityRepository.listWorkspaces(controller.signal).then(setWorkspaces).catch(()=>undefined);return()=>controller.abort();},[]);return <div className="modal-layer"><button className="modal-scrim" onClick={close} aria-label="Zavřít profil"/><div className="modal profile-modal"><div className="modal-head"><div><h2>Profil a pracovní prostor</h2><p>Přihlášený uživatel a jeho efektivní oprávnění.</p></div><button className="icon-button" onClick={close}><X size={19}/></button></div><div className="profile-summary"><Avatar initials={initials(session.user.displayName)}/><span><strong>{session.user.displayName}</strong><small>{session.user.email}</small></span><Badge tone="success">Aktivní</Badge></div><div className="profile-workspace"><Building2 size={18}/><span><small>PRACOVNÍ PROSTOR</small><strong>{session.workspace.tenantName}</strong></span>{session.workspace.roles.map(role=><Badge key={role} tone="neutral">{roleLabel([role])}</Badge>)}</div>{workspaces.length>1&&<label className="workspace-switch"><span>Přepnout pracovní prostor</span><select defaultValue={session.workspace.tenantId} onChange={()=>window.location.reload()}>{workspaces.map(workspace=><option key={workspace.tenantId} value={workspace.tenantId}>{workspace.tenantName}</option>)}</select></label>}<section className="profile-section"><h3>Projektové rozsahy</h3>{scopes.length?scopes.map(scope=><div key={scope.projectId}><span><strong>{scope.projectName}</strong><small>{scope.roles.map(role=>roleLabel([role])).join(", ")}</small></span></div>):<p>Tenantová role umožňuje práci ve všech dostupných projektech.</p>}</section><div className="profile-actions"><button className="secondary-button" onClick={()=>window.location.reload()}><Settings size={16}/> Nastavení profilu</button>{canAdmin&&<button className="secondary-button" onClick={openAdmin}><ShieldCheck size={16}/> Uživatelé a role</button>}<Link className="secondary-button danger-text" href="/signout-with-chatgpt?return_to=%2F"><LogOut size={16}/> Odhlásit se</Link></div></div></div>}

function MediaModal({value,close,save}:{value:{title:string;kind:"cover"|"floorplan"};close:()=>void;save:(file:File)=>Promise<void>}){const [file,setFile]=useState<File|null>(null);const [preview,setPreview]=useState<string|null>(null);return <FormModal title={value.title} close={close} saveLabel={value.kind==="cover"?"Uložit titulní obrázek":"Uložit půdorys"} onSave={async()=>{if(!file)throw new Error("Vyberte obrázek");await save(file);}}><label className="media-dropzone"><ImagePlus size={25}/><span><strong>Vyberte obrázek</strong><small>JPG, PNG nebo WebP · maximálně 12 MB</small></span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={event=>{const selected=event.target.files?.[0]??null;setFile(selected);setPreview(selected?URL.createObjectURL(selected):null);}}/></label>{preview&&<img className={`media-preview ${value.kind}`} src={preview} alt="Náhled vybraného obrázku"/>}<p className="form-help"><FolderOpen size={14}/> Preview ukládá soubor do R2. Produkční repository je připravené na metadata a budoucí SharePoint external ID.</p></FormModal>}

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
  clients,
  contracts,
  formatMoney,
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
import { commercialRepository, type CommercialSnapshot } from "./repositories/commercial-repository";
import { salesCommandRepository } from "./repositories/sales-command-repository";
import { mediaRepository } from "./repositories/media-repository";
import { taskRepository } from "./repositories/task-repository";
import { clientChangeRepository, type ClientChangeRecord, type NewClientChangeInput } from "./repositories/client-change-repository";
import { activityRepository, recordPreviewActivity, type TimelineRecord } from "./repositories/activity-repository";
import { documentRepository, documentTypeOptions, previewConnection, type DocumentConnectionState, type DocumentRecord, type DocumentStatus, type NewDocumentInput } from "./repositories/document-repository";
import { clientRoute, contractRoute, documentRoute, listParam, pageRoute, parseCrmRoute, projectRoute, unitRoute, updateSearch } from "./crm-routing.mjs";
import {
  CONTRACT_STATUS_ORDER,
  availableContractTransitions,
  contractStatusLabel,
  contractStepIndex,
  normalizeContractStatus,
  recommendedContractAction as deriveContractAction,
} from "../backend/src/shared/contract-workflow";
import { formatPragueDateTime, formatPragueLongDate, PRAGUE_TIME_ZONE, useClock } from "./lib/date-time";
import { stableSort, type SortDirection } from "./lib/sorting";
import { adminRepository, type AdminRole, type AdminSnapshot, type AdminUser } from "./repositories/admin-repository";
import { handoverRepository, type HandoverRecord } from "./repositories/handover-repository";
import { profileRepository, type ProfileInput } from "./repositories/profile-repository";
import { addCalendarDays, formatPragueDate, formatPragueTime, localDateKey } from "./lib/date-time";
import { paymentRepository, paymentStatusLabel, type ImportPreviewRow, type PaymentRecord, type PaymentStatus } from "./repositories/payment-repository";
import { projectSalesPerformanceCount, projectSalesPerformancePercent } from "./lib/project-sales-performance";
import { PROJECT_CONSTRUCTION_PHASES, projectConstructionCode, projectConstructionLabel, projectConstructionStepIndex } from "./lib/project-construction";
import { projectCompletionLabel, projectCompletionMonthValue, projectCompletionStorageDate } from "./lib/project-completion";
import { unitCommercialStatusClass } from "./lib/unit-commercial-status";
import {
  getPermissionDefinition,
  permissionCategoryOrder,
  permissionOperationOrder,
  permissionScopeLabel,
  sortPermissionDefinitions,
} from "./lib/permission-catalog";
import { entraAuth } from "./lib/entra-auth";
import { clientUsesBrowserAdapter } from "./lib/data-mode";

type Page = "dashboard" | "projects" | "clients" | "contracts" | "documents" | "payments" | "handovers" | "tasks" | "admin";
type UnitTab = "overview" | "contracts" | "payments" | "changes" | "documents" | "handover" | "tasks" | "history";
type ProjectTab = "overview" | "units" | "clients" | "contracts" | "payments" | "changes" | "handovers" | "documents";

const navItems: { id: Page; label: string; icon: typeof Home }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "projects", label: "Projekty", icon: Building2 },
  { id: "clients", label: "Klienti", icon: Users },
  { id: "contracts", label: "Dokumenty", icon: FolderOpen },
  { id: "payments", label: "Platby", icon: CircleDollarSign },
  { id: "handovers", label: "Předání", icon: KeyRound },
  { id: "tasks", label: "Úkoly", icon: ClipboardCheck },
];

const pageTitles: Record<Page, { title: string; subtitle: string }> = {
  dashboard: { title: "Dobré ráno, Ivo", subtitle: "Tady je přehled toho, co dnes vyžaduje vaši pozornost." },
  projects: { title: "Projekty", subtitle: "Portfolio developerských projektů a jejich aktuální stav." },
  clients: { title: "Klienti a zájemci", subtitle: "Jedno místo pro kontakty, jednotky a historii zájmu." },
  contracts: { title: "Dokumenty", subtitle: "Smlouvy, ostatní dokumenty a šablony v jednom pracovním prostoru." },
  documents: { title: "Dokumenty", subtitle: "Smlouvy, protokoly a další dokumenty ve všech souvislostech." },
  payments: { title: "Platby", subtitle: "Splátkový kalendář, úhrady a položky vyžadující pozornost." },
  handovers: { title: "Předání", subtitle: "Termíny, připravenost jednotek a otevřené nedodělky." },
  tasks: { title: "Úkoly", subtitle: "Moje práce a automaticky vytvořené úkoly v souvislostech." },
  admin: { title: "Administrace", subtitle: "Uživatelé, role a projektové rozsahy přístupu." },
};

const statusClass = (value: string) => {
  const commercialClass = unitCommercialStatusClass(value);
  if (commercialClass) return commercialClass;
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

function TableColumnFilter({ label, active = false, className = "", children, sortDirection, sortType = "text", onSort }: { label: string; active?: boolean; className?: string; children?: React.ReactNode; sortDirection?: SortDirection; sortType?: "text"|"number"|"date"; onSort?: (direction: SortDirection) => void }) {
  const [open,setOpen]=useState(false); const root=useRef<HTMLTableCellElement>(null);
  useEffect(()=>{const close=(event:MouseEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false)};document.addEventListener("mousedown",close);return()=>document.removeEventListener("mousedown",close)},[]);
  const sortLabels=sortType==="number"?["Od nejnižšího","Od nejvyššího"]:sortType==="date"?["Od nejstaršího","Od nejnovějšího"]:["A → Z","Z → A"];
  const interactive=Boolean(children||onSort);
  return <th ref={root} className={`column-filter ${active ? "active" : ""} ${sortDirection ? "sorted" : ""} ${open ? "open" : ""} ${className}`.trim()}>{interactive?<><button type="button" className="column-filter-heading" onClick={()=>setOpen(value=>!value)} aria-expanded={open} aria-label={`Řadit nebo filtrovat: ${label}`}><span>{label}</span>{sortDirection&&<b aria-label={sortDirection==="asc"?"Vzestupně":"Sestupně"}>{sortDirection==="asc"?"↑":"↓"}</b>}<ChevronDown className="column-filter-chevron" size={12}/>{active&&<i />}</button>{open&&<span className="column-filter-control">{onSort&&<span className="column-sort-actions"><button type="button" className={sortDirection==="asc"?"active":""} onClick={()=>{onSort("asc");setOpen(false)}}>{sortLabels[0]}</button><button type="button" className={sortDirection==="desc"?"active":""} onClick={()=>{onSort("desc");setOpen(false)}}>{sortLabels[1]}</button></span>}{children&&<span className="column-filter-options">{children}</span>}</span>}</>:<span className="column-filter-heading plain"><span>{label}</span></span>}</th>;
}

function ListColumnFilter({ label, active = false, className = "", children, sortDirection, sortType = "text", onSort }: { label: string; active?: boolean; className?: string; children?: React.ReactNode; sortDirection?: SortDirection; sortType?: "text"|"number"|"date"; onSort?: (direction: SortDirection) => void }) {
  const [open,setOpen]=useState(false);const root=useRef<HTMLSpanElement>(null);
  useEffect(()=>{const close=(event:MouseEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false)};document.addEventListener("mousedown",close);return()=>document.removeEventListener("mousedown",close)},[]);
  const sortLabels=sortType==="number"?["Od nejnižšího","Od nejvyššího"]:sortType==="date"?["Nejbližší první","Nejvzdálenější první"]:["A → Z","Z → A"];
  const interactive=Boolean(children||onSort);
  return <span ref={root} role="columnheader" className={`list-column-filter column-filter ${active?"active":""} ${sortDirection?"sorted":""} ${open?"open":""} ${className}`.trim()}>{interactive?<><button type="button" className="column-filter-heading" onClick={()=>setOpen(value=>!value)} aria-expanded={open} aria-label={`Řadit nebo filtrovat: ${label}`}><span>{label}</span>{sortDirection&&<b aria-label={sortDirection==="asc"?"Vzestupně":"Sestupně"}>{sortDirection==="asc"?"↑":"↓"}</b>}<ChevronDown className="column-filter-chevron" size={12}/>{active&&<i/>}</button>{open&&<span className="column-filter-control">{onSort&&<span className="column-sort-actions"><button type="button" className={sortDirection==="asc"?"active":""} onClick={()=>{onSort("asc");setOpen(false)}}>{sortLabels[0]}</button><button type="button" className={sortDirection==="desc"?"active":""} onClick={()=>{onSort("desc");setOpen(false)}}>{sortLabels[1]}</button></span>}{children&&<span className="column-filter-options">{children}</span>}</span>}</>:<span className="column-filter-heading plain"><span>{label}</span></span>}</span>;
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

/** Přechodová kompatibilita pro seznamy, které nejsou tabulkou. Vizuální řazení je záměrně pouze v hlavičkách tabulek. */
function SortControl(props: { value: string; direction: SortDirection; options: Array<{ value: string; label: string }>; onChange: (value: string, direction: SortDirection) => void }) {
  void props; return null;
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

function ensurePilotPreviewStorage(){
  if(typeof window==="undefined"||localStorage.getItem("develocrm.pilot-cleanup")==="v1")return;
  for(const key of [
    "develocrm-preview-payments-v2","develocrm.admin.v32","develocrm.documents.created",
    "develocrm.documents.edits","develocrm.catalog.edits","develocrm.accessory.assignments",
    "develocrm.sales.commands","develocrm.contract.edits","develocrm.contract.edits.v31",
    "develocrm.price.edits","develocrm.price.proposals.v32","develocrm.preview.audit",
    "develocrm-read-notifications",
  ])localStorage.removeItem(key);
  localStorage.setItem("develocrm.pilot-cleanup","v1");
}

export default function CRMApp() {
  ensurePilotPreviewStorage();
  const router=useRouter();
  const pathname=usePathname();
  const searchParams=useSearchParams();
  const [identitySession, setIdentitySession] = useState<IdentitySession>(prototypeSession);
  const [catalogVersion, setCatalogVersion] = useState(0);
  const [catalogReloadKey, setCatalogReloadKey] = useState(0);
  const [connectionRetryKey,setConnectionRetryKey]=useState(0);
  const [startupError,setStartupError]=useState<string|null>(null);
  const [clientDataVersion, setClientDataVersion] = useState(0);
  const [clientReloadKey, setClientReloadKey] = useState(0);
  const [, setCommercialDataVersion] = useState(0);
  const [priceProposals,setPriceProposals]=useState<NonNullable<CommercialSnapshot["priceProposals"]>>([]);
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
  const [notificationPayments,setNotificationPayments]=useState<PaymentRecord[]>([]);
  const [taskOpenCount,setTaskOpenCount]=useState(initialTasks.filter(item=>!item.done&&item.owner==="Iva").length);
  const [taskScope,setTaskScope]=useState<"mine"|"all"|"completed">("mine");
  const [taskLoading,setTaskLoading]=useState(false);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [newProjectOpen,setNewProjectOpen]=useState(false);
  const [newClientOpen,setNewClientOpen]=useState(false);
  const [newHandoverOpen,setNewHandoverOpen]=useState(false);
  const [newContractOpen,setNewContractOpen]=useState(false);
  const [handoverReloadKey,setHandoverReloadKey]=useState(0);
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
  const [contractVersionEdit,setContractVersionEdit]=useState<(typeof contracts)[number]|null>(null);
  const [contractSignatureEdit,setContractSignatureEdit]=useState<{contract:(typeof contracts)[number];partyId:string;versionId:string;partyName:string}|null>(null);
  const [routedContractId,setRoutedContractId]=useState<string|null>(null);
  const [routedDocumentId,setRoutedDocumentId]=useState<string|null>(null);
  const [newDocumentOpen,setNewDocumentOpen]=useState(false);
  const [documentEdit,setDocumentEdit]=useState<DocumentRecord|null>(null);
  const [documentVersionEdit,setDocumentVersionEdit]=useState<DocumentRecord|null>(null);
  const [documentReloadKey,setDocumentReloadKey]=useState(0);
  const [profileOpen,setProfileOpen]=useState(false);
  const [profileSettingsOpen,setProfileSettingsOpen]=useState(false);
  const [notificationsOpen,setNotificationsOpen]=useState(false);
  const [helpOpen,setHelpOpen]=useState(false);
  const [issueOpen,setIssueOpen]=useState(false);
  const [readNotifications,setReadNotifications]=useState<Set<string>>(()=>{if(typeof window==="undefined")return new Set();try{return new Set(JSON.parse(localStorage.getItem("develocrm-read-notifications")??"[]"))}catch{return new Set()}});
  const [mediaEdit,setMediaEdit]=useState<{entityType:"project"|"unit";entityId:string;kind:"cover"|"floorplan";title:string;unitKey?:string}|null>(null);
  const [documentConnection,setDocumentConnection]=useState<DocumentConnectionState>(previewConnection);
  const now=useClock();
  const can=(permission:string)=>{
    const aliases:Record<string,string[]>={"project.manage":["projects.update"],"unit.manage":["units.update"],"accessory.manage":["accessories.update"],"clients.manage":["clients.update"],"contract.manage":["contracts.update"],"documents.edit_metadata":["documents.update"],"documents.upload":["documents.create"],"price.manage":["prices.propose"],"holds.manage":["holds.confirm"],"handover.manage":["handovers.manage"]};
    return identitySession.workspace.permissions.includes(permission)||(aliases[permission]??[]).some(code=>identitySession.workspace.permissions.includes(code));
  };
  const routeSearch=searchParams.toString();
  const routeState=useMemo(()=>parseCrmRoute(pathname,routeSearch),[pathname,routeSearch]);

  useEffect(()=>{
    if(routeState.kind==="not-found"){router.replace("/dashboard");return;}
    if(routeState.kind==="legacy-documents"){router.replace(updateSearch("/contracts",routeSearch,{view:"documents"}));return;}
    if(routeState.kind==="legacy-document"&&routeState.documentId){router.replace(documentRoute(routeState.documentId));return;}
    // Frameworkový router je externí zdroj pravdy; lokální stav pouze promítá právě obnovenou URL.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(routeState.page as Page);
    setSearch(routeState.params.get("q")??"");
    if(routeState.params.get("q"))setSearchFocused(true);
    setProfileOpen(false);
    setRoutedContractId(routeState.kind==="contract"?routeState.contractId??null:null);
    setRoutedDocumentId(routeState.kind==="document"?routeState.documentId??null:null);
    if(routeState.page==="tasks")setTaskScope((routeState.taskScope??"mine") as "mine"|"all"|"completed");

    if(routeState.kind==="project"){
      const project=projects.find(item=>projectRouteId(item)===routeState.projectId);
      setSelectedProject(project??null);if(project)setProjectFilter(project.name);
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
      setUnitDetail(unit??null);if(unit){const project=projects.find(item=>unitBelongsToProject(unit,item))??null;setSelectedProject(project);setProjectFilter(project?.name??unit.project);}else setSelectedProject(null);
      setProjectTab("units");setUnitTab((routeState.unitTab??"overview") as UnitTab);setUnitPreview(null);setSelectedClientName(null);
    }else if(routeState.kind==="client"){
      const client=clients.find(item=>item.id===routeState.clientId);
      setSelectedClientName(client?.name??null);setSelectedProject(null);setUnitDetail(null);setUnitPreview(null);
    }else{
      setSelectedProject(null);setUnitDetail(null);setUnitPreview(null);
      setSelectedClientName(null);
    }
  },[routeState,catalogVersion,clientDataVersion,router]);

  useEffect(() => {
    const controller = new AbortController();
    identityRepository.getSession(controller.signal).then(session=>{setIdentitySession({...session,user:profileRepository.hydrate(session.user)});setStartupError(null);}).catch(error=>{if(!controller.signal.aborted)setStartupError(error instanceof Error?error.message:"Přihlášení není dostupné");});
    return () => controller.abort();
  }, [connectionRetryKey]);

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
      setPriceProposals(snapshot.priceProposals??[]);
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
    }).catch(error=>{if(!controller.signal.aborted)setStartupError(error instanceof Error?error.message:"Data aplikace nejsou dostupná");});
    return () => controller.abort();
  }, [catalogReloadKey,connectionRetryKey]);

  useEffect(()=>{const controller=new AbortController();taskRepository.list(taskScope,identitySession.user.displayName,controller.signal).then(saved=>{setTaskRows(saved);if(taskScope==="mine")setTaskOpenCount(saved.filter(item=>!item.done).length);else void taskRepository.list("mine",identitySession.user.displayName,controller.signal).then(mine=>setTaskOpenCount(mine.filter(item=>!item.done).length));}).catch(()=>{if(clientUsesBrowserAdapter()){const fallback=taskScope==="completed"?initialTasks.filter(item=>item.done):taskScope==="all"?initialTasks:initialTasks.filter(item=>!item.done&&item.owner==="Iva");setTaskRows(fallback);setTaskOpenCount(initialTasks.filter(item=>!item.done&&item.owner==="Iva").length);}else{setTaskRows([]);setTaskOpenCount(0);}}).finally(()=>setTaskLoading(false));return()=>controller.abort();},[taskScope,identitySession.user.displayName]);
  useEffect(()=>{const controller=new AbortController();paymentRepository.list({},controller.signal).then(result=>setNotificationPayments(result.payments)).catch(()=>setNotificationPayments([]));return()=>controller.abort();},[commercialReloadKey]);

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
    const projectResults=projects.filter(project=>`${project.name} ${project.location} ${project.code}`.toLowerCase().includes(query)).slice(0,3).map(project=>({type:"Projekt",title:project.name,detail:project.location,project}));
    const unitResults = units
      .filter((unit) => `${unit.id} ${unit.client || ""} ${unit.project}`.toLowerCase().includes(query))
      .slice(0, 4)
      .map((unit) => ({ type: "Jednotka", title: unit.id, detail: `${unit.layout} · ${unit.project}`, unit }));
    const clientResults = clients
      .filter((client) => `${client.name} ${client.contact}`.toLowerCase().includes(query))
      .slice(0, 3)
      .map((client) => ({ type: "Klient", title: client.name, detail: client.projects, unit: undefined }));
    const contractResults=contracts.filter(contract=>`${contract.reference??contract.id??""} ${contract.client} ${contract.unit} ${contract.project}`.toLowerCase().includes(query)).slice(0,3).map(contract=>({type:"Smlouva",title:contract.reference??contract.id??`${contract.type} · ${contract.unit}`,detail:`${contract.client} · ${contract.unit}`,contract}));
    const documentResults=contracts.filter(contract=>`${contract.reference??contract.id??""} ${contract.type} ${contract.client}`.toLowerCase().includes(query)).slice(0,2).map(contract=>({type:"Dokument",title:`${contract.type} · ${contract.reference??contract.id??contract.unit}`,detail:contract.project,contract}));
    return [...projectResults,...unitResults, ...clientResults,...contractResults,...documentResults];
  }, [search, catalogVersion, clientDataVersion]);

  const notifications=useMemo(()=>[
    ...taskRows.filter(item=>!item.done).slice(0,4).map(item=>({id:`task-${item.id}`,title:item.title,detail:`Úkol · ${item.due}`,page:"tasks" as Page})),
    ...contracts.filter(item=>["Odeslána","Ve vyjednávání","K podpisu"].includes(item.state)).slice(0,3).map(item=>({id:`contract-${item.id??item.reference??item.unit}`,title:`${item.type} ${item.reference??item.id??item.unit}`,detail:`${item.state} · ${item.unit}`,contract:item})),
    ...notificationPayments.filter(item=>item.status==="overdue").slice(0,2).map(item=>({id:`payment-${item.id}`,title:`Platba po splatnosti · ${item.unit}`,detail:item.client,page:"payments" as Page}))
  ],[taskRows,notificationPayments,commercialReloadKey]);
  const unreadCount=notifications.filter(item=>!readNotifications.has(item.id)).length;
  const markNotification=(id:string)=>setReadNotifications(current=>{const next=new Set(current).add(id);localStorage.setItem("develocrm-read-notifications",JSON.stringify([...next]));return next;});

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
  const openDocument=(document:DocumentRecord|string)=>router.push(documentRoute(typeof document==="string"?document:document.id));
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

  const saveTask = async (value:{title:string;description:string;target:TaskTarget;assigneeMembershipId:string;priority:"low"|"medium"|"high";dueAt:string}) => {
    const link={projectId:value.target.projectId};
    if(value.target.kind==="unit")Object.assign(link,{unitId:value.target.id});
    if(value.target.kind==="party")Object.assign(link,{partyId:value.target.id});
    if(value.target.kind==="contract")Object.assign(link,{contractId:value.target.id});
    const created=await taskRepository.create({title:value.title,description:value.description,...link,objectLabel:value.target.label,assigneeMembershipId:value.assigneeMembershipId,priority:value.priority,dueAt:value.dueAt},identitySession.user.displayName);
    setTaskRows((rows) => [created, ...rows]);if(created.owner==="Iva"||created.owner===identitySession.user.displayName)setTaskOpenCount(count=>count+1);setNewTaskOpen(false);notify(`Úkol „${value.title}“ byl vytvořen`);
    if(value.target.kind==="unit"){recordPreviewActivity({unitKey:value.target.id,title:"Vytvořen úkol",detail:`${identitySession.user.displayName} · ${value.title}`,action:"task.created"});setActivityReloadKey(key=>key+1);}
  };

  if(startupError)return <div className="service-unavailable"><div className="card"><span className="attention-type danger"><AlertTriangle size={22}/></span><h1>DeveloCRM se nemůže připojit</h1><p>{startupError}</p><p>Vaše data nebyla nahrazena lokální kopií. Zkontrolujte připojení nebo zkuste načtení zopakovat.</p><button className="primary-button" onClick={()=>{setStartupError(null);setConnectionRetryKey(key=>key+1);}}><Activity size={16}/> Zkusit znovu</button></div></div>;

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
            {searchFocused && search.length >= 2 && (
              <div className="search-results">
                <p>Výsledky podle agendy</p>
                {searchResults.length ? searchResults.map((result, index) => (
                  <button key={`${result.type}-${result.title}-${index}`} onClick={() => {if("unit" in result&&result.unit)openUnit(result.unit);else if("project" in result&&result.project)openProject(result.project);else if("contract" in result&&result.contract)openContract(result.contract);else openClient(result.title);setSearchFocused(false)}}>
                    <span className="search-result-icon">{result.type === "Jednotka" ? <Home size={17} /> : result.type==="Projekt"?<Building2 size={17}/>:result.type==="Klient"?<UserRound size={17}/>:<FileText size={17}/>}</span>
                    <span><strong>{result.title}</strong><small>{result.detail}</small></span>
                    <Badge tone="neutral">{result.type}</Badge>
                  </button>
                )) : <div className="empty-search">Nic jsme nenašli. Zkuste jiný výraz.</div>}
              </div>
            )}
          </div>
          <div className="topbar-actions">
            <div className="topbar-popover-root"><button className={`icon-button ${helpOpen?"active":""}`} aria-label="Nápověda" aria-expanded={helpOpen} onClick={()=>{setHelpOpen(value=>!value);setNotificationsOpen(false)}}><span className="help-icon">?</span></button>{helpOpen&&<div className="topbar-popover help-popover"><strong>Nápověda k této stránce</strong><p>{pageTitles[page].subtitle}</p><button onClick={()=>{setHelpOpen(false);setIssueOpen(true)}}><MessageSquare size={16}/> Nahlásit problém</button><button onClick={()=>notify("DeveloCRM · interní pilotní verze")}><CircleDollarSign size={16}/> O aplikaci</button></div>}</div>
            <div className="topbar-popover-root"><button className={`icon-button bell-button ${notificationsOpen?"active":""}`} aria-label={`Oznámení, ${unreadCount} nepřečtených`} aria-expanded={notificationsOpen} onClick={()=>{setNotificationsOpen(value=>!value);setHelpOpen(false)}}><Bell size={19} />{unreadCount>0&&<span className="notification-count">{unreadCount}</span>}</button>{notificationsOpen&&<div className="topbar-popover notification-popover"><div className="popover-head"><strong>Oznámení</strong>{unreadCount>0&&<button onClick={()=>{const next=new Set(notifications.map(item=>item.id));setReadNotifications(next);localStorage.setItem("develocrm-read-notifications",JSON.stringify([...next]))}}>Označit vše jako přečtené</button>}</div>{notifications.length?notifications.map(item=><button className={readNotifications.has(item.id)?"read":""} key={item.id} onClick={()=>{markNotification(item.id);setNotificationsOpen(false);if("contract" in item&&item.contract)openContract(item.contract);else if("page" in item&&item.page)navigate(item.page)}}><i/><span><strong>{item.title}</strong><small>{item.detail}</small></span><ChevronRight size={15}/></button>):<p>Nemáte žádná nová oznámení.</p>}<button className="show-all" onClick={()=>{setNotificationsOpen(false);navigate("tasks")}}>Zobrazit vše</button></div>}</div>
            <button className="topbar-profile-button" onClick={()=>setProfileOpen(true)} aria-label="Otevřít uživatelské menu"><Avatar initials={initials(identitySession.user.displayName)} small /></button>
          </div>
        </header>

        <main className="main-content">
          {unitDetail ? (
            <UnitDetail unit={unitDetail} tab={unitTab} onTab={navigateUnitTab} onBack={() => selectedProject&&router.push(projectRoute(projectRouteId(selectedProject),"units"))} openProjects={()=>router.push("/projects")} openProject={()=>selectedProject&&router.push(projectRoute(projectRouteId(selectedProject)))} notify={notify} openTask={() => setNewTaskOpen(true)} openClient={openClient} openContract={openContract} onNewContract={can("contracts.create")?()=>setNewContractOpen(true):undefined} onEdit={(can("units.update")||can("unit.manage"))?()=>setUnitEdit(unitDetail):undefined} onEditPrice={(can("prices.propose")||can("price.manage"))?()=>setPriceEdit(unitDetail):undefined} priceProposals={priceProposals.filter(proposal=>proposal.unit===unitDetail.id&&proposal.status==="pending")} onDecidePrice={can("prices.approve")?async(proposalId,decision)=>{const verb=decision==="approved"?"schválit":"zamítnout";if(!window.confirm(`Opravdu ${verb} tento návrh ceny?`))return;await commercialRepository.decidePrice({proposalId,decision,reason:decision==="approved"?"Schváleno jednatelem":"Zamítnuto jednatelem",actorName:identitySession.user.displayName});notify(decision==="approved"?"Návrh ceny byl schválen":"Návrh ceny byl zamítnut");refreshCommercial();}:undefined} onManageAccessories={(can("accessories.update")||can("accessory.manage"))?()=>setAccessoryUnit(unitDetail):undefined} onEditFloorplan={(can("media.manage")||can("units.update")||can("unit.manage"))?()=>setMediaEdit({entityType:"unit",entityId:unitDetail.backendId??unitDetail.id,unitKey:unitDetail.id,kind:"floorplan",title:`Půdorys · ${unitDetail.id}`}):undefined} onSalesAction={(can("holds.create")||can("holds.cancel")||can("holds.confirm")||can("interests.manage"))?(mode)=>setSalesAction({unit:unitDetail,mode}):undefined} canCreateHold={can("holds.create")||can("holds.manage")} canConfirmHold={can("holds.confirm")||can("holds.manage")} canCancelHold={can("holds.cancel")||can("holds.manage")} onContractWorkflow={(can("contracts.update")||can("contract.manage"))?setContractEdit:undefined} timelineVersion={catalogReloadKey+clientReloadKey+commercialReloadKey+activityReloadKey} />
          ) : selectedProject ? (
            <ProjectDetail
              project={selectedProject}
              taskRows={taskRows}
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
              onEditProject={(can("projects.update")||can("project.manage"))?() => setProjectEdit(selectedProject):undefined}
              onEditCover={(can("media.manage")||can("project.manage"))&&backendEntityId(selectedProject.backendId)?()=>setMediaEdit({entityType:"project",entityId:selectedProject.backendId!,kind:"cover",title:`Titulní obrázek · ${selectedProject.name}`}):undefined}
              onNewClient={can("clients.create")?()=>setNewClientOpen(true):undefined}
            />
          ) : (
            <>
              <div className="page-header">
                <div>
                  <div className="eyebrow">{now?formatPragueLongDate(now).toLocaleUpperCase("cs-CZ"):"AKTUÁLNÍ PRACOVNÍ PŘEHLED"}</div>
                  <h1>{page === "dashboard" ? `Dobré ráno, ${vocativeFirstName(identitySession.user.displayName)}` : pageTitles[page].title}</h1>
                </div>
                <div className="page-actions">
                  {page === "projects" && <button className="secondary-button" onClick={() => notify("Ceník se připravuje ke stažení")}><Download size={17} /> Export ceníku</button>}
                  {page !== "admin"&&page!=="payments"&&(page!=="projects"||can("projects.create"))&&(page!=="clients"||can("clients.create"))&&(page!=="handovers"||can("handovers.manage"))&&(page!=="contracts"||(searchParams.get("view")==="documents"?can("documents.create"):can("contracts.create")))&&<button className="primary-button" onClick={() => page === "tasks" || page === "dashboard" ? setNewTaskOpen(true) : page==="projects"?setNewProjectOpen(true):page==="clients"?setNewClientOpen(true):page==="handovers"?setNewHandoverOpen(true):page==="contracts"&&searchParams.get("view")==="documents"?setNewDocumentOpen(true):page==="contracts"?setNewContractOpen(true):notify("Nový záznam lze nyní založit")}>
                    <Plus size={18} /> {page === "tasks" ? "Nový úkol" : page === "clients" ? "Nový klient" : page === "contracts" ? searchParams.get("view")==="documents"?"Nový dokument":"Nová smlouva" : page === "payments" ? "Přidat platbu" : page === "handovers" ? "Naplánovat předání" : page === "projects" ? "Nový projekt" : "Přidat úkol"}
                  </button>}
                </div>
              </div>

              {page === "dashboard" && <Dashboard navigate={navigate} openUnit={openUnit} taskRows={taskRows} toggleTask={toggleTask} />}
              {page === "projects" && <Projects openProject={openProject} />}
              {page === "clients" && <ClientsPage openUnit={openUnit} openProject={project=>router.push(projectRoute(projectRouteId(project)))} selectedClientName={selectedClientName} setSelectedClientName={(value)=>value?openClient(value):router.push("/clients")} notify={notify} onEditClient={can("clients.update")?setClientEdit:undefined} />}
              {page === "contracts" && <ContractsAndDocumentsPage view={searchParams.get("view")??(routedDocumentId?"documents":"contracts")} setView={view=>router.push(updateSearch("/contracts",searchParams.toString(),{view:view==="contracts"?"":view}))} openUnit={openUnit} openClient={openClient} openContract={openContract} closeContract={()=>router.push("/contracts")} selectedContractId={routedContractId} notify={notify} onWorkflow={can("contract.manage")?setContractEdit:undefined} onContractVersion={can("contracts.update")?setContractVersionEdit:undefined} onContractSignature={can("contracts.record_signature")?(contract,partyId,versionId,partyName)=>setContractSignatureEdit({contract,partyId,versionId,partyName}):undefined} openDocument={openDocument} selectedDocumentId={routedDocumentId} closeDocument={()=>router.push(updateSearch("/contracts",searchParams.toString(),{view:"documents"}))} reloadKey={documentReloadKey} onEditDocument={can("documents.edit_metadata")?setDocumentEdit:undefined} onNewVersion={can("documents.upload")?setDocumentVersionEdit:undefined}/>} 
              {page === "payments" && <PaymentsPage openUnit={openUnit} notify={notify} canRecord={can("payments.record")||can("payments.manage")} canReverse={can("payments.reverse")} canImport={can("payments.import")||can("payments.manage")} />}
              {page === "handovers" && <HandoversPage openUnit={unit=>router.push(unitRoute(unitRouteId(unit),"handover"))} notify={notify} reloadKey={handoverReloadKey} />}
              {page === "tasks" && <TasksPage rows={taskRows} toggleTask={toggleTask} openUnit={openUnit} scope={taskScope} onScope={updateTaskScope} loading={taskLoading} />}
          {page === "admin" && (can("users.manage")||can("roles.manage")) && <AdminUsersPage notify={notify}/>}
            </>
          )}
        </main>
      </div>

      {unitPreview && <UnitPreview unit={unitPreview} close={() => setUnitPreview(null)} open={() => openUnit(unitPreview)} previous={() => browsePreview(-1)} next={() => browsePreview(1)} position={Math.max(1, filteredUnits.findIndex((item) => item.id === unitPreview.id) + 1)} total={filteredUnits.length} />}
      {unitPreview && <button className="panel-scrim" aria-label="Zavřít náhled" onClick={() => setUnitPreview(null)} />}
      {newTaskOpen && <TaskModal close={() => setNewTaskOpen(false)} save={saveTask} memberships={catalogMemberships} targets={taskTargetOptions()} defaultUnit={unitDetail?.backendId} />}
      {newProjectOpen&&<NewProjectModal memberships={catalogMemberships} close={()=>setNewProjectOpen(false)} save={async value=>{const created=await catalogRepository.createProject({...value,slug:slugifyProject(value.name)});setNewProjectOpen(false);notify(`Projekt „${value.name}“ byl založen`);refreshCatalog();router.push(projectRoute(created.id));}}/>}
      {newClientOpen&&<NewClientModal projects={projects.filter(project=>Boolean(project.backendId))} close={()=>setNewClientOpen(false)} save={async value=>{const created=await clientRepository.createParty(value);setNewClientOpen(false);notify("Klient byl vytvořen");refreshClients();router.push(clientRoute(created.id));}}/>}
      {newHandoverOpen&&<HandoverScheduleModal units={units.filter(unit=>Boolean(unit.backendId))} memberships={catalogMemberships} close={()=>setNewHandoverOpen(false)} save={async value=>{await handoverRepository.schedule(value);setNewHandoverOpen(false);setHandoverReloadKey(key=>key+1);notify("Předání bylo naplánováno");}}/>}
      {newContractOpen&&<NewContractModal units={units} close={()=>setNewContractOpen(false)} save={async value=>{const created=await commercialRepository.createContract(value);setNewContractOpen(false);refreshCommercial();notify("Smlouva byla vytvořena");router.push(contractRoute(created.id));}}/>}
      {contractVersionEdit&&<ContractVersionModal contract={contractVersionEdit} close={()=>setContractVersionEdit(null)} save={async value=>{if(!contractVersionEdit.id)throw new Error("Smlouva nemá backendový identifikátor");await commercialRepository.createContractVersion({contractId:contractVersionEdit.id,...value});setContractVersionEdit(null);refreshCommercial();notify("Nová logická verze smlouvy byla vytvořena");}}/>}
      {contractSignatureEdit&&<ContractSignatureModal value={contractSignatureEdit} close={()=>setContractSignatureEdit(null)} save={async reason=>{const result=await commercialRepository.recordContractSignature({contractPartyId:contractSignatureEdit.partyId,versionId:contractSignatureEdit.versionId,reason});setContractSignatureEdit(null);refreshCommercial();notify(result.completed?"Smlouva byla podepsána všemi účastníky a vznikl platební předpis":"Podpis účastníka byl zaznamenán");}}/>}
      {profileOpen&&<ProfileModal session={identitySession} close={()=>setProfileOpen(false)} openSettings={()=>{setProfileOpen(false);setProfileSettingsOpen(true);}} openAdmin={()=>{setProfileOpen(false);router.push("/admin/users");}} canAdmin={can("users.manage")||identitySession.workspace.roles.includes("admin")}/>}
      {profileSettingsOpen&&<ProfileSettingsModal user={identitySession.user} close={()=>setProfileSettingsOpen(false)} save={async value=>{const user=await profileRepository.update(value);setIdentitySession(current=>({...current,user}));setProfileSettingsOpen(false);notify("Nastavení profilu bylo uloženo");}}/>}
      {issueOpen&&<IssueReportModal page={page} close={()=>setIssueOpen(false)} save={async value=>{const issues=JSON.parse(localStorage.getItem("develocrm-issues")??"[]");issues.unshift({id:crypto.randomUUID(),...value,route:pathname,createdAt:new Date().toISOString(),status:"new"});localStorage.setItem("develocrm-issues",JSON.stringify(issues));setIssueOpen(false);notify("Problém byl odeslán interní podpoře");}}/>}
      {mediaEdit&&<MediaModal value={mediaEdit} close={()=>setMediaEdit(null)} save={async file=>{const media=await mediaRepository.upload(mediaEdit.entityType,mediaEdit.entityId,mediaEdit.kind,file);if(mediaEdit.entityType==="project"){setSelectedProject(current=>current?{...current,coverImageUrl:media.url}:current);}else{setUnitDetail(current=>current?{...current,floorplanAvailable:true,floorplanImageUrl:media.url}:current);recordPreviewActivity({unitKey:mediaEdit.unitKey??mediaEdit.entityId,title:"Změněn půdorys jednotky",detail:`${identitySession.user.displayName} · ${file.name}`,icon:"document",action:"unit.floorplan_changed"});setActivityReloadKey(key=>key+1);}setMediaEdit(null);notify("Obrázek byl uložen");}}/>}
      {projectEdit && <EditProjectModal project={projectEdit} memberships={catalogMemberships} canChangeManager={can("projects.change_manager")} canChangeStatus={can("projects.change_status")} close={() => setProjectEdit(null)} save={async (value) => { const id=backendEntityId(projectEdit.backendId);if(!id)throw new Error("Projekt nemá platný databázový identifikátor");await catalogRepository.updateProject({id,name:value.name,location:value.location,lifecycleStatus:value.lifecycleStatus,managerMembershipId:value.managerMembershipId,plannedHandoverFrom:value.plannedCompletion,plannedHandoverTo:null});if(value.stageCode!==(projectEdit.stageCode??projectConstructionCode(projectEdit.stage)))await catalogRepository.recordProjectConstructionStatus({projectId:id,statusCode:value.stageCode,note:value.stageReason||"Aktualizace fáze projektu"}); setSelectedProject({...projectEdit,name:value.name,location:value.location,lifecycleStatus:value.lifecycleStatus,managerMembershipId:value.managerMembershipId,manager:catalogMemberships.find(item=>item.id===value.managerMembershipId)?.name??"—",stage:projectConstructionLabel(value.stageCode),stageCode:value.stageCode,plannedCompletionFrom:value.plannedCompletion,plannedCompletionTo:null,plannedHandover:projectCompletionLabel(value.plannedCompletion)}); setProjectEdit(null); notify("Projekt byl uložen"); refreshCatalog(); }} />}
      {unitEdit && <EditUnitModal unit={unitEdit} structures={catalogStructures.filter(item=>item.project===unitEdit.project)} close={() => setUnitEdit(null)} save={async (value) => { await catalogRepository.updateUnit({id: unitEdit.backendId??unitEdit.id,...value}); setUnitDetail({...unitEdit,structureId:value.structureId,building:catalogStructures.find(item=>item.id===value.structureId)?.name??"Bez zařazení",layout:value.layout,area:value.areaM2,usableArea:value.usableAreaM2,floor:value.floorLabel,orientation:value.orientation,balcony:value.balconyM2,terrace:value.terraceM2,garden:value.gardenM2}); setUnitEdit(null); notify("Jednotka byla uložena"); refreshCatalog(); }} />}
      {priceEdit && <EditPriceModal unit={priceEdit} close={() => setPriceEdit(null)} save={async (value) => { await commercialRepository.recordPrice({unitId:priceEdit.backendId??priceEdit.id,unitKey:priceEdit.id,actorName:identitySession.user.displayName,...value}); setPriceEdit(null); notify("Návrh ceny byl odeslán ke schválení"); refreshCommercial(); }} />}
      {accessoryUnit&&<AccessoryModal unit={accessoryUnit} inventory={catalogAccessories.filter(item=>item.project===accessoryUnit.project)} close={()=>setAccessoryUnit(null)} assign={async accessory=>{await catalogRepository.assignAccessory(accessoryUnit.backendId??accessoryUnit.id,accessory.id);notify(`${accessory.type} ${accessory.code} bylo přiřazeno`);setAccessoryUnit(null);refreshCatalog();}} remove={async assignment=>{if(!window.confirm(`Opravdu uvolnit ${assignment.type} ${assignment.code}?`))return;await catalogRepository.removeAccessory(assignment.assignmentId??assignment.id);notify(`${assignment.type} ${assignment.code} bylo uvolněno`);setAccessoryUnit(null);refreshCatalog();}}/>}
      {salesAction&&<SalesActionModal action={salesAction} clientRows={clients} close={()=>setSalesAction(null)} save={async value=>{const unitId=salesAction.unit.backendId??salesAction.unit.id;const unitKey=salesAction.unit.id;const context=unitCommercialContexts[unitKey]??{buyers:[],interests:[],stage:null,hold:null};let nextStatus:UnitStatus|undefined;if(salesAction.mode==="interest"){await salesCommandRepository.addInterest({unitId,unitKey,partyId:value.partyId,eventType:"inquiry",note:value.reason});const party=clients.find(item=>item.id===value.partyId);if(party&&!context.interests.some(item=>item.partyId===party.id))context.interests.unshift({date:new Date().toLocaleDateString("cs-CZ"),partyId:party.id,name:party.name,type:"Aktivní zájem",result:"Aktivní"});}else if(salesAction.mode==="convert"&&context.hold){await salesCommandRepository.convertHold({holdId:context.hold.id,unitKey,expiresAt:value.expiresAt,reason:value.reason});context.hold={...context.hold,type:"reservation",expiresAt:value.expiresAt};context.stage="reservation";nextStatus="RS";}else if(salesAction.mode==="cancel"&&context.hold){await salesCommandRepository.cancelHold({holdId:context.hold.id,unitKey,reason:value.reason});context.hold=null;context.stage="interest";nextStatus="Volný";}else{await salesCommandRepository.createHold({unitId,unitKey,type:salesAction.mode as "pre_reservation"|"reservation",partyIds:[value.partyId],expiresAt:value.expiresAt,reason:value.reason});context.hold={id:`local-${Date.now()}`,type:salesAction.mode,expiresAt:value.expiresAt};context.stage=salesAction.mode;nextStatus=salesAction.mode==="reservation"?"RS":"Předrezervace";}unitCommercialContexts[unitKey]=context;if(nextStatus)setUnitDetail(current=>current?.id===unitKey?{...current,status:nextStatus}:current);setSalesAction(null);notify("Obchodní operace byla dokončena");refreshClients();if(salesAction.mode!=="interest")refreshCatalog();}}/>}
      {contractEdit&&<ContractWorkflowModal contract={contractEdit} close={()=>setContractEdit(null)} save={async value=>{if(!contractEdit.id)throw new Error("Smlouva nemá backendový identifikátor");const from=contractEdit.statusCode??normalizeContractStatus(contractEdit.state);const occurredAt=new Date().toISOString();await commercialRepository.transitionContract({contractId:contractEdit.id,to:value.to,reason:value.reason,actorName:identitySession.user.displayName});Object.assign(contractEdit,{statusCode:value.to,state:contractStatusLabel(value.to),updatedAt:occurredAt,updated:occurredAt,action:deriveContractAction({status:value.to,type:contractEdit.type,missingData:contractEdit.missingData,missingAttachments:contractEdit.missingAttachments}).label,history:[{id:`optimistic-${Date.now()}`,fromStatus:from,toStatus:value.to,occurredAt,actor:identitySession.user.displayName,note:value.reason,source:"manual" as const},...(contractEdit.history??[])]});setCommercialDataVersion(version=>version+1);setContractEdit(null);notify("Stav smlouvy byl změněn");refreshCommercial();}}/>}
      {newDocumentOpen&&<DocumentCreateModal close={()=>setNewDocumentOpen(false)} save={async value=>{const created=await documentRepository.create({...value,author:identitySession.user.displayName});setNewDocumentOpen(false);setDocumentReloadKey(key=>key+1);notify("Dokument byl vytvořen");openDocument(created);}}/>}
      {documentEdit&&<DocumentEditModal document={documentEdit} close={()=>setDocumentEdit(null)} save={async value=>{await documentRepository.update(documentEdit,value);setDocumentEdit(null);setDocumentReloadKey(key=>key+1);notify("Dokument byl uložen");}}/>}
      {documentVersionEdit&&<DocumentVersionModal document={documentVersionEdit} close={()=>setDocumentVersionEdit(null)} save={async value=>{await documentRepository.addVersion(documentVersionEdit,{...value,author:identitySession.user.displayName});setDocumentVersionEdit(null);setDocumentReloadKey(key=>key+1);notify("Nová verze byla vytvořena");}}/>}
      {clientEdit && <EditClientModal client={clientEdit} close={() => setClientEdit(null)} save={async (value) => { await clientRepository.updateProfile({id:clientEdit.id,firstName:value.firstName,lastName:value.lastName,legalName:value.legalName,registrationNumber:value.registrationNumber,vatNumber:value.vatNumber,contactPerson:value.contactPerson});if(value.email!==clientEdit.email) await clientRepository.upsertContact({partyId:clientEdit.id,contactType:"email",value:value.email,isPrimary:true});if(value.phone!==clientEdit.phone) await clientRepository.upsertContact({partyId:clientEdit.id,contactType:"phone",value:value.phone,isPrimary:true});if(value.line1&&value.city)await clientRepository.upsertAddress({partyId:clientEdit.id,addressType:clientEdit.kind==="FO"?"residence":"registered_office",line1:value.line1,line2:value.line2,city:value.city,postalCode:value.postalCode,countryCode:value.countryCode});const name=value.legalName||`${value.firstName} ${value.lastName}`.trim();const current=clients.find(c=>c.id===clientEdit.id);if(current)Object.assign(current,{...value,name});setSelectedClientName(name);setClientEdit(null);notify("Klient byl uložen");refreshClients(); }} />}
      {toast && <div className="toast"><CheckCircle2 size={18} /> {toast}</div>}
    </div>
  );
}

function Dashboard({ navigate, openUnit, taskRows, toggleTask }: { navigate: (page: Page) => void; openUnit: (unit: UnitRecord) => void; taskRows: TaskRecord[]; toggleTask: (id: string|number) => void }) {
  const now=useClock();
  const [paymentAlerts,setPaymentAlerts]=useState<PaymentRecord[]>([]);
  const [dashboardActivity,setDashboardActivity]=useState<TimelineRecord[]>([]);
  useEffect(()=>{const controller=new AbortController();paymentRepository.list({},controller.signal).then(result=>setPaymentAlerts(result.payments.filter(row=>["overdue","partially_paid"].includes(row.status)||(row.type==="reservation_fee"&&row.status!=="paid")))).catch(()=>setPaymentAlerts([]));return()=>controller.abort();},[]);
  useEffect(()=>{const controller=new AbortController();const projectId=projects.map(project=>backendEntityId(project.backendId)).find(Boolean);if(!projectId){Promise.resolve().then(()=>setDashboardActivity([]));return()=>controller.abort();}activityRepository.projectTimeline(projectId,controller.signal).then(setDashboardActivity).catch(()=>setDashboardActivity([]));return()=>controller.abort();},[]);
  return (
    <div className="dashboard-grid">
      <section className="attention-card card span-8">
        <div className="attention-heading">
          <div><span className="attention-icon"><Sparkles size={19} /></span><div><h2>Vyžaduje pozornost</h2><p>{taskRows.filter(item=>!item.done).length+paymentAlerts.length} věcí, které je dobré vyřešit</p></div></div>
          <button className="text-button" onClick={() => navigate("tasks")}>Zobrazit vše <ArrowRight size={15} /></button>
        </div>
        <div className="attention-list">
          {taskRows.filter(item=>!item.done).slice(0,3).map(task=><button key={task.id} onClick={()=>navigate("tasks")}>
            <span className="attention-type warning"><AlertTriangle size={18}/></span>
            <span><strong>{task.title}</strong><small>{task.object} · {task.project}</small></span>
            <Badge tone={task.priority==="Vysoká"?"danger":"neutral"}>{task.due}</Badge><ChevronRight size={18}/>
          </button>)}
          {paymentAlerts.slice(0,1).map(payment=><button key={payment.id} onClick={() => openUnit(units.find(unit=>unit.id===payment.unit)??units[0])}>
            <span className="attention-type danger"><Banknote size={18} /></span>
            <span><strong>{payment.unit} · {payment.type==="reservation_fee"&&payment.status!=="paid"?"Čeká na rezervační poplatek":`${payment.label} ${paymentStatusLabel[payment.status].toLocaleLowerCase("cs-CZ")}`}</strong><small>Zbývá uhradit {formatMoney(Math.max(0,payment.amount-payment.paid))} · {payment.project}</small></span>
            <Badge tone={payment.status==="overdue"?"danger":"warning"}>{payment.status==="overdue"?"Urgentní":"K řešení"}</Badge><ChevronRight size={18} />
          </button>)}
          {!taskRows.some(item=>!item.done)&&!paymentAlerts.length&&<div className="empty-filter-state"><CheckCircle2 size={20}/><strong>Nic urgentního</strong><small>Rezidence Dejvice nyní nemá žádné aktivní upozornění.</small></div>}
        </div>
      </section>

      <section className="today-card card span-4">
        <SectionTitle title="Dnes" />
        <div className="today-date"><strong>{now?new Intl.DateTimeFormat("cs-CZ",{timeZone:PRAGUE_TIME_ZONE,day:"numeric"}).format(now):"—"}</strong><span>{now?new Intl.DateTimeFormat("cs-CZ",{timeZone:PRAGUE_TIME_ZONE,month:"long"}).format(now).toLocaleUpperCase("cs-CZ"):""}<small>{now?new Intl.DateTimeFormat("cs-CZ",{timeZone:PRAGUE_TIME_ZONE,weekday:"long"}).format(now):""}</small></span></div>
        <div className="today-events">
          <div><span className="event-time">—</span><span className="event-line green" /><span><strong>Bez naplánovaných událostí</strong><small>Rezidence Dejvice</small></span></div>
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
              <span className="project-progress" title="Rezervované + prodané + předané"><small>{projectSalesPerformanceCount(project)} z {project.units}</small><span><i style={{ width: `${projectSalesPerformancePercent(project)}%` }} /></span></span>
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
          {dashboardActivity.slice(0,6).map((item) => (
            <div key={item.id}>
              <span className={`activity-dot ${item.icon}`} />
              <span className="activity-copy"><strong>{item.title}</strong><small>{item.detail}</small></span>
              <time>{item.date}</time>
            </div>
          ))}
          {!dashboardActivity.length&&<div className="empty-filter-state"><History size={20}/><strong>Zatím bez zaznamenané aktivity</strong></div>}
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
        <div><span className="metric-icon green"><Building2 size={20} /></span><span><small>Aktivní projekty</small><strong>{projects.length}</strong></span></div>
        <div><span className="metric-icon blue"><Home size={20} /></span><span><small>Jednotky celkem</small><strong>{totals.units}</strong></span></div>
        <div><span className="metric-icon blue"><Clock3 size={20} /></span><span><small>Rezervované</small><strong>{totals.reserved}</strong></span></div>
        <div><span className="metric-icon green"><CheckCircle2 size={20} /></span><span><small>Prodané a předané</small><strong>{totals.sold}</strong></span></div>
      </div>
      <div className="project-cards">
        {projects.map((project) => (
          <article className="project-card card" key={project.name} role="button" tabIndex={0} aria-label={`Otevřít projekt ${project.name}`} onClick={() => openProject(project)} onKeyDown={(event) => { if(event.key==="Enter"||event.key===" "){event.preventDefault();openProject(project);} }}>
            <ProjectCover project={project}/>
            <div className="project-card-body">
              <div className="project-card-heading"><span><h3>{project.name}</h3><p><MapPin size={14} /> {project.location}</p></span><Badge tone="blue">{project.stage}</Badge></div>
              <ConstructionProgress project={project}/>
              <div className="project-unit-stats">
                <span><i className="available" /><strong>{project.available}</strong><small>volných</small></span>
                <span><i className="reserved" /><strong>{project.reserved}</strong><small>rezervovaných</small></span>
                <span><i className="sold" /><strong>{project.sold}</strong><small>prodaných</small></span>
                <span><strong>{project.units}</strong><small>celkem</small></span>
              </div>
              <div className="large-progress"><span><small>Prodejnost projektu</small><strong>{projectSalesPerformancePercent(project)} %</strong></span><div><i style={{ width: `${projectSalesPerformancePercent(project)}%` }} /></div></div>
              <div className="project-card-meta"><span><small>VEDOUCÍ PROJEKTU</small><strong>{project.manager}</strong></span><span><small>PLÁNOVANÉ DOKONČENÍ</small><strong>{project.plannedHandover}</strong></span></div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function ProjectCover({project}:{project:ProjectRecord}){const [url,setUrl]=useState(project.coverImageUrl??null);useEffect(()=>{const projectId=backendEntityId(project.backendId);if(url||!projectId)return;const controller=new AbortController();mediaRepository.get("project",projectId,controller.signal).then(media=>{if(media)setUrl(media.url);}).catch(()=>undefined);return()=>controller.abort();},[project.backendId,url]);return <div className={`project-cover ${project.color} ${url?"has-image":""}`} style={url?{backgroundImage:`linear-gradient(180deg,rgba(10,28,22,.03),rgba(10,28,22,.24)),url(${JSON.stringify(url).slice(1,-1)})`}:undefined}>{!url&&<span className="project-cover-placeholder"><Building2 size={30}/><small>Developerský projekt</small></span>}</div>}

function ConstructionProgress({project}:{project:ProjectRecord}){
  const [open,setOpen]=useState(false);const stageCode=project.stageCode??projectConstructionCode(project.stage);const index=projectConstructionStepIndex(stageCode);const current=PROJECT_CONSTRUCTION_PHASES[index];
  return <div className="construction-progress" onClick={event=>event.stopPropagation()}><button type="button" aria-expanded={open} onClick={()=>setOpen(value=>!value)}><span className="construction-progress-label"><HardHat size={15}/><strong>Průběh výstavby</strong><small>{index+1} / {PROJECT_CONSTRUCTION_PHASES.length}</small></span><span className="construction-dots">{PROJECT_CONSTRUCTION_PHASES.map((step,stepIndex)=><i key={step.code} className={stepIndex<index?"done":stepIndex===index?"current":""} title={step.label}/>)}</span></button>{open&&<div className="construction-popover"><strong>{current.label}</strong><small>Aktuální evidovaná fáze projektu</small><ol>{PROJECT_CONSTRUCTION_PHASES.map((step,stepIndex)=><li className={stepIndex<index?"done":stepIndex===index?"current":""} key={step.code}>{step.label}{stepIndex===index&&<span>aktuálně</span>}</li>)}</ol><p>Další krok: {PROJECT_CONSTRUCTION_PHASES[index+1]?.label??"Projekt je dokončen"}</p><small>Změna fáze se provádí přes „Upravit projekt“ a zapisuje se do historie.</small></div>}</div>;
}

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

function ProjectDetail({ project, tab, onTab, onBack, notify, openClient,openContract, onEditProject,onEditCover,onNewClient,taskRows, ...unitListProps }: UnitListProps & { tab: ProjectTab; onTab: (tab: ProjectTab) => void; onBack: () => void; notify: (message: string) => void; openClient: (name: string) => void;openContract:(contract:(typeof contracts)[number])=>void; onEditProject?: () => void;onEditCover?:()=>void;onNewClient?:()=>void;taskRows:TaskRecord[] }) {
  const [projectPayments,setProjectPayments]=useState<PaymentRecord[]>([]);const [projectHandovers,setProjectHandovers]=useState<HandoverRecord[]>([]);
  useEffect(()=>{const controller=new AbortController();const projectId=backendEntityId(project.backendId);if(!projectId){Promise.resolve().then(()=>{setProjectPayments([]);setProjectHandovers([]);});return()=>controller.abort();}paymentRepository.list({projectId},controller.signal).then(result=>setProjectPayments(result.payments)).catch(()=>setProjectPayments([]));handoverRepository.list({project:projectId},controller.signal).then(setProjectHandovers).catch(()=>setProjectHandovers([]));return()=>controller.abort();},[project.backendId]);
  const projectClients = clients.filter((client) => client.projectNames.some(name=>projectMatchesName(project,name)));
  const projectContracts = contracts.filter((contract) => projectMatchesName(project,contract.project));
  const salePercent = projectSalesPerformancePercent(project);
  const salesPerformance = projectSalesPerformanceCount(project);
  const unitDistribution = [
    { label: "Předané", value: project.handedOver, className: "handed-over" },
    { label: "Prodané", value: project.sold, className: "sold" },
    { label: "Rezervované", value: project.reserved, className: "reserved" },
    { label: "Předrezervované", value: project.preReserved, className: "pre-reserved" },
    { label: "Volné", value: project.available, className: "available" },
  ];
  const tabs: { id: ProjectTab; label: string; icon: typeof Home; count?: number }[] = [
    { id: "overview", label: "Přehled", icon: LayoutDashboard },
    { id: "units", label: "Jednotky", icon: Home, count: project.units },
    { id: "clients", label: "Klienti", icon: Users, count: projectClients.length },
    { id: "contracts", label: "Smlouvy", icon: FileText, count: projectContracts.length },
    { id: "payments", label: "Platby", icon: CircleDollarSign, count: projectPayments.length },
    { id: "changes", label: "Klientské změny", icon: SlidersHorizontal, count: 0 },
    { id: "handovers", label: "Předání", icon: KeyRound, count: projectHandovers.length },
    { id: "documents", label: "Dokumenty", icon: FolderOpen },
  ];
  return (
    <div className="project-detail">
      <div className="unit-breadcrumb"><button onClick={onBack}><ArrowLeft size={16} /> Všechny projekty</button><ChevronRight size={14} /><strong>{project.name}</strong></div>
      <div className="project-detail-hero card">
        <div><span className="eyebrow">AKTUÁLNÍ PROJEKT</span><h1>{project.name} <Badge tone="neutral">{project.stage}</Badge></h1><p><MapPin size={14} /> {project.location} · {project.buildings.join(" · ")}</p></div>
        <div className="project-detail-actions">{onEditProject&&<button className="secondary-button" onClick={onEditProject}><MoreHorizontal size={16} /> Upravit projekt</button>}{onEditCover&&<button className="secondary-button" onClick={onEditCover}><ImagePlus size={16}/> Titulní obrázek</button>}<button className="secondary-button" onClick={() => notify("Ceník se připravuje ke stažení")}><Download size={16} /> Export ceníku</button></div>
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
            <div><small>PRODEJNÍ VÝKON</small><strong>{salesPerformance} z {project.units} jednotek</strong><p>je rezervovaných, prodaných nebo předaných</p></div>
          </div>
          <div className="project-unit-distribution">
            <div className="project-distribution-head"><div><small>STAV JEDNOTEK</small><strong>Rozložení projektu</strong></div><span>{project.units} jednotek celkem</span></div>
            <div className="project-distribution-bar" role="img" aria-label={`Rozložení ${project.units} jednotek`}>{unitDistribution.map((item) => <i key={item.label} className={item.className} style={{ width: `${project.units?item.value/project.units*100:0}%` }} title={`${item.label}: ${item.value}`} />)}</div>
            <div className="project-distribution-legend">{unitDistribution.map((item) => <span key={item.label}><i className={item.className} /><span><small>{item.label}</small><strong>{item.value}</strong></span></span>)}</div>
          </div>
        </div>
      </section>
      <nav className="unit-tabs project-tabs" aria-label="Navigace projektu">{tabs.map((item) => { const TabIcon = item.icon; return <button key={item.id} className={tab === item.id ? "active" : ""} aria-current={tab === item.id ? "page" : undefined} onClick={() => onTab(item.id)}><TabIcon className="project-tab-icon" size={17} />{item.label}{item.count !== undefined && <span aria-label={`${item.count} položek`}>{item.count}</span>}</button>; })}</nav>
      {tab === "overview" && <ProjectOverview project={project} onTab={onTab} taskRows={taskRows} paymentRows={projectPayments} handoverRows={projectHandovers} />}
      {tab === "units" && <ProjectUnitList project={project} {...unitListProps} />}
      {tab === "clients" && <ProjectClients project={project} openClient={openClient} openUnit={unitListProps.openUnit} notify={onNewClient??notify} />}
      {tab === "contracts" && <ProjectContracts project={project} openUnit={unitListProps.openUnit} openContract={openContract} notify={notify} />}
      {tab === "payments" && <ProjectPayments project={project} openUnit={unitListProps.openUnit} />}
      {tab === "changes" && <ProjectClientChanges project={project} openUnit={unitListProps.openUnit} notify={notify} />}
      {tab === "handovers" && <ProjectHandovers project={project} openUnit={unitListProps.openUnit} notify={notify} />}
      {tab === "documents" && <ProjectDocuments project={project} notify={notify} />}
    </div>
  );
}

function ProjectOverview({ project, onTab,taskRows,paymentRows,handoverRows }: { project: ProjectRecord; onTab: (tab: ProjectTab) => void;taskRows:TaskRecord[];paymentRows:PaymentRecord[];handoverRows:HandoverRecord[] }) {
  const [projectActivity,setProjectActivity]=useState<TimelineRecord[]>([]);
  useEffect(()=>{const controller=new AbortController();const projectId=backendEntityId(project.backendId);if(!projectId){Promise.resolve().then(()=>setProjectActivity([]));return()=>controller.abort();}activityRepository.projectTimeline(projectId,controller.signal).then(setProjectActivity).catch(()=>setProjectActivity([]));return()=>controller.abort();},[project.backendId]);
  if(project.units===0)return <div className="project-empty-onboarding card"><span className="metric-icon green"><Building2 size={22}/></span><div><h2>Projekt je založený</h2><p>Zatím nemá strukturu ani jednotky. Souhrny se začnou počítat až ze skutečně vložených dat.</p><ol><li><CheckCircle2 size={16}/> Základní údaje projektu</li><li><Building2 size={16}/> Přidat etapy, budovy a sekce</li><li><Home size={16}/> Importovat nebo založit jednotky</li><li><KeyRound size={16}/> Doplnit příslušenství a ceny</li><li><Users size={16}/> Přiřadit uživatele projektu</li></ol><button className="primary-button" onClick={()=>onTab("units")}><Home size={16}/> Pokračovat k jednotkám</button></div></div>;
  const projectTasks = taskRows.filter((task) => projectMatchesName(project,task.project));
  const projectPayments = paymentRows;
  const projectHandovers = handoverRows;
  const projectUnitIds = units.filter((unit) => unitBelongsToProject(unit,project)).map((unit) => unit.id);
  const firstUnit = projectUnitIds[0] || "—";
  const nextPayment = projectPayments.find((payment) => payment.status !== "paid");
  const nextHandover = projectHandovers[0];
  const deadlines = [
    { date: "23. 7.", detail: `Kontrola smluvních dat ${firstUnit}`, tab: "contracts" as ProjectTab, icon: FileText },
    { date: nextPayment?formatPragueDate(nextPayment.dueAt):"—", detail: nextPayment ? `Splatnost · ${nextPayment.unit}` : "Bez nejbližší splatnosti", tab: "payments" as ProjectTab, icon: Clock3 },
    { date: nextHandover?formatPragueDate(nextHandover.scheduledAt):project.plannedHandover, detail: nextHandover ? `Příprava předání ${nextHandover.unit}` : "Milník předávání projektu", tab: "handovers" as ProjectTab, icon: CalendarDays },
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
        <section className="card project-activity-card"><div className="project-section-head"><div><h2>Poslední aktivita</h2><p>Smlouvy, platby, dokumenty a změny jednotek.</p></div><Badge tone="neutral">{project.name}</Badge></div><div className="timeline-mini project-activity-list">{projectActivity.length ? projectActivity.slice(0, 5).map((item) => <div key={item.id}><span className={`timeline-icon ${item.icon}`}><Activity size={16} /></span><span><strong>{item.title}</strong><small>{item.detail}</small></span><time>{formatPragueDateTime(item.date)}</time></div>) : <div><span className="timeline-icon"><Activity size={16} /></span><span><strong>Zatím bez nové aktivity</strong><small>Nové změny projektu se zobrazí zde.</small></span></div>}</div></section>
      </div>
      <aside className="project-side-column">
        <section className="card project-deadlines-card"><SectionTitle title="Nejbližší termíny" /><div>{deadlines.map((deadline) => { const Icon = deadline.icon; return <button key={`${deadline.date}-${deadline.detail}`} onClick={() => onTab(deadline.tab)}><Icon size={18} /><span><strong>{deadline.date}</strong><small>{deadline.detail}</small></span><ChevronRight size={16} /></button>; })}</div></section>
        <section className="card project-brief-card"><div className="project-section-head"><div><h2>Platby</h2><p>Stručný finanční přehled.</p></div><button className="text-button" onClick={() => onTab("payments")}>Detail <ArrowRight size={14} /></button></div><strong>{formatMoney(paid)}</strong><small>uhrazeno z evidovaných {formatMoney(expected)}</small><span className="payment-progress"><i style={{ width: `${expected ? paid / expected * 100 : 0}%` }} /></span><p>{projectPayments.filter((payment) => payment.status === "overdue").length} položek po splatnosti</p></section>
        <section className="card project-brief-card"><div className="project-section-head"><div><h2>Připravovaná předání</h2><p>Nejbližší jednotky k dokončení.</p></div><button className="text-button" onClick={() => onTab("handovers")}>Detail <ArrowRight size={14} /></button></div>{projectHandovers.length ? projectHandovers.slice(0, 3).map((handover) => <button className="project-brief-row" key={handover.id} onClick={() => onTab("handovers")}><span><strong>{handover.unit}</strong><small>{handover.client || "Bez klienta"}</small></span><Badge>{formatPragueDate(handover.scheduledAt)}</Badge></button>) : <p>Termíny předání zatím nejsou naplánované.</p>}</section>
      </aside>
    </div>
  );
}

function ProjectUnitList(props: UnitListProps) {
  const router=useRouter();const pathname=usePathname();const searchParams=useSearchParams();
  const { project, unitView, setUnitView, filteredUnits, previewUnit, openUnit, buildingFilter, floorFilter, statusFilter, layoutFilter, areaFrom, areaTo, priceFrom, priceTo,unitQuery,setUnitQuery,clientQuery,setClientQuery } = props;
  const projectUnits = units.filter((unit) => unitBelongsToProject(unit,project));
  const buildings = Array.from(new Set(projectUnits.map((unit) => unit.building)));
  const floors = Array.from(new Set(projectUnits.map((unit) => unit.floor)));
  const filteredVisibleUnits = filteredUnits.filter((unit) => unit.id.toLowerCase().includes(unitQuery.toLowerCase()) && (unit.client || "").toLowerCase().includes(clientQuery.toLowerCase()));
  const sort=searchParams.get("sort")??"code";const direction=(searchParams.get("dir")==="desc"?"desc":"asc") as SortDirection;
  const visibleUnits=stableSort(filteredVisibleUnits,unit=>sort==="floor"?unit.floor:sort==="layout"?unit.layout:sort==="price"?unit.price:sort==="status"?unit.status:sort==="updated"?unit.updatedAt??"":unit.id,direction,unit=>unit.backendId??unit.id);
  const activeCount = [unitQuery, buildingFilter.length, floorFilter.length, statusFilter.length, layoutFilter.length, areaFrom, areaTo, priceFrom, priceTo, clientQuery].filter(Boolean).length;
  const reset = props.resetFilters;
  return (
    <section className="card units-section">
      <div className="project-scope-banner"><Building2 size={17} /><span><strong>{project.name}</strong><small>Zobrazeny jsou pouze jednotky tohoto projektu.</small></span><span className="compact-result-count"><strong>{visibleUnits.length}</strong> jednotek {activeCount>0&&<Badge tone="blue">{activeCount} filtrů</Badge>}{activeCount>0&&<button className="text-button" onClick={reset}>Vymazat</button>}<span className="view-toggle"><button className={unitView === "table" ? "active" : ""} onClick={() => setUnitView("table")} aria-label="Tabulkové zobrazení" title="Seznam"><List size={17} /></button><button className={unitView === "cards" ? "active" : ""} onClick={() => setUnitView("cards")} aria-label="Kartové zobrazení" title="Karty"><LayoutGrid size={17} /></button></span></span></div>
      {unitView === "table" ? <div className="unit-table-wrap"><table className="data-table unit-table filter-table"><thead><tr><TableColumnFilter label="Jednotka" active={Boolean(unitQuery)} sortDirection={sort==="code"?direction:undefined} onSort={next=>router.replace(updateSearch(pathname,searchParams.toString(),{sort:"code",dir:next}),{scroll:false})}><input value={unitQuery} onChange={(event) => setUnitQuery(event.target.value)} placeholder="A203…" aria-label="Filtrovat jednotky" /></TableColumnFilter><TableColumnFilter label="Budova / etapa" active={buildingFilter.length > 0}><MultiSelectFilter options={buildings} selected={buildingFilter} onChange={props.setBuildingFilter} allLabel="Všechny budovy / etapy" ariaLabel="Filtrovat budovu nebo etapu" /></TableColumnFilter><TableColumnFilter label="Podlaží" active={floorFilter.length > 0} sortDirection={sort==="floor"?direction:undefined} onSort={next=>router.replace(updateSearch(pathname,searchParams.toString(),{sort:"floor",dir:next}),{scroll:false})}><MultiSelectFilter options={floors} selected={floorFilter} onChange={props.setFloorFilter} allLabel="Všechna podlaží" ariaLabel="Filtrovat podlaží" /></TableColumnFilter><TableColumnFilter label="Dispozice" active={layoutFilter.length > 0} sortDirection={sort==="layout"?direction:undefined} onSort={next=>router.replace(updateSearch(pathname,searchParams.toString(),{sort:"layout",dir:next}),{scroll:false})}><MultiSelectFilter options={["1+kk", "2+kk", "3+kk", "4+kk", "5+kk"]} selected={layoutFilter} onChange={props.setLayoutFilter} allLabel="Všechny dispozice" ariaLabel="Filtrovat dispozici" /></TableColumnFilter><TableColumnFilter label="Plocha m²" active={Boolean(areaFrom || areaTo)} sortType="number"><span className="column-range"><input inputMode="decimal" value={areaFrom} onChange={(event) => props.setAreaFrom(event.target.value)} placeholder="Od" aria-label="Plocha od" /><i>–</i><input inputMode="decimal" value={areaTo} onChange={(event) => props.setAreaTo(event.target.value)} placeholder="Do" aria-label="Plocha do" /></span></TableColumnFilter><TableColumnFilter label="Aktuální cena" active={Boolean(priceFrom || priceTo)} sortType="number" sortDirection={sort==="price"?direction:undefined} onSort={next=>router.replace(updateSearch(pathname,searchParams.toString(),{sort:"price",dir:next}),{scroll:false})}><span className="column-range"><input inputMode="decimal" value={priceFrom} onChange={(event) => props.setPriceFrom(event.target.value)} placeholder="Od mil." aria-label="Cena od" /><i>–</i><input inputMode="decimal" value={priceTo} onChange={(event) => props.setPriceTo(event.target.value)} placeholder="Do mil." aria-label="Cena do" /></span></TableColumnFilter><TableColumnFilter label="Obchodní stav" active={statusFilter.length > 0} sortDirection={sort==="status"?direction:undefined} onSort={next=>router.replace(updateSearch(pathname,searchParams.toString(),{sort:"status",dir:next}),{scroll:false})}><MultiSelectFilter options={["Volný", "Předrezervace", "RS", "SBK", "KS", "Předáno"]} selected={statusFilter} onChange={props.setStatusFilter} allLabel="Všechny stavy" ariaLabel="Filtrovat obchodní stav" /></TableColumnFilter><TableColumnFilter label="Klient" active={Boolean(clientQuery)}><input value={clientQuery} onChange={(event) => setClientQuery(event.target.value)} placeholder="Jméno…" aria-label="Filtrovat klienta" /></TableColumnFilter><th /></tr></thead><tbody>{visibleUnits.map((unit) => <tr key={unit.id} onClick={() => openUnit(unit)} tabIndex={0} onKeyDown={(event) => event.key === "Enter" && openUnit(unit)}><td><strong>{unit.id}</strong></td><td>{unit.building}</td><td>{unit.floor}</td><td>{unit.layout}</td><td>{unit.area.toLocaleString("cs-CZ")} m²</td><td><strong>{formatMoney(unit.price)}</strong></td><td><Badge>{unit.status}</Badge></td><td>{unit.client || <span className="muted">—</span>}</td><td><ChevronRight size={18} /></td></tr>)}</tbody></table></div> : <div className="unit-card-grid">{visibleUnits.map((unit) => <button className="unit-card" key={unit.id} onClick={() => previewUnit(unit)}><span className="unit-card-top"><strong>{unit.id}</strong><Badge>{unit.status}</Badge></span><span className="unit-card-plan"><span className="plan-room r1" /><span className="plan-room r2" /><span className="plan-room r3" /><Home size={22} /></span><span className="unit-card-info"><strong>{unit.layout} · {unit.area.toLocaleString("cs-CZ")} m²</strong><small>{unit.building} · {unit.floor}</small></span><span className="unit-card-price"><strong>{formatMoney(unit.price)}</strong><ChevronRight size={17} /></span></button>)}</div>}
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
  return <PaymentContextTable title="Platby projektu" description="Splátkový kalendář a skutečné úhrady z centrálního platebního repository." filters={{project:project.name}} openUnit={openUnit} project={project}/>;
}

function ProjectClientChanges({ project,openUnit, notify }: { project: ProjectRecord; openUnit: (unit: UnitRecord) => void; notify: (message: string) => void }) {
  return <ClientChangesWorkspace project={project} openUnit={openUnit} notify={notify}/>;
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
  const writeClientFilter=(key:string,value:string|string[])=>clientRouter.replace(updateSearch(clientPathname,clientParams.toString(),{[key]:value,clientPage:""}),{scroll:false});
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
  const clientSort=clientParams.get("sort")??"name";const clientDirection=(clientParams.get("dir")==="desc"?"desc":"asc") as SortDirection;
  const sortedClients=useMemo(
    ()=>stableSort(filtered,client=>clientSort==="updated"?client.updatedAt??"":clientSort==="relation"?client.state:clientSort==="contract"?client.contractStatus:clientSort==="project"?client.projectNames.join(" "):clientSort==="unit"?client.units.join(" "):client.name,clientDirection,client=>client.id),
    [filtered,clientSort,clientDirection],
  );
  const pageSize=7;const requestedPage=Math.max(1,Number(clientParams.get("clientPage")??1)||1);const [serverPage,setServerPage]=useState<{clients:(typeof clients)[number][];total:number;page:number}>({clients:[],total:0,page:1});
  useEffect(()=>{const controller=new AbortController();clientRepository.getPage({page:requestedPage,pageSize,query,quickProject,types:typeFilter,projects:projectFilter,unit:unitFilter,relations:relationFilter,contracts:contractFilter,phone:phoneFilter,email:emailFilter,sort:clientSort,direction:clientDirection},controller.signal).then(result=>setServerPage({clients:result.clients,total:result.total,page:result.page})).catch(()=>setServerPage({clients:sortedClients.slice((requestedPage-1)*pageSize,requestedPage*pageSize),total:sortedClients.length,page:requestedPage}));return()=>controller.abort();},[requestedPage,query,quickProject,typeFilter,projectFilter,unitFilter,relationFilter,contractFilter,phoneFilter,emailFilter,clientSort,clientDirection,sortedClients]);
  const pageCount=Math.max(1,Math.ceil(serverPage.total/pageSize));const currentPage=Math.min(serverPage.page,pageCount);const pageRows=serverPage.clients;const setClientPage=(value:number)=>clientRouter.replace(updateSearch(clientPathname,clientParams.toString(),{clientPage:value<=1?"":String(value)}),{scroll:false});
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
  if (selectedClient) return <><ClientDetail client={selectedClient} onBack={() => setSelectedClientName(null)} openUnit={openUnit} openProject={openProject} onEdit={onEditClient?() => onEditClient(selectedClient):undefined} /><PaymentContextTable title={`Platby klienta ${selectedClient.name}`} description="Předpisy ze všech projektů a jednotek tohoto klienta." filters={{partyId:selectedClient.id}}/></>;
  return (
    <section className="card module-card">
      <div className="client-quick-views"><div className="client-view-title"><span><Building2 size={17} /></span><span><small>RYCHLÝ POHLED</small><strong>Klienti podle projektu</strong></span></div><div className="client-view-options" role="tablist" aria-label="Klienti podle projektu"><button role="tab" aria-selected={quickProject==="Všichni"} className={quickProject === "Všichni" ? "active" : ""} onClick={() => writeClientText("cp","Všichni",setQuickProject)}>Všichni <span>{clients.length}</span></button>{projects.map((project) => <button role="tab" aria-selected={quickProject===project.name} key={project.name} className={quickProject === project.name ? "active" : ""} onClick={() => writeClientText("cp",project.name,setQuickProject)}>{project.name}</button>)}</div></div>
      {selected.size > 0 && <div className="bulk-action-bar"><span><CheckCircle2 size={18} /><strong>Vybráno {selected.size} klientů</strong></span><div><button onClick={copyEmails}><Mail size={15} /> Kopírovat e-maily pro BCC</button><button onClick={() => downloadCsv(false)}><Download size={15} /> Excel / CSV</button><button onClick={() => downloadCsv(true)}><FileText size={15} /> Pouze e-maily</button><button className="ghost-icon" onClick={() => setSelected(new Set())} aria-label="Zrušit výběr"><X size={17} /></button></div></div>}
      {allPageSelected && filtered.length > pageRows.length && selected.size < filtered.length && <div className="select-all-results"><Check size={15} /> Vybráno všech {pageRows.length} klientů na této stránce. <button onClick={selectAllResults}>Vybrat všech {filtered.length} výsledků aktuálního filtru</button></div>}
      <div className="unit-table-wrap"><table className="data-table client-table filter-table"><thead><tr><th className="checkbox-cell"><button className={`table-checkbox ${allPageSelected ? "checked" : ""}`} onClick={togglePage} aria-label="Vybrat klienty na stránce">{allPageSelected && <Check size={13} />}</button></th><TableColumnFilter label="Jméno / název" active={Boolean(query)}><input value={query} onChange={(event) => writeClientText("cq",event.target.value,setQuery)} placeholder="Hledat jméno…" aria-label="Filtrovat jméno nebo název" /></TableColumnFilter><TableColumnFilter label="Typ" active={typeFilter.length > 0}><MultiSelectFilter options={["FO", "PO"]} selected={typeFilter} onChange={value=>writeClientList("ct",value,setTypeFilter)} allLabel="Všechny typy" ariaLabel="Filtrovat typ klienta" /></TableColumnFilter><TableColumnFilter label="Projekt" active={projectFilter.length > 0}><MultiSelectFilter options={projects.map((project) => project.name)} selected={projectFilter} onChange={value=>writeClientList("cproj",value,setProjectFilter)} allLabel="Všechny projekty" ariaLabel="Filtrovat projekt" /></TableColumnFilter><TableColumnFilter className="client-unit-column" label="Jednotka / jednotky" active={Boolean(unitFilter)}><input value={unitFilter} onChange={(event) => writeClientText("cu",event.target.value,setUnitFilter)} placeholder="A203…" aria-label="Filtrovat jednotku" /></TableColumnFilter><TableColumnFilter label="Stav vztahu" active={relationFilter.length > 0}><MultiSelectFilter options={["Zájemce", "Aktivní klient", "Předání", "Předáno"]} selected={relationFilter} onChange={value=>writeClientList("cr",value,setRelationFilter)} allLabel="Všechny vztahy" ariaLabel="Filtrovat stav vztahu" /></TableColumnFilter><TableColumnFilter label="Smluvní stav" active={contractFilter.length > 0}><MultiSelectFilter options={["Podepsaná KS", "Podepsaná SBK", "RS k podpisu", "Předrezervace", "Bez smlouvy"]} selected={contractFilter} onChange={value=>writeClientList("cc",value,setContractFilter)} allLabel="Všechny smluvní stavy" ariaLabel="Filtrovat smluvní stav" /></TableColumnFilter><TableColumnFilter label="Telefon" active={Boolean(phoneFilter)}><input value={phoneFilter} onChange={(event) => writeClientText("cph",event.target.value,setPhoneFilter)} placeholder="Telefon…" aria-label="Filtrovat telefon" /></TableColumnFilter><TableColumnFilter label="E-mail" active={Boolean(emailFilter)}><input value={emailFilter} onChange={(event) => writeClientText("cem",event.target.value,setEmailFilter)} placeholder="E-mail…" aria-label="Filtrovat e-mail" /></TableColumnFilter><th /></tr></thead><tbody>{pageRows.map((client) => <tr key={client.id} onClick={() => setSelectedClientName(client.name)}><td className="checkbox-cell"><button className={`table-checkbox ${selected.has(client.id) ? "checked" : ""}`} onClick={(event) => { event.stopPropagation(); toggle(client.id); }} aria-label={`Vybrat ${client.name}`}>{selected.has(client.id) && <Check size={13} />}</button></td><td><span className="client-name-cell"><Avatar initials={client.initials} small /><span><strong>{client.name}</strong></span></span></td><td><Badge tone="neutral">{client.kind}</Badge></td><td><ClientRelationColumn client={client} mode="project" openUnit={openUnit}/></td><td className="client-unit-column"><ClientRelationColumn client={client} mode="unit" openUnit={openUnit}/></td><td><Badge>{client.state}</Badge></td><td>{client.contractStatus}</td><td>{client.phone}</td><td><a href={`mailto:${client.email}`} onClick={(event) => event.stopPropagation()}>{client.email}</a></td><td><ChevronRight size={17} /></td></tr>)}</tbody></table></div>
      {!filtered.length && <div className="empty-filter-state"><Search size={22} /><strong>Žádný klient neodpovídá filtrům</strong><small>Změňte projekt, stav vztahu nebo hledaný výraz.</small></div>}
      <div className="table-footer compact-pagination"><div><button disabled={currentPage===1} onClick={()=>setClientPage(currentPage-1)} aria-label="Předchozí stránka"><ChevronRight className="rotate-180" size={16} /></button>{Array.from({length:pageCount},(_,index)=>index+1).map(pageNumber=><button key={pageNumber} className={pageNumber===currentPage?"active":""} onClick={()=>setClientPage(pageNumber)}>{pageNumber}</button>)}<button disabled={currentPage===pageCount} onClick={()=>setClientPage(currentPage+1)} aria-label="Další stránka"><ChevronRight size={16} /></button></div></div>
    </section>
  );
}

function ClientRelationColumn({client,mode,openUnit}:{client:(typeof clients)[number];mode:"project"|"unit";openUnit:(unit:UnitRecord)=>void}){const relations=client.projectNames.map(project=>({project,codes:client.units.filter(code=>units.find(unit=>unit.id===code)?.project===project)})).filter(row=>row.codes.length||client.projectNames.includes(row.project));return <span className="client-relation-map">{relations.map(row=><span key={row.project}>{mode==="project"?<small>{row.project}</small>:row.codes.length?row.codes.map(code=><button className="unit-link" key={code} onClick={event=>{event.stopPropagation();const unit=units.find(item=>item.id===code);if(unit)openUnit(unit);}}>{code}</button>):<small>bez konkrétní jednotky</small>}</span>)}</span>}

function ClientDetail({ client, onBack, openUnit,openProject, onEdit }: { client: (typeof clients)[number]; onBack: () => void; openUnit: (unit: UnitRecord) => void;openProject:(project:ProjectRecord)=>void; onEdit?: () => void }) {
  const history=client.interestHistory?.length?client.interestHistory:[{date:"—",project:client.projectNames[0]??"—",unit:client.units[0]??"—",type:"Bez evidované události",result:client.state}];
  const [tab,setTab]=useState<"overview"|"payments"|"documents">("overview");
  return <div className="client-detail"><div className="unit-breadcrumb"><button onClick={onBack}><ArrowLeft size={16} /> Klienti a zájemci</button><ChevronRight size={14} /><strong>{client.name}</strong></div><div className="client-detail-hero card"><Avatar initials={client.initials} /><div><span className="eyebrow">{client.type.toUpperCase()}</span><h1>{client.name} <Badge>{client.state}</Badge></h1><p><Mail size={14} /> {client.email} <span>·</span> <UserRound size={14} /> {client.phone}</p></div><div className="project-detail-actions">{onEdit&&<button className="secondary-button" onClick={onEdit}><MoreHorizontal size={16} /> Upravit klienta</button>}<button className="primary-button"><MessageSquare size={16} /> Přidat aktivitu</button></div></div><nav className="unit-tabs unit-detail-tabs client-detail-tabs" aria-label="Navigace klienta"><button className={tab==="overview"?"active":""} onClick={()=>setTab("overview")}><LayoutDashboard size={17}/> Přehled</button><button className={tab==="documents"?"active":""} onClick={()=>setTab("documents")}><FolderOpen size={17}/> Dokumenty</button></nav>{tab==="documents"?<ClientDocuments client={client}/>:<div className="client-detail-grid"><section className="card client-relations"><SectionTitle title="Projekty a jednotky" /><p className="section-description">Všechny vztahy klienta napříč společnou firemní databází.</p><div className="client-project-links">{client.projectNames.map(name=>{const project=projects.find(item=>projectMatchesName(item,name));return project?<button className="unit-link" key={name} onClick={()=>openProject(project)}><Building2 size={14}/>{project.name}</button>:null;})}</div>{client.units.map((unitCode, index) => { const unit = units.find((item) => item.id === unitCode) || units[0]; return <button key={unitCode} onClick={() => openUnit(unit)}><span className="unit-symbol"><Home size={18} /></span><span><strong>{unit.id} · {unit.layout}</strong><small>{unit.project} · {unit.building}</small></span><Badge>{index === 0 ? client.state : "Zájemce"}</Badge><ChevronRight size={17} /></button>; })}</section><aside className="card client-contact-panel"><SectionTitle title="Kontaktní údaje" /><dl><div><dt>E-mail</dt><dd>{client.email}</dd></div><div><dt>Telefon</dt><dd>{client.phone}</dd></div><div><dt>Typ osoby</dt><dd>{client.kind}</dd></div><div><dt>Smluvní stav</dt><dd>{client.contractStatus}</dd></div></dl></aside><section className="card client-history"><SectionTitle title="Historie zájmu" /><div className="unit-table-wrap"><table className="data-table"><thead><tr><th>Datum</th><th>Projekt / jednotka</th><th>Typ zájmu</th><th>Výsledek</th></tr></thead><tbody>{history.map((row,index)=><tr key={`${row.unit}-${row.date}-${index}`}><td>{row.date}</td><td><strong>{row.project} · {row.unit}</strong></td><td>{row.type}</td><td><Badge tone={row.result.includes("Pokračuje")||row.result.includes("Aktivní")?"success":"neutral"}>{row.result}</Badge></td></tr>)}</tbody></table></div></section></div>}</div>;
}

function ContractsAndDocumentsPage(props:{
  view:string;setView:(view:"contracts"|"documents"|"templates")=>void;
  openUnit:(unit:UnitRecord)=>void;openClient:(identity:string)=>void;openContract:(contract:(typeof contracts)[number])=>void;closeContract:()=>void;selectedContractId:string|null;notify:(message:string)=>void;onWorkflow?:(contract:(typeof contracts)[number])=>void;openDocument:(document:DocumentRecord)=>void;
  onContractVersion?:(contract:(typeof contracts)[number])=>void;onContractSignature?:(contract:(typeof contracts)[number],partyId:string,versionId:string,partyName:string)=>void;
  selectedDocumentId:string|null;closeDocument:()=>void;reloadKey:number;onEditDocument?:(document:DocumentRecord)=>void;onNewVersion?:(document:DocumentRecord)=>void;
}){
  const active=props.view==="documents"?"documents":props.view==="templates"?"templates":"contracts";
  return <div className="module-stack"><nav className="workspace-subnav" aria-label="Smlouvy a dokumenty"><button className={active==="contracts"?"active":""} onClick={()=>props.setView("contracts")}><FileCheck2 size={17}/> Smlouvy</button><button className={active==="documents"?"active":""} onClick={()=>props.setView("documents")}><FolderOpen size={17}/> Ostatní dokumenty</button><button className={active==="templates"?"active":""} onClick={()=>props.setView("templates")}><FileText size={17}/> Šablony</button></nav>
    {active==="contracts"?<ContractsPage {...props}/>:active==="documents"?<DocumentsPage selectedDocumentId={props.selectedDocumentId} openDocument={props.openDocument} closeDocument={props.closeDocument} openUnit={props.openUnit} openClient={props.openClient} openContract={props.openContract} notify={props.notify} reloadKey={props.reloadKey} onEdit={props.onEditDocument} onNewVersion={props.onNewVersion}/>:<section className="card module-card"><div className="tab-card-header"><div><h2>Šablony dokumentů</h2><p>Word šablony zůstávají samostatnou vrstvou pro budoucí generování.</p></div></div><div className="empty-filter-state"><FileCheck2 size={24}/><strong>Správa šablon je připravená</strong><small>Šablony nejsou smlouvy ani fyzické dokumenty a nevytvářejí duplicitní data.</small></div></section>}
  </div>;
}

function ContractsPage({ openUnit,openClient,openContract,closeContract,selectedContractId,notify,onWorkflow,onContractVersion,onContractSignature,openDocument }: { openUnit:(unit:UnitRecord)=>void;openClient:(identity:string)=>void;openContract:(contract:(typeof contracts)[number])=>void;closeContract:()=>void;selectedContractId:string|null;notify:(message:string)=>void;onWorkflow?:(contract:(typeof contracts)[number])=>void;onContractVersion?:(contract:(typeof contracts)[number])=>void;onContractSignature?:(contract:(typeof contracts)[number],partyId:string,versionId:string,partyName:string)=>void;openDocument:(document:DocumentRecord)=>void }) {
  const selectedContract=selectedContractId?contracts.find(contract=>contract.id===selectedContractId||contract.reference===selectedContractId):undefined;
  if(selectedContract)return <><ContractDetail contract={selectedContract} close={closeContract} openUnit={openUnit} openClient={openClient} onWorkflow={onWorkflow} onNewVersion={onContractVersion} onSignParty={onContractSignature} openDocument={openDocument}/><PaymentContextTable title={`Platby smlouvy ${selectedContract.reference??selectedContract.type}`} description="Předpisy a skutečné úhrady navázané přímo na smlouvu." filters={{contractId:selectedContract.id}}/></>;
  return <ContractWorkspace openUnit={openUnit} openClient={openClient} openContract={openContract} notify={notify} onWorkflow={onWorkflow}/>;
}

const contractWorkflow=CONTRACT_STATUS_ORDER.map(contractStatusLabel);
function contractStep(contract:(typeof contracts)[number]){return contractStepIndex(contract.statusCode??contract.state);}
function recommendedContractAction(contract:(typeof contracts)[number]){return deriveContractAction({status:contract.statusCode??contract.state,type:contract.type,missingData:contract.missingData,missingAttachments:contract.missingAttachments});}
function ContractWorkspace({openUnit,openClient,openContract,notify,onWorkflow}:{openUnit:(unit:UnitRecord)=>void;openClient:(identity:string)=>void;openContract:(contract:(typeof contracts)[number])=>void;notify:(message:string)=>void;onWorkflow?:(contract:(typeof contracts)[number])=>void}){
  const router=useRouter();const pathname=usePathname();const searchParams=useSearchParams();
  const [query,setQuery]=useState("");const [quick,setQuick]=useState("action");const [typeFilter,setTypeFilter]=useState<string[]>([]);const [stateFilter,setStateFilter]=useState<string[]>([]);const [projectFilter,setProjectFilter]=useState<string[]>([]);const [expanded,setExpanded]=useState<string|null>(null);
  const sort=searchParams.get("sort")??"updated";const direction=(searchParams.get("dir")==="asc"?"asc":"desc") as SortDirection;
  const filtered=contracts.filter(contract=>{const action=recommendedContractAction(contract);const search=`${contract.type} ${contract.unit} ${contract.client} ${contract.project} ${contract.reference??""}`.toLowerCase();const quickMatch=quick==="all"||quick==="mine"&&contract.owner==="Iva"||quick==="action"&&action.tone!=="neutral"||quick==="signing"&&["K podpisu","Odeslána"].includes(contract.state)||quick==="negotiation"&&contract.state==="Ve vyjednávání"||quick==="signed"&&contract.state==="Podepsána";return search.includes(query.toLowerCase())&&quickMatch&&(!typeFilter.length||typeFilter.includes(contract.type))&&(!stateFilter.length||stateFilter.includes(contract.state))&&(!projectFilter.length||projectFilter.includes(contract.project));});
  const rows=stableSort(filtered,contract=>sort==="state"?contract.state:sort==="type"?contract.type:sort==="client"?contract.client:sort==="unit"?contract.unit:sort==="project"?contract.project:new Date(contract.updatedAt??contract.updated),direction,contract=>contract.id??`${contract.unit}-${contract.type}`);
  const setSort=(value:string,nextDirection:SortDirection)=>router.replace(updateSearch(pathname,searchParams.toString(),{sort:value,dir:nextDirection}),{scroll:false});
  return <div className="module-stack contract-workspace">
    <div className="contract-quick-stats"><button className={quick==="action"?"active":""} onClick={()=>setQuick("action")}><AlertTriangle size={17}/><span><strong>{contracts.filter(item=>recommendedContractAction(item).tone!=="neutral").length}</strong><small>Vyžadují akci</small></span></button><button className={quick==="signing"?"active":""} onClick={()=>setQuick("signing")}><FileCheck2 size={17}/><span><strong>{contracts.filter(item=>["K podpisu","Odeslána"].includes(item.state)).length}</strong><small>K podpisu</small></span></button><button className={quick==="negotiation"?"active":""} onClick={()=>setQuick("negotiation")}><MessageSquare size={17}/><span><strong>{contracts.filter(item=>item.state==="Ve vyjednávání").length}</strong><small>Vyjednávání</small></span></button><button className={quick==="signed"?"active":""} onClick={()=>setQuick("signed")}><CheckCircle2 size={17}/><span><strong>{contracts.filter(item=>item.state==="Podepsána").length}</strong><small>Podepsané</small></span></button><button className={quick==="all"?"active":""} onClick={()=>setQuick("all")}><FileText size={17}/><span><strong>{contracts.length}</strong><small>Všechny</small></span></button></div>
    <section className="card module-card">
      <div className="module-toolbar contract-filter-bar"><div className="inline-search"><Search size={17}/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Smlouva, klient, jednotka…"/></div><MultiSelectFilter options={Array.from(new Set(contracts.map(item=>item.type)))} selected={typeFilter} onChange={setTypeFilter} allLabel="Všechny typy" ariaLabel="Filtrovat typ smlouvy"/><MultiSelectFilter options={Array.from(new Set(contracts.map(item=>item.state)))} selected={stateFilter} onChange={setStateFilter} allLabel="Všechny stavy" ariaLabel="Filtrovat stav smlouvy"/><MultiSelectFilter options={Array.from(new Set(contracts.map(item=>item.project)))} selected={projectFilter} onChange={setProjectFilter} allLabel="Všechny projekty" ariaLabel="Filtrovat projekt"/><SortControl value={sort} direction={direction} onChange={setSort} options={[{value:"updated",label:"Poslední změna"},{value:"state",label:"Stav"},{value:"type",label:"Typ"},{value:"client",label:"Klient"},{value:"unit",label:"Jednotka"},{value:"project",label:"Projekt"}]}/><span className="result-count">{rows.length} smluv</span></div>
      <div className="contract-table-head"><span>Smlouva a kontext</span><span>Průběh</span><span>Aktuální stav</span><span>Doporučená akce</span><span/></div>
      <div className="contract-hybrid-list">{rows.map(contract=>{const id=contract.id??`${contract.unit}-${contract.type}`;const step=contractStep(contract);const action=recommendedContractAction(contract);const isExpanded=expanded===id;return <article key={id} className={isExpanded?"expanded":""}>
        <div className="contract-hybrid-row" role="button" tabIndex={0} onClick={()=>openContract(contract)} onKeyDown={event=>{if(event.key==="Enter")openContract(contract);}}>
          <span className="contract-identity"><i>{contract.type}</i><span><strong>{contract.title??`${contract.type} · ${contract.unit}`}</strong><small>{contract.client} · {contract.project}</small></span></span>
          <button className="contract-mini-flow" onClick={event=>{event.stopPropagation();setExpanded(isExpanded?null:id);}} aria-label={`Zobrazit průběh ${contract.type} ${contract.unit}`}>{contractWorkflow.map((stage,index)=><span key={stage} className={index<step?"done":index===step?"current":""}><i>{index<step?<Check size={10}/>:index+1}</i><small>{stage}</small></span>)}</button>
          <span><Badge tone={statusClass(contract.state)}>{contract.state}</Badge><small className="row-updated">změněno {contract.updatedAt?formatPragueDateTime(contract.updatedAt):contract.updated}</small></span>
          <button className={`recommended-action ${action.tone}`} onClick={event=>{event.stopPropagation();if(action.tone==="neutral")openContract(contract);else if(onWorkflow)onWorkflow(contract);}}><small>DOPORUČENÁ AKCE</small><strong>{action.label}</strong><ArrowRight size={15}/></button>
          <details className="row-overflow" onClick={event=>event.stopPropagation()}><summary aria-label="Další akce"><MoreHorizontal size={18}/></summary><div><button onClick={()=>openClient(contract.client)}>Otevřít klienta</button><button onClick={()=>openUnit(units.find(unit=>unit.id===contract.unit)??units[0])}>Otevřít jednotku</button><button onClick={()=>openContract(contract)}>Detail smlouvy</button></div></details>
        </div>
        {isExpanded&&<div className="contract-expanded-flow"><div><strong>{contractWorkflow[step]}</strong><small>{contract.updatedAt?formatPragueDateTime(contract.updatedAt):contract.updated} · {contract.owner}</small><p>{action.reason}</p></div><button className="secondary-button compact" onClick={()=>openContract(contract)}>Celý detail</button>{onWorkflow&&availableContractTransitions(contract.statusCode??contract.state).length>0&&<button className="primary-button compact" onClick={()=>onWorkflow(contract)}>Změnit stav</button>}</div>}
      </article>;})}</div>
      {!rows.length&&<div className="empty-filter-state"><Search size={21}/><strong>Žádná smlouva neodpovídá filtrům</strong><small>Změňte rychlý pohled nebo některý z filtrů.</small></div>}
      <div className="table-footer compact-pagination"><button className="text-button" onClick={()=>notify("Seznam smluv je aktuální")}>Aktualizovat</button></div>
    </section>
  </div>;
}

const contractWorkflowSemantics = "Samostatný workflow dokumentu, nikoli obchodní stav jednotky.";
function ContractDetail({contract,close,openUnit,openClient,onWorkflow,onNewVersion,onSignParty,openDocument}:{contract:(typeof contracts)[number];close:()=>void;openUnit:(unit:UnitRecord)=>void;openClient:(identity:string)=>void;onWorkflow?:(contract:(typeof contracts)[number])=>void;onNewVersion?:(contract:(typeof contracts)[number])=>void;onSignParty?:(contract:(typeof contracts)[number],partyId:string,versionId:string,partyName:string)=>void;openDocument:(document:DocumentRecord)=>void}){
  void contractWorkflowSemantics;
  const [tab,setTab]=useState<"overview"|"history"|"versions"|"documents"|"activity"|"notes">("overview");const [documents,setDocuments]=useState<DocumentRecord[]>([]);const [loading,setLoading]=useState(false);const [selectedWorkflowStatus,setSelectedWorkflowStatus]=useState(normalizeContractStatus(contract.statusCode??contract.state));
  useEffect(()=>{if(tab!=="documents")return;const controller=new AbortController();Promise.resolve().then(()=>setLoading(true));documentRepository.listContract(contract.id??contract.reference??`${contract.unit}-${contract.type}`,controller.signal).then(result=>setDocuments(result.documents)).finally(()=>setLoading(false));return()=>controller.abort();},[tab,contract]);
  const step=contractStep(contract);const action=recommendedContractAction(contract);const history=contract.history??[];const selectedEvents=history.filter(event=>event.toStatus===selectedWorkflowStatus||event.fromStatus===selectedWorkflowStatus);const selectedStarted=history.find(event=>event.toStatus===selectedWorkflowStatus);const selectedCompleted=history.find(event=>event.fromStatus===selectedWorkflowStatus);const unit=units.find(item=>item.id===contract.unit)??units[0];const versions=contract.versions?.length?contract.versions:[{id:`${contract.id}-v1`,number:1,name:`${contract.type} ${contract.unit} · v1`,status:contract.state,basedOnVersionId:null,source:"CRM",createdAt:contract.updatedAt??contract.updated,signedAt:contract.state==="Podepsána"?(contract.updatedAt??contract.updated):null}];
  return <div className="contract-detail"><div className="unit-breadcrumb"><button onClick={close}><ArrowLeft size={16}/> Smlouvy</button><ChevronRight size={14}/><strong>{contract.reference??`${contract.type}-${contract.unit}`}</strong></div><section className="card contract-detail-hero"><span className="contract-type large">{contract.type}</span><div><span className="eyebrow">{contract.project} · {contract.unit}</span><h1>{contract.title??`${contract.type} · ${contract.client}`}</h1><p>{contract.reference??"Interní smluvní evidence"} · vlastník {contract.owner}</p></div><Badge tone={statusClass(contract.state)}>{contract.state}</Badge><div className="project-detail-actions">{onWorkflow&&<button className="primary-button" onClick={()=>onWorkflow(contract)}><SlidersHorizontal size={16}/> Změnit stav</button>}<details className="detail-overflow"><summary className="secondary-button"><MoreHorizontal size={16}/> Další</summary><div><button onClick={()=>openClient(contract.client)}>Otevřít klienta</button><button onClick={()=>openUnit(unit)}>Otevřít jednotku</button></div></details></div></section>
    <nav className="unit-tabs unit-detail-tabs contract-detail-tabs">{([["overview","Přehled",LayoutDashboard],["history","Historie",History],["versions","Verze",FileText],["documents","Dokumenty",FolderOpen],["activity","Aktivita",Activity],["notes","Poznámky",MessageSquare]] as const).map(([id,label,Icon])=><button key={id} className={tab===id?"active":""} onClick={()=>setTab(id)}><Icon size={17}/>{label}{id==="versions"&&<span>{versions.length}</span>}{id==="documents"&&documents.length>0&&<span>{documents.length}</span>}</button>)}</nav>
    {tab==="overview"&&<div className="contract-detail-grid"><section className="card contract-workflow-card"><div className="tab-card-header"><div><h2>Průběh smlouvy</h2><p>Kliknutím na krok zobrazíte jeho skutečnou historii.</p></div></div><div className="contract-detail-flow">{contractWorkflow.map((stage,index)=>{const code=CONTRACT_STATUS_ORDER[index];return <button type="button" key={stage} className={`${index<step?"done":index===step?"current":""} ${selectedWorkflowStatus===code?"selected":""}`} onClick={()=>setSelectedWorkflowStatus(code)}><i>{index<step?<Check size={12}/>:index+1}</i><strong>{stage}</strong><small>{index<step?"Dokončeno":index===step?"Aktuální krok":"Čeká"}</small></button>;})}</div><div className="workflow-step-detail"><strong>{contractStatusLabel(selectedWorkflowStatus)}</strong><dl><div><dt>Zahájeno</dt><dd>{selectedStarted?formatPragueDateTime(selectedStarted.occurredAt):"Bez záznamu"}</dd></div><div><dt>Dokončeno</dt><dd>{selectedCompleted?formatPragueDateTime(selectedCompleted.occurredAt):"—"}</dd></div><div><dt>Změnil</dt><dd>{selectedStarted?.actor??"—"}</dd></div></dl>{selectedStarted&&<p>{selectedStarted.note}</p>}{selectedEvents.length>1&&<small>{selectedEvents.length} události tohoto kroku v historii</small>}</div><div className="next-action contract-next-action"><span><Sparkles size={18}/></span><div><small>DOPORUČENÝ DALŠÍ KROK</small><strong>{action.label}</strong><p>{action.reason} · odpovědná osoba {contract.owner}</p></div>{onWorkflow&&availableContractTransitions(contract.statusCode??contract.state).length>0&&<button className="primary-button" onClick={()=>onWorkflow(contract)}>Provést akci</button>}</div></section><aside className="card contract-context-card"><SectionTitle title="Vazby smlouvy"/><button onClick={()=>openUnit(unit)}><Home size={17}/><span><small>Jednotka</small><strong>{contract.unit} · {unit.layout}</strong></span><ChevronRight size={16}/></button><button onClick={()=>openClient(contract.client)}><UserRound size={17}/><span><small>Klient / účastníci</small><strong>{contract.client}</strong></span><ChevronRight size={16}/></button><div><Building2 size={17}/><span><small>Projekt</small><strong>{contract.project}</strong></span></div></aside></div>}
    {tab==="history"&&<ContractEventHistory history={history} emptyUpdated={contract.updatedAt??contract.updated} emptyOwner={contract.owner}/>}
    {tab==="versions"&&<section className="card detail-tab-card"><div className="tab-card-header"><div><h2>Logické verze smlouvy</h2><p>Podepsaná verze je neměnná; nová verze navazuje na předchozí.</p></div>{onNewVersion&&normalizeContractStatus(contract.statusCode??contract.state)!=="signed"&&<button className="primary-button" onClick={()=>onNewVersion(contract)}><Plus size={15}/> Nová verze</button>}</div><div className="document-version-list">{versions.map(version=><article key={version.id}><span className="version-badge">v{version.number}</span><span><strong>{version.name}</strong><small>{version.source} · vytvořeno {formatPragueDateTime(version.createdAt)}{version.signedAt?` · podepsáno ${formatPragueDateTime(version.signedAt)}`:""}</small></span><Badge tone={statusClass(version.status)}>{version.status}</Badge></article>)}</div>{onSignParty&&versions[0]&&normalizeContractStatus(contract.statusCode??contract.state)==="signing"&&<div className="contract-signature-panel"><div><h3>Podpisy účastníků</h3><p>Podpisy se zapisují k nejnovější verzi. Poslední podpis dokončí RS a automaticky vytvoří předpis rezervačního poplatku.</p></div>{(contract.parties??[]).map(party=><article key={party.id}><span><UserRound size={16}/><span><strong>{party.name}</strong><small>{party.role==="buyer"?"Kupující":party.role==="co_buyer"?"Spolukupující":party.role} · {party.signatureStatus==="signed"?"podepsáno":"čeká na podpis"}</small></span></span>{party.signatureStatus==="signed"?<Badge tone="success">Podepsáno</Badge>:<button className="secondary-button compact" onClick={()=>onSignParty(contract,party.id,versions[0].id,party.name)}><FileCheck2 size={15}/> Zaznamenat podpis</button>}</article>)}</div>}</section>}
    {tab==="documents"&&<section className="card detail-tab-card"><div className="tab-card-header"><div><h2>Související dokumenty</h2><p>Dokumenty jsou propojené konkrétní vazbou na tuto smlouvu.</p></div></div><DocumentList documents={documents} loading={loading} notify={()=>{}} openDocument={openDocument}/></section>}
    {tab==="activity"&&<ContractEventHistory history={history} emptyUpdated={contract.updatedAt??contract.updated} emptyOwner={contract.owner} activity/>}
    {tab==="notes"&&<section className="card detail-tab-card"><div className="tab-card-header"><div><h2>Interní poznámky</h2><p>Poznámky nejsou fyzickou verzí smlouvy.</p></div><button className="secondary-button"><Plus size={15}/> Přidat poznámku</button></div><div className="empty-filter-state"><MessageSquare size={21}/><strong>Zatím bez poznámek</strong><small>Nová poznámka se zobrazí v aktivitě smlouvy.</small></div></section>}
  </div>;
}

function ContractEventHistory({history,emptyUpdated,emptyOwner,activity=false}:{history:NonNullable<(typeof contracts)[number]["history"]>;emptyUpdated:string;emptyOwner:string;activity?:boolean}){
  return <section className="card detail-tab-card"><div className="tab-card-header"><div><h2>{activity?"Aktivita smlouvy":"Historie workflow"}</h2><p>{activity?"Stavové a obchodní události smlouvy.":"Append-only stopa skutečných stavových změn."}</p></div></div><div className="document-timeline">{history.length?history.map(event=><article key={event.id}><span>{activity?<Activity size={15}/>:<History size={15}/>}</span><div><strong>{event.fromStatus?`${contractStatusLabel(event.fromStatus)} → ${contractStatusLabel(event.toStatus)}`:`Vznikl stav ${contractStatusLabel(event.toStatus)}`}</strong><p>{event.note||"Bez poznámky"}</p><small>{formatPragueDateTime(event.occurredAt)} · {event.actor} · {event.source==="manual"?"ruční změna":event.source}</small></div></article>):<article><span><History size={15}/></span><div><strong>Dosud bez stavové události</strong><p>První změna workflow vytvoří append-only historický záznam.</p><small>{emptyUpdated} · {emptyOwner}</small></div></article>}</div></section>;
}

function PaymentsPage({openUnit,notify,canRecord,canReverse,canImport}:{openUnit:(unit:UnitRecord)=>void;notify:(message:string)=>void;canRecord:boolean;canReverse:boolean;canImport:boolean}){
  const router=useRouter();const pathname=usePathname();const searchParams=useSearchParams();const now=useClock();const [rows,setRows]=useState<PaymentRecord[]>([]);const [loading,setLoading]=useState(true);const [error,setError]=useState("");const [source,setSource]=useState("");const [selected,setSelected]=useState<PaymentRecord|null>(null);const [importRows,setImportRows]=useState<ImportPreviewRow[]|null>(null);
  const query=searchParams.get("pq")??"";const status=searchParams.get("ps")??"";const sort=searchParams.get("sort")??"dueAt";const direction=(searchParams.get("dir")==="desc"?"desc":"asc") as SortDirection;
  const reload=()=>{setLoading(true);setError("");paymentRepository.list({query,sort,direction}).then(result=>{setRows(result.payments);setSource(result.source);}).catch(err=>setError(err instanceof Error?err.message:"Platby nelze načíst")).finally(()=>setLoading(false));};
  useEffect(()=>{const controller=new AbortController();paymentRepository.list({query,sort,direction},controller.signal).then(result=>{setRows(result.payments);setSource(result.source);setError("");}).catch(err=>{if((err as Error).name!=="AbortError")setError(err instanceof Error?err.message:"Platby nelze načíst");}).finally(()=>setLoading(false));return()=>controller.abort();},[query,sort,direction]);const change=(patch:Record<string,string>)=>router.replace(updateSearch(pathname,searchParams.toString(),patch),{scroll:false});
  const visible=rows.filter(row=>!status||row.status===status);const paid=rows.reduce((sum,row)=>sum+row.paid,0);const soon=rows.filter(row=>row.status==="pending"&&new Date(row.dueAt).getTime()-(now?.getTime()??0)<14*86400000).reduce((sum,row)=>sum+(row.amount-row.paid),0);const overdue=rows.filter(row=>row.status==="overdue").reduce((sum,row)=>sum+(row.amount-row.paid),0);
  return <div className="module-stack"><div className="metric-row payments-metrics"><div className="metric-card wide"><span className="metric-icon green"><Banknote size={20}/></span><span><small>Uhrazeno</small><strong>{formatMoney(paid)}</strong><em>skutečné nereverzované úhrady</em></span></div><div className="metric-card wide"><span className="metric-icon sand"><Clock3 size={20}/></span><span><small>Splatné do 14 dní</small><strong>{formatMoney(soon)}</strong><em>odvozeno z předpisů</em></span></div><div className="metric-card wide danger-metric"><span className="metric-icon red"><AlertTriangle size={20}/></span><span><small>Po splatnosti</small><strong>{formatMoney(overdue)}</strong><em>{rows.filter(row=>row.status==="overdue").length} předpisů</em></span></div></div>
    <section className="card module-card"><div className="table-action-bar"><span><strong>{visible.length}</strong> plateb · {source==="preview-adapter"?"preview data přetrvají v tomto prohlížeči":"produkční databáze"}</span>{canImport&&<label className="secondary-button compact file-button"><Upload size={16}/> Import CSV · nejdřív náhled<input type="file" accept=".csv,text/csv" onChange={async event=>{const file=event.target.files?.[0];if(!file)return;try{setImportRows(await paymentRepository.previewCsv(await file.text()));}catch(err){notify(err instanceof Error?err.message:"Výpis nelze načíst");}event.target.value="";}}/></label>}</div>
      <div className="unit-table-wrap"><table className="data-table payment-table filter-table"><thead><tr><TableColumnFilter label="Jednotka / klient" active={Boolean(query)} sortDirection={sort==="unit"?direction:undefined} onSort={next=>change({sort:"unit",dir:next})}><input value={query} onChange={event=>change({pq:event.target.value})} placeholder="Jednotka, klient…" aria-label="Filtrovat platbu"/></TableColumnFilter><TableColumnFilter label="Splátka" sortDirection={sort==="label"?direction:undefined} onSort={next=>change({sort:"label",dir:next})}/><TableColumnFilter label="Splatnost" sortType="date" sortDirection={sort==="dueAt"?direction:undefined} onSort={next=>change({sort:"dueAt",dir:next})}/><TableColumnFilter label="Předpis" sortType="number" sortDirection={sort==="amount"?direction:undefined} onSort={next=>change({sort:"amount",dir:next})}/><TableColumnFilter label="Uhrazeno" sortType="number" sortDirection={sort==="paid"?direction:undefined} onSort={next=>change({sort:"paid",dir:next})}/><TableColumnFilter label="Stav" active={Boolean(status)} sortDirection={sort==="status"?direction:undefined} onSort={next=>change({sort:"status",dir:next})}><MultiSelectFilter options={Object.values(paymentStatusLabel)} selected={status?[paymentStatusLabel[status as PaymentStatus]]:[]} onChange={values=>change({ps:Object.entries(paymentStatusLabel).find(([,label])=>label===values.at(-1))?.[0]??""})} allLabel="Všechny stavy" ariaLabel="Filtrovat stav platby"/></TableColumnFilter><th/></tr></thead><tbody>{visible.map(row=><PaymentTableRow key={row.id} row={row} onClick={()=>setSelected(row)}/>)}</tbody></table></div>
      {loading&&<div className="empty-filter-state"><Clock3 size={21}/><strong>Načítám platby…</strong></div>}{error&&<div className="empty-filter-state"><AlertTriangle size={21}/><strong>Platby nelze načíst</strong><small>{error}</small><button className="secondary-button compact" onClick={reload}>Zkusit znovu</button></div>}{!loading&&!error&&!visible.length&&<div className="empty-filter-state"><Banknote size={21}/><strong>Žádné platby neodpovídají filtrům</strong><small>Změňte filtr v hlavičce tabulky.</small></div>}</section>
    {selected&&<PaymentDetailModal payment={selected} close={()=>setSelected(null)} openUnit={()=>openUnit(units.find(unit=>unit.id===selected.unit)??units[0])} canRecord={canRecord} canReverse={canReverse} saved={()=>{setSelected(null);reload();notify("Platební historie byla aktualizována");}}/>}
    {importRows&&<BankImportModal rows={importRows} close={()=>setImportRows(null)} confirm={async()=>{const count=await paymentRepository.confirmImport(importRows);setImportRows(null);reload();notify(`Potvrzeno a spárováno ${count} transakcí`);}}/>}
  </div>;
}

function PaymentTableRow({row,onClick}:{row:PaymentRecord;onClick:()=>void}){const percent=Math.min(100,Math.round(row.paid/row.amount*100));return <tr onClick={onClick} tabIndex={0} onKeyDown={event=>event.key==="Enter"&&onClick()}><td><strong>{row.unit} · {row.client}</strong><small>{row.project}</small></td><td>{row.label}{row.type==="reservation_fee"&&row.status!=="paid"&&<small>Čeká na rezervační poplatek</small>}</td><td>{formatPragueDate(row.dueAt)}</td><td><strong>{formatMoney(row.amount)}</strong></td><td><strong>{formatMoney(row.paid)}</strong><span className="payment-progress"><i style={{width:`${percent}%`}}/></span></td><td><Badge tone={row.status==="overdue"?"danger":row.status==="paid"?"success":row.status==="overpaid"?"warning":"neutral"}>{paymentStatusLabel[row.status]}</Badge></td><td><ChevronRight size={18}/></td></tr>}

function PaymentDetailModal({payment,close,openUnit,canRecord,canReverse,saved}:{payment:PaymentRecord;close:()=>void;openUnit:()=>void;canRecord:boolean;canReverse:boolean;saved:()=>void}){const [recording,setRecording]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState("");return <div className="modal-layer"><button className="modal-scrim" onClick={close} aria-label="Zavřít detail platby"/><div className="modal payment-detail-modal"><div className="modal-head"><div><span className="eyebrow">{payment.project} · {payment.unit}</span><h2>{payment.label}</h2><p>{payment.contractReference??"Bez smlouvy"} · VS {payment.variableSymbol??"—"}</p></div><button className="icon-button" onClick={close}><X size={19}/></button></div><div className="payment-detail-summary"><span><small>PŘEDPIS</small><strong>{formatMoney(payment.amount)}</strong></span><span><small>UHRAZENO</small><strong>{formatMoney(payment.paid)}</strong></span><span><small>ZBÝVÁ</small><strong>{formatMoney(Math.max(0,payment.amount-payment.paid))}</strong></span><Badge tone={payment.status==="overdue"?"danger":payment.status==="paid"?"success":"neutral"}>{paymentStatusLabel[payment.status]}</Badge></div><div className="context-links"><button onClick={openUnit}><Home size={16}/><span><small>Jednotka</small><strong>{payment.unit}</strong></span><ChevronRight size={15}/></button><div><UserRound size={16}/><span><small>Klient</small><strong>{payment.client}</strong></span></div><div><FileText size={16}/><span><small>Smlouva / obchodní proces</small><strong>{payment.contractReference??payment.salesCaseId}</strong></span></div></div>{recording&&<PaymentRecordForm payment={payment} busy={busy} error={error} cancel={()=>setRecording(false)} save={async value=>{setBusy(true);setError("");try{await paymentRepository.record(payment.id,value);saved();}catch(err){setError(err instanceof Error?err.message:"Úhradu nelze uložit");setBusy(false);}}}/>}<section className="payment-history"><div className="tab-card-header"><div><h3>Historie úhrad</h3><p>Reverzace historii nemaže.</p></div>{canRecord&&!recording&&<button className="primary-button compact" onClick={()=>setRecording(true)}><Plus size={15}/> Zaznamenat úhradu</button>}</div>{payment.transactions.length?payment.transactions.map(tx=><article key={tx.id} className={tx.reversedAt?"reversed":""}><span><Banknote size={17}/></span><span><strong>{formatMoney(tx.amount)}</strong><small>{formatPragueDateTime(tx.paidAt)} · {tx.counterpartyAccount??"ruční úhrada"}{tx.reversedAt?` · REVERZOVÁNO: ${tx.reversalReason}`:""}</small></span>{canReverse&&!tx.reversedAt&&<button className="text-button" disabled={busy} onClick={async()=>{const reason=window.prompt("Důvod reverzace");if(!reason)return;setBusy(true);try{await paymentRepository.reverse(tx.id,reason);saved();}catch(err){setError(err instanceof Error?err.message:"Reverzaci nelze provést");setBusy(false);}}}>Reverzovat</button>}</article>):<div className="empty-filter-state"><Banknote size={20}/><strong>Zatím bez úhrady</strong></div>}</section>{error&&!recording&&<p className="form-error">{error}</p>}</div></div>}

function PaymentRecordForm({payment,busy,error,cancel,save}:{payment:PaymentRecord;busy:boolean;error:string;cancel:()=>void;save:(value:{amount:number;paidAt:string;variableSymbol?:string;counterpartyAccount?:string;bankTransactionId?:string;note?:string})=>void}){const [amount,setAmount]=useState(String(Math.max(0,payment.amount-payment.paid)));const [paidAt,setPaidAt]=useState(new Date().toISOString().slice(0,16));const [account,setAccount]=useState("");const [note,setNote]=useState("");return <form className="inline-payment-form" onSubmit={event=>{event.preventDefault();save({amount:Number(amount),paidAt:new Date(paidAt).toISOString(),variableSymbol:payment.variableSymbol,counterpartyAccount:account,note});}}><label><span>Částka</span><input required min="0.01" step="0.01" type="number" value={amount} onChange={event=>setAmount(event.target.value)}/></label><label><span>Datum a čas</span><input required type="datetime-local" value={paidAt} onChange={event=>setPaidAt(event.target.value)}/></label><label><span>Účet protistrany</span><input value={account} onChange={event=>setAccount(event.target.value)}/></label><label className="full"><span>Poznámka</span><input value={note} onChange={event=>setNote(event.target.value)}/></label>{error&&<p className="form-error full">{error}</p>}<div className="modal-actions full"><button type="button" className="secondary-button" onClick={cancel}>Zrušit</button><button className="primary-button" disabled={busy}>{busy?"Ukládám…":"Uložit úhradu"}</button></div></form>}

function BankImportModal({rows,close,confirm}:{rows:ImportPreviewRow[];close:()=>void;confirm:()=>Promise<void>}){const [busy,setBusy]=useState(false);const ready=rows.filter(row=>!row.duplicate&&row.proposedObligationId).length;return <div className="modal-layer"><button className="modal-scrim" onClick={close} aria-label="Zavřít náhled importu"/><div className="modal bank-import-modal"><div className="modal-head"><div><h2>Náhled bankovního výpisu</h2><p>Žádná transakce nebude spárována bez vašeho potvrzení.</p></div><button className="icon-button" onClick={close}><X size={19}/></button></div><div className="unit-table-wrap"><table className="data-table"><thead><tr><th>Řádek</th><th>Datum</th><th>Částka</th><th>VS / účet</th><th>Návrh spárování</th><th>Kontrola</th></tr></thead><tbody>{rows.map(row=><tr key={row.row}><td>{row.row}</td><td>{formatPragueDate(row.paidAt)}</td><td><strong>{formatMoney(row.amount)}</strong></td><td>{row.variableSymbol||"—"}<small>{row.counterpartyAccount}</small></td><td>{row.proposedLabel??"Bez návrhu"}<small>{row.confidence?`${row.confidence} % shoda`:""}</small></td><td><Badge tone={row.duplicate?"danger":row.proposedObligationId?"success":"warning"}>{row.duplicate?"Duplicita":row.proposedObligationId?"Připraveno":"Vyžaduje ruční přiřazení"}</Badge></td></tr>)}</tbody></table></div><div className="modal-actions"><button className="secondary-button" onClick={close}>Zrušit</button><button className="primary-button" disabled={!ready||busy} onClick={async()=>{setBusy(true);await confirm();}}>{busy?"Potvrzuji…":`Potvrdit ${ready} transakcí`}</button></div></div></div>}

function HandoversPage({ openUnit, notify,reloadKey }: { openUnit: (unit: UnitRecord) => void; notify: (message: string) => void;reloadKey:number }) {
  const now=useClock();const router=useRouter();const pathname=usePathname();const searchParams=useSearchParams();const [rows,setRows]=useState<HandoverRecord[]>([]);const [loading,setLoading]=useState(true);const [loadError,setLoadError]=useState(false);const [weekOffset,setWeekOffset]=useState(Number(searchParams.get("week")??0));const projectFilters=listParam(searchParams,"project");const statusFilters=listParam(searchParams,"status");const ownerFilters=listParam(searchParams,"owner");const warningFilters=listParam(searchParams,"warning");const query=searchParams.get("query")??"";const readinessFrom=searchParams.get("readyFrom")??"";const readinessTo=searchParams.get("readyTo")??"";const dateFrom=searchParams.get("dateFrom")??"";const dateTo=searchParams.get("dateTo")??"";const sort=searchParams.get("sort")??"date";const direction=(searchParams.get("dir")==="desc"?"desc":"asc") as SortDirection;
  const statusLabel=(value:string)=>({planned:"Naplánováno",ready:"Připraveno",in_progress:"Probíhá",completed:"Dokončeno",cancelled:"Zrušeno"} as Record<string,string>)[value]??value;
  useEffect(()=>{const controller=new AbortController();Promise.resolve().then(()=>{setLoading(true);setLoadError(false);});handoverRepository.list({},controller.signal).then(setRows).catch(error=>{if((error as Error).name!=="AbortError"){setRows([]);setLoadError(true);}}).finally(()=>setLoading(false));return()=>controller.abort();},[reloadKey]);
  const change=(patch:Record<string,string|string[]>)=>router.replace(updateSearch(pathname,searchParams.toString(),patch),{scroll:false});
  const filtered=rows.filter(row=>(!projectFilters.length||projectFilters.includes(row.project))&&(!statusFilters.length||statusFilters.includes(statusLabel(row.status)))&&(!ownerFilters.length||ownerFilters.includes(row.owner))&&(!query||`${row.unit} ${row.client}`.toLocaleLowerCase("cs-CZ").includes(query.toLocaleLowerCase("cs-CZ")))&&(!readinessFrom||row.readiness>=Number(readinessFrom))&&(!readinessTo||row.readiness<=Number(readinessTo))&&(!dateFrom||localDateKey(new Date(row.scheduledAt))>=dateFrom)&&(!dateTo||localDateKey(new Date(row.scheduledAt))<=dateTo)&&(!warningFilters.length||(warningFilters.includes("S upozorněním")&&Boolean(row.attention))||(warningFilters.includes("Bez upozornění")&&!row.attention)));
  const sorted=stableSort(filtered,row=>sort==="project"?row.project:sort==="unit"?`${row.unit} ${row.client}`:sort==="owner"?row.owner:sort==="readiness"?row.readiness:sort==="status"?Object.keys({planned:0,ready:1,in_progress:2,completed:3,cancelled:4}).indexOf(row.status):sort==="attention"?String(Boolean(row.attention)):new Date(row.scheduledAt),direction,row=>row.id);
  const calendarRows=stableSort(rows,row=>new Date(row.scheduledAt),"asc",row=>row.id);
  const start=addCalendarDays(now??new Date(),weekOffset*7);const days=Array.from({length:7},(_,index)=>addCalendarDays(start,index));const todayKey=now?localDateKey(now):"";
  const futureRows=sorted.filter(row=>localDateKey(new Date(row.scheduledAt))>=todayKey);
  const activeFilters=query||projectFilters.length||statusFilters.length||ownerFilters.length||warningFilters.length||readinessFrom||readinessTo||dateFrom||dateTo;
  return (
    <div className="module-stack handover-workspace">
      <section className="card handover-week-card"><div className="handover-week-head"><div><span className="eyebrow">TÝDENNÍ KALENDÁŘ</span><h2>{formatPragueDate(start,{month:"long",year:"numeric"})}</h2><p>{formatPragueDate(start)} – {formatPragueDate(days[6])}</p></div><div><button className="secondary-button compact" onClick={()=>{setWeekOffset(value=>value-1);change({week:String(weekOffset-1)});}}><ChevronRight className="rotate-180" size={16}/> Předchozí</button><button className="secondary-button compact" onClick={()=>{setWeekOffset(0);change({week:""});notify("Zobrazen dnešní den");}}>Dnes</button><button className="secondary-button compact" onClick={()=>{setWeekOffset(value=>value+1);change({week:String(weekOffset+1)});}}>Další <ChevronRight size={16}/></button></div></div>
        <div className="handover-week-grid">{days.map(day=>{const key=localDateKey(day);const events=calendarRows.filter(row=>localDateKey(new Date(row.scheduledAt))===key);return <section key={key} className={key===todayKey?"today":""}><header><small>{new Intl.DateTimeFormat("cs-CZ",{weekday:"short",timeZone:"Europe/Prague"}).format(day)}</small><strong>{new Intl.DateTimeFormat("cs-CZ",{day:"numeric",month:"numeric",timeZone:"Europe/Prague"}).format(day)}</strong>{key===todayKey&&<Badge tone="success">Dnes</Badge>}</header><div>{events.map(event=><button key={event.id} className="handover-event" onClick={()=>openUnit(units.find(unit=>unit.id===event.unit)??units[0])}><strong>{formatPragueTime(event.scheduledAt)} · {event.unit}</strong><span>{event.client}</span><small>{event.project}</small><small>{event.owner}</small><Badge tone={event.status==="ready"?"success":event.attention?"warning":"neutral"}>{statusLabel(event.status)}</Badge></button>)}{!events.length&&<span className="handover-empty">Bez předání</span>}</div></section>;})}</div>
      </section>
      <section className="card module-card"><div className="tab-card-header"><div><h2>Budoucí předání</h2></div>{activeFilters&&<button className="text-button" onClick={()=>change({project:"",status:"",owner:"",warning:"",query:"",readyFrom:"",readyTo:"",dateFrom:"",dateTo:""})}>Zrušit filtry</button>}</div>
        {loading?<div className="empty-filter-state"><Clock3 size={21}/><strong>Načítám předání…</strong></div>:loadError?<div className="empty-filter-state"><AlertTriangle size={21}/><strong>Předání se nepodařilo načíst</strong><small>Zkontrolujte oprávnění nebo připojení backendu.</small></div>:<div className="handover-future-list"><div className="handover-future-head">
          <ListColumnFilter label="Termín" active={Boolean(dateFrom||dateTo)} sortType="date" sortDirection={sort==="date"?direction:undefined} onSort={next=>change({sort:"date",dir:next})}><span className="column-range date-range"><input type="date" value={dateFrom} onChange={event=>change({dateFrom:event.target.value})} aria-label="Předání od"/><i>–</i><input type="date" value={dateTo} onChange={event=>change({dateTo:event.target.value})} aria-label="Předání do"/></span></ListColumnFilter>
          <ListColumnFilter label="Jednotka a klient" active={Boolean(query||projectFilters.length)} sortDirection={sort==="unit"?direction:undefined} onSort={next=>change({sort:"unit",dir:next})}><input value={query} onChange={event=>change({query:event.target.value})} placeholder="Jednotka nebo klient…" aria-label="Filtrovat jednotku nebo klienta"/><span className="column-filter-subtitle">Projekt</span><MultiSelectFilter options={Array.from(new Set(rows.map(row=>row.project)))} selected={projectFilters} onChange={values=>change({project:values})} allLabel="Všechny projekty" ariaLabel="Filtrovat projekt předání"/></ListColumnFilter>
          <ListColumnFilter label="Odpovědná osoba" active={ownerFilters.length>0} sortDirection={sort==="owner"?direction:undefined} onSort={next=>change({sort:"owner",dir:next})}><MultiSelectFilter options={Array.from(new Set(rows.map(row=>row.owner)))} selected={ownerFilters} onChange={values=>change({owner:values})} allLabel="Všichni odpovědní" ariaLabel="Filtrovat odpovědnou osobu"/></ListColumnFilter>
          <ListColumnFilter label="Připravenost" active={Boolean(readinessFrom||readinessTo)} sortType="number" sortDirection={sort==="readiness"?direction:undefined} onSort={next=>change({sort:"readiness",dir:next})}><span className="column-range"><input inputMode="numeric" value={readinessFrom} onChange={event=>change({readyFrom:event.target.value})} placeholder="Od %" aria-label="Připravenost od"/><i>–</i><input inputMode="numeric" value={readinessTo} onChange={event=>change({readyTo:event.target.value})} placeholder="Do %" aria-label="Připravenost do"/></span></ListColumnFilter>
          <ListColumnFilter label="Stav" active={statusFilters.length>0} sortDirection={sort==="status"?direction:undefined} onSort={next=>change({sort:"status",dir:next})}><MultiSelectFilter options={Array.from(new Set(rows.map(row=>statusLabel(row.status))))} selected={statusFilters} onChange={values=>change({status:values})} allLabel="Všechny stavy" ariaLabel="Filtrovat stav předání"/></ListColumnFilter>
          <ListColumnFilter label="Upozornění" active={warningFilters.length>0} sortDirection={sort==="attention"?direction:undefined} onSort={next=>change({sort:"attention",dir:next})}><MultiSelectFilter options={["S upozorněním","Bez upozornění"]} selected={warningFilters} onChange={values=>change({warning:values})} allLabel="Všechna předání" ariaLabel="Filtrovat upozornění předání"/></ListColumnFilter>
          <span/>
        </div>{futureRows.map(event=><article key={event.id} onClick={()=>openUnit(units.find(unit=>unit.id===event.unit)??units[0])}><div className="handover-future-date"><strong>{formatPragueDate(event.scheduledAt,{day:"numeric",month:"short"})}</strong><span>{formatPragueTime(event.scheduledAt)}</span></div><span className="handover-future-unit"><strong>{event.unit} · {event.client}</strong><small>{event.project}</small></span><span className="handover-future-owner"><small>Odpovědná osoba</small><strong>{event.owner}</strong></span><span className="readiness"><small>Připravenost {event.readiness} %</small><i><b style={{width:`${event.readiness}%`}}/></i></span><span className="handover-future-status"><Badge tone={event.status==="ready"?"success":event.attention?"warning":"neutral"}>{statusLabel(event.status)}</Badge></span><span className={`handover-warning-slot${event.attention?" has-warning":""}`}>{event.attention&&<><AlertTriangle size={15}/>{event.attention}</>}</span><ChevronRight className="handover-future-open" size={17}/></article>)}{!futureRows.length&&<div className="empty-filter-state"><CalendarDays size={22}/><strong>Žádné budoucí předání neodpovídá filtrům</strong><small>Změňte filtry nebo přejděte na jiné období.</small></div>}</div>}
      </section>
    </div>
  );
}

function TasksPage({ rows, toggleTask, openUnit,scope,onScope,loading }: { rows: TaskRecord[]; toggleTask: (id: string|number) => void; openUnit: (unit: UnitRecord) => void;scope:"mine"|"all"|"completed";onScope:(scope:"mine"|"all"|"completed")=>void;loading:boolean }) {
  const router=useRouter();const pathname=usePathname();const searchParams=useSearchParams();const sort=searchParams.get("sort")??"due";const direction=(searchParams.get("dir")==="desc"?"desc":"asc") as SortDirection;const sortedRows=stableSort(rows,row=>sort==="updated"?row.updatedAt??"":sort==="priority"?({Vysoká:3,Střední:2,Nízká:1} as Record<string,number>)[row.priority]??0:sort==="state"?String(row.done):sort==="owner"?row.owner:row.dueAt??row.due,direction,row=>String(row.id));
  return (
    <section className="card module-card tasks-module">
      <nav className="task-tabs" aria-label="Pohledy úkolů"><button className={scope==="mine"?"active":""} aria-current={scope==="mine"?"page":undefined} onClick={()=>onScope("mine")}><UserRound className="task-tab-icon" size={17} /> Moje úkoly {scope==="mine"&&<span>{rows.length}</span>}</button><button className={scope==="all"?"active":""} aria-current={scope==="all"?"page":undefined} onClick={()=>onScope("all")}><List className="task-tab-icon" size={17} /> Všechny {scope==="all"&&<span>{rows.length}</span>}</button><button className={scope==="completed"?"active":""} aria-current={scope==="completed"?"page":undefined} onClick={()=>onScope("completed")}><CheckCircle2 className="task-tab-icon" size={17} /> Dokončené {scope==="completed"&&<span>{rows.length}</span>}</button><div /><SortControl value={sort} direction={direction} onChange={(value,next)=>router.replace(updateSearch(pathname,searchParams.toString(),{sort:value,dir:next}),{scroll:false})} options={[{value:"due",label:"Termín"},{value:"priority",label:"Priorita"},{value:"state",label:"Stav"},{value:"owner",label:"Přiřazený uživatel"},{value:"updated",label:"Poslední změna"}]}/></nav>
      <div className="task-section-label"><span>Dnes</span><i /></div>
      <div className="large-task-list">
        {loading?<div className="empty-next"><Clock3 size={20}/><span><strong>Načítám úkoly…</strong><small>Aktualizuji zvolený pohled.</small></span></div>:sortedRows.map((task) => <article key={task.id} className={task.done ? "done" : ""}>
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

function AdminUsersPage({notify}:{notify:(message:string)=>void}){
  const [snapshot,setSnapshot]=useState<AdminSnapshot|null>(null);const [loading,setLoading]=useState(true);const [tab,setTab]=useState<"users"|"roles">("users");const [editing,setEditing]=useState<AdminUser|"new"|null>(null);const [editingRole,setEditingRole]=useState<AdminRole|null>(null);
  const reload=()=>{setLoading(true);adminRepository.getSnapshot().then(setSnapshot).catch(()=>setSnapshot(null)).finally(()=>setLoading(false));};
  useEffect(()=>{adminRepository.getSnapshot().then(setSnapshot).catch(()=>setSnapshot(null)).finally(()=>setLoading(false));},[]);
  if(loading)return <section className="card module-card"><div className="empty-filter-state"><Clock3 size={22}/><strong>Načítám administraci…</strong></div></section>;
  if(!snapshot)return <section className="card module-card"><div className="empty-filter-state"><AlertTriangle size={22}/><strong>Administraci se nepodařilo načíst</strong><button className="secondary-button compact" onClick={reload}>Zkusit znovu</button></div></section>;
  const capability=(role:AdminRole,kind:string)=>role.permissionCodes.some(code=>{const operation=getPermissionDefinition(code).operation;return kind==="view"?operation==="view":kind==="create"?["create","import"].includes(operation):kind==="edit"?["update","manage","assign","record"].includes(operation):kind==="approve"?["review","approve"].includes(operation):kind==="archive"?operation==="archive":operation==="export";});
  return <div className="module-stack admin-page"><nav className="workspace-subnav"><button className={tab==="users"?"active":""} onClick={()=>setTab("users")}><Users size={17}/> Uživatelé</button><button className={tab==="roles"?"active":""} onClick={()=>setTab("roles")}><ShieldCheck size={17}/> Role a oprávnění</button></nav>
    {tab==="users"?<section className="card module-card"><div className="tab-card-header"><div><h2>Uživatelé workspace</h2><p>Přihlášení zajišťuje Microsoft Entra ID. CRM nespravuje hesla.</p></div><button className="primary-button" onClick={()=>setEditing("new")}><Plus size={16}/> Pozvat uživatele</button></div><div className="unit-table-wrap"><table className="data-table admin-users-table"><thead><tr><th>Uživatel</th><th>Pracovní role</th><th>Efektivní rozsah</th><th>Poslední přihlášení</th><th>Stav</th><th/></tr></thead><tbody>{snapshot.users.map(user=><tr key={user.membershipId} onClick={()=>setEditing(user)}><td><span className="person-cell"><Avatar initials={initials(user.name)} small/><span><strong>{user.name}</strong><small>{user.email}{user.jobTitle?` · ${user.jobTitle}`:""}</small></span></span></td><td>{user.roleIds.map(id=><Badge key={id} tone="neutral">{snapshot.roles.find(role=>role.id===id)?.name??id}</Badge>)}</td><td><strong>{user.projectIds.length?`${user.projectIds.length} projektů`:"Workspace"}</strong><small>{new Set(user.roleIds.flatMap(id=>snapshot.roles.find(role=>role.id===id)?.permissionCodes??[])).size} efektivních oprávnění</small></td><td>{user.lastLoginAt?formatPragueDateTime(user.lastLoginAt):"Dosud nepřihlášen"}</td><td><Badge tone={user.status==="active"?"success":user.status==="invited"?"warning":"neutral"}>{({active:"Aktivní",invited:"Pozván",suspended:"Deaktivován",archived:"Odebraný přístup"} as Record<string,string>)[user.status]}</Badge></td><td><ChevronRight size={17}/></td></tr>)}</tbody></table></div></section>:<section className="card module-card"><div className="tab-card-header"><div><h2>Matice oprávnění</h2><p>Efektivní práva jsou vynucena backendem a RLS; ozubené kolečko vždy otevře detail role.</p></div></div><div className="unit-table-wrap"><table className="data-table permission-matrix"><thead><tr><th>Role</th>{["Zobrazit","Vytvářet","Upravovat","Schvalovat","Archivovat","Exportovat"].map(label=><th key={label}>{label}</th>)}<th/></tr></thead><tbody>{snapshot.roles.map(role=><tr key={role.id}><td><strong>{role.name} <Badge tone="neutral">{role.assignedUserCount??0} uživ.</Badge></strong><small>{role.description}</small></td>{["view","create","edit","approve","archive","export"].map(kind=><td key={kind}>{capability(role,kind)?<CheckCircle2 size={18} className="permission-yes"/>:<span className="permission-no">—</span>}</td>)}<td><button className="ghost-icon" onClick={()=>setEditingRole(role)} aria-label={`Otevřít detail role ${role.name}`}><Settings size={17}/></button></td></tr>)}</tbody></table></div></section>}
    {editing&&<AdminUserModal value={editing==="new"?null:editing} snapshot={snapshot} close={()=>setEditing(null)} save={async value=>{if(editing==="new")await adminRepository.invite(value);else await adminRepository.update({...editing,...value,lastLoginAt:editing.lastLoginAt});setEditing(null);notify(editing==="new"?"Pozvánka byla vytvořena":"Uživatel byl uložen");reload();}}/>}
    {editingRole&&<RolePermissionsModal role={editingRole} permissions={snapshot.permissions} close={()=>setEditingRole(null)} save={async permissionCodes=>{await adminRepository.setRolePermissions(editingRole.id,permissionCodes);setEditingRole(null);notify("Oprávnění role byla uložena");reload();}}/>}
  </div>;
}

function AdminUserModal({value,snapshot,close,save}:{value:AdminUser|null;snapshot:AdminSnapshot;close:()=>void;save:(value:Omit<AdminUser,"membershipId"|"userId"|"lastLoginAt">)=>Promise<void>}){
  const [name,setName]=useState(value?.name??"");const [email,setEmail]=useState(value?.email??"");const [jobTitle,setJobTitle]=useState(value?.jobTitle??"");const [workPhone,setWorkPhone]=useState(value?.workPhone??"");const [status,setStatus]=useState<AdminUser["status"]>(value?.status??"invited");const [roleIds,setRoleIds]=useState(value?.roleIds??[]);const [projectIds,setProjectIds]=useState(value?.projectIds??[]);const [showTechnical,setShowTechnical]=useState(false);
  const effective=[...new Set(roleIds.flatMap(id=>snapshot.roles.find(role=>role.id===id)?.permissionCodes??[]))].map(code=>{const roles=snapshot.roles.filter(role=>roleIds.includes(role.id)&&role.permissionCodes.includes(code));const scopes=roles.map(role=>role.permissionGrants?.find(grant=>grant.code===code)?.scope??(projectIds.length?"project":"workspace"));const scope=scopes.includes("workspace")?"workspace":scopes[0]??(projectIds.length?"project":"workspace");return{definition:getPermissionDefinition(code),roles:roles.map(role=>role.name),scope};}).sort((a,b)=>sortPermissionDefinitions(a.definition,b.definition));
  const grouped=permissionCategoryOrder.map(category=>({category,items:effective.filter(item=>item.definition.category===category)})).filter(group=>group.items.length);
  return <FormModal title={value?`Upravit ${value.name}`:"Pozvat uživatele"} close={close} saveLabel={value?"Uložit uživatele":"Odeslat pozvánku"} onSave={async()=>{if(!name.trim()||!email.includes("@"))throw new Error("Doplňte jméno a platný pracovní e-mail");if(!roleIds.length)throw new Error("Vyberte alespoň jednu roli");await save({name,email,jobTitle,workPhone,status,roleIds,projectIds});}}><div className="form-row"><label><span>Jméno</span><input value={name} onChange={event=>setName(event.target.value)}/></label><label><span>Pracovní e-mail</span><input type="email" value={email} onChange={event=>setEmail(event.target.value)}/></label></div><div className="form-row"><label><span>Pracovní pozice</span><input value={jobTitle} onChange={event=>setJobTitle(event.target.value)}/></label><label><span>Pracovní telefon</span><input value={workPhone} onChange={event=>setWorkPhone(event.target.value)}/></label></div>{value&&<label><span>Stav přístupu</span><select value={status} onChange={event=>setStatus(event.target.value as AdminUser["status"])}><option value="active">Aktivní</option><option value="suspended">Deaktivovaný</option><option value="archived">Odebrat přístup</option><option value="invited">Pozván</option></select></label>}<fieldset className="admin-check-grid"><legend>Role</legend>{snapshot.roles.map(role=><label key={role.id}><input type="checkbox" checked={roleIds.includes(role.id)} onChange={()=>setRoleIds(current=>current.includes(role.id)?current.filter(id=>id!==role.id):[...current,role.id])}/><span>{role.name}</span></label>)}</fieldset><fieldset className="admin-check-grid"><legend>Projektový rozsah</legend><label><input type="checkbox" checked={!projectIds.length} onChange={()=>setProjectIds([])}/><span>Všechny projekty</span></label>{snapshot.projects.map(project=><label key={project.id}><input type="checkbox" checked={projectIds.includes(project.id)} onChange={()=>setProjectIds(current=>current.includes(project.id)?current.filter(id=>id!==project.id):[...current,project.id])}/><span>{project.name}</span></label>)}</fieldset><section className="effective-permissions grouped"><div className="effective-permissions-head"><strong>Efektivní oprávnění ({effective.length})</strong><label className="technical-name-toggle"><input type="checkbox" checked={showTechnical} onChange={event=>setShowTechnical(event.target.checked)}/><span>Zobrazit technické názvy</span></label></div>{grouped.length?grouped.map(group=><section key={group.category}><h3>{group.category}</h3>{group.items.map(item=><article key={item.definition.key}><strong>{item.definition.name}</strong><small>Získáno z role: {item.roles.join(", ")}</small><em>Rozsah: {permissionScopeLabel(item.scope)}</em>{showTechnical&&<code>Technický klíč: {item.definition.key}</code>}</article>)}</section>):<p>Žádná oprávnění</p>}</section><p className="form-help"><ShieldCheck size={14}/> Projektový rozsah i role jsou kontrolovány také na backendu.</p></FormModal>;
}

function RolePermissionsModal({role,permissions,close,save}:{role:AdminRole;permissions:Array<{code:string;description:string}>;close:()=>void;save:(codes:string[])=>Promise<void>}){
  const [selected,setSelected]=useState(role.permissionCodes);const [showTechnical,setShowTechnical]=useState(false);const available=permissions.map(permission=>getPermissionDefinition(permission.code)).sort(sortPermissionDefinitions);const groups=permissionCategoryOrder.map(category=>({category,items:available.filter(permission=>permission.category===category)})).filter(group=>group.items.length);
  return <FormModal title={`Detail role · ${role.name}`} close={close} onSave={()=>save(selected)}><div className="role-detail-summary"><span><small>UŽIVATELÉ S ROLÍ</small><strong>{role.assignedUserCount??0}</strong></span><span><small>TYP ROLE</small><strong>{role.isSystem?"Systémová":"Vlastní"}</strong></span></div><p>{role.description}</p>{role.restrictions?.map(item=><div className="form-warning" key={item}><ShieldCheck size={15}/>{item}</div>)}<label className="technical-name-toggle"><input type="checkbox" checked={showTechnical} onChange={event=>setShowTechnical(event.target.checked)}/><span>Zobrazit technické názvy</span></label><div className="permission-editor grouped">{groups.map(group=><section key={group.category}><h3>{group.category}</h3>{group.items.sort((a,b)=>permissionOperationOrder.indexOf(a.operation)-permissionOperationOrder.indexOf(b.operation)||a.name.localeCompare(b.name,"cs")).map(permission=>{const scope=role.permissionGrants?.find(grant=>grant.code===permission.key)?.scope??"workspace";return <label key={permission.key}><input type="checkbox" checked={selected.includes(permission.key)} onChange={()=>setSelected(current=>current.includes(permission.key)?current.filter(code=>code!==permission.key):[...current,permission.key])}/><span><strong>{permission.name}</strong><small>{permission.description}</small><em>Rozsah: {permissionScopeLabel(scope)}</em>{permission.systemRestriction&&<em className="permission-restriction">Omezení: {permission.systemRestriction}</em>}{showTechnical&&<code>Technický klíč: {permission.key}</code>}</span></label>})}</section>)}</div>{role.history?.length?<div className="role-history"><strong>Poslední změny oprávnění</strong>{role.history.map((item,index)=><small key={`${item.occurredAt}-${index}`}>{formatPragueDateTime(item.occurredAt)} · {item.actor}</small>)}</div>:null}<p className="form-help"><History size={14}/> Každá změna se zapisuje do auditu a outboxu. Systémová omezení nelze obejít.</p></FormModal>;
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

function UnitDetail({ unit, tab, onTab, onBack,openProjects,openProject, notify, openTask, openClient,openContract,onNewContract, onEdit, onEditPrice,priceProposals,onDecidePrice,onManageAccessories,onEditFloorplan,onSalesAction,canCreateHold,canConfirmHold,canCancelHold,onContractWorkflow,timelineVersion }: { unit: UnitRecord; tab: UnitTab; onTab: (tab: UnitTab) => void; onBack: () => void;openProjects:()=>void;openProject:()=>void; notify: (message: string) => void; openTask: () => void; openClient: (name: string) => void;openContract:(contract:(typeof contracts)[number])=>void;onNewContract?:()=>void; onEdit?: () => void; onEditPrice?: () => void;priceProposals:NonNullable<CommercialSnapshot["priceProposals"]>;onDecidePrice?:(proposalId:string,decision:"approved"|"rejected")=>Promise<void>;onManageAccessories?:()=>void;onEditFloorplan?:()=>void;onSalesAction?:(mode:"interest"|"pre_reservation"|"reservation"|"convert"|"cancel")=>void;canCreateHold?:boolean;canConfirmHold?:boolean;canCancelHold?:boolean;onContractWorkflow?:(contract:(typeof contracts)[number])=>void;timelineVersion:number }) {
  const [timeline,setTimeline]=useState<TimelineRecord[]>([]);useEffect(()=>{const controller=new AbortController();activityRepository.unitTimeline(unit.backendId??unit.id,unit.id,controller.signal).then(setTimeline).catch(()=>setTimeline([]));return()=>controller.abort();},[unit.backendId,unit.id,tab,timelineVersion]);
  const tabs: { id: UnitTab; label: string; icon: typeof Home; count?: number }[] = [
    { id: "overview", label: "Přehled", icon: LayoutDashboard }, { id: "contracts", label: "Smlouvy", icon: FileText, count: contracts.filter(contract=>contract.unit===unit.id).length||undefined }, { id: "payments", label: "Platby", icon: CircleDollarSign }, { id: "changes", label: "Klientské změny", icon: SlidersHorizontal }, { id: "documents", label: "Dokumenty", icon: FolderOpen }, { id: "handover", label: "Předání", icon: KeyRound }, { id: "tasks", label: "Úkoly", icon: ClipboardCheck }, { id: "history", label: "Historie", icon: History },
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

      {tab === "overview" && <UnitOverview unit={unit} notify={notify} openClient={openClient} onEditPrice={onEditPrice} priceProposals={priceProposals} onDecidePrice={onDecidePrice} onManageAccessories={onManageAccessories} onEditFloorplan={onEditFloorplan} onSalesAction={onSalesAction} canCreateHold={canCreateHold} canConfirmHold={canConfirmHold} canCancelHold={canCancelHold} timeline={timeline} />}
      {tab === "contracts" && <UnitContracts unit={unit} openContract={openContract} onNewContract={onNewContract} onWorkflow={onContractWorkflow} />}
      {tab === "payments" && <UnitPayments unit={unit} />}
      {tab === "changes" && <UnitClientChanges unit={unit} notify={notify} />}
      {tab === "documents" && <UnitDocuments unit={unit} notify={notify} />}
      {tab === "handover" && <UnitHandover unit={unit} notify={notify} />}
      {tab === "tasks" && <UnitTasks unit={unit} openTask={openTask} />}
      {tab === "history" && <UnitHistory unit={unit} timeline={timeline} />}
    </div>
  );
}

function UnitOverview({ unit, notify, openClient, onEditPrice,priceProposals,onDecidePrice,onManageAccessories,onEditFloorplan,onSalesAction,canCreateHold,canConfirmHold,canCancelHold,timeline }: { unit: UnitRecord; notify: (message: string) => void; openClient: (name: string) => void; onEditPrice?: () => void;priceProposals:NonNullable<CommercialSnapshot["priceProposals"]>;onDecidePrice?:(proposalId:string,decision:"approved"|"rejected")=>Promise<void>;onManageAccessories?:()=>void;onEditFloorplan?:()=>void;onSalesAction?:(mode:"interest"|"pre_reservation"|"reservation"|"convert"|"cancel")=>void;canCreateHold?:boolean;canConfirmHold?:boolean;canCancelHold?:boolean;timeline:TimelineRecord[] }) {
  const [floorplanOpen, setFloorplanOpen] = useState(false);
  const [contextOpen,setContextOpen]=useState(false);
  const [loadedFloorplanUrl,setLoadedFloorplanUrl]=useState<string|null>(null);const floorplanUrl=unit.floorplanImageUrl??loadedFloorplanUrl;useEffect(()=>{const unitId=backendEntityId(unit.backendId);if(floorplanUrl||!unitId)return;const controller=new AbortController();mediaRepository.get("unit",unitId,controller.signal).then(media=>{if(media)setLoadedFloorplanUrl(media.url);}).catch(()=>undefined);return()=>controller.abort();},[unit.backendId,floorplanUrl]);
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
          <div className="next-action"><span className="next-action-icon"><Sparkles size={19} /></span><div><small>DOPORUČENÝ DALŠÍ KROK</small><strong>{isDejvice?(unit.attention?"Ověřit vazbu importovanou ze zdroje":commercial?.stage==="rs"?"Ověřit aktuální stav rezervační smlouvy":"Bez nutné obchodní akce"):"Doplňte číslo účtu a vygenerujte novou verzi SBK"}</strong><p>{isDejvice?(unit.attention??"Zdroj neobsahuje další potvrzený krok."):"Kontrola našla 1 chybějící povinný údaj."}</p></div><button className="primary-button" onClick={() => setContextOpen(true)}>{isDejvice?"Zobrazit kontext":"Doplnit údaj"} <ArrowRight size={16} /></button></div>
          {onSalesAction&&<div className="sales-action-strip"><span><small>OBCHODNÍ AKCE</small><strong>Stav se mění pouze řízenou operací</strong></span><div>{!commercial?.hold&&<>{canCreateHold&&<button className="secondary-button compact" onClick={()=>onSalesAction("pre_reservation")}>Předrezervace</button>}{canConfirmHold&&<button className="secondary-button compact" onClick={()=>onSalesAction("reservation")}>Rezervace</button>}</>}{commercial?.hold?.type==="pre_reservation"&&canConfirmHold&&<button className="primary-button compact" onClick={()=>onSalesAction("convert")}>Převést na rezervaci</button>}{commercial?.hold&&canCancelHold&&<button className="secondary-button compact danger-text" onClick={()=>onSalesAction("cancel")}>Zrušit / uvolnit</button>}</div></div>}
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
          {priceProposals.map(proposal=><div className="price-proposal" key={proposal.id}><span><Badge tone="warning">Čeká na schválení</Badge><strong>{formatMoney(proposal.proposedAmount)}</strong><small>{proposal.reason} · navrhl/a {proposal.proposer} · účinnost {new Date(proposal.validFrom).toLocaleDateString("cs-CZ")}</small></span>{onDecidePrice&&<div><button className="secondary-button compact danger-text" onClick={()=>void onDecidePrice(proposal.id,"rejected")}>Zamítnout</button><button className="primary-button compact" onClick={()=>void onDecidePrice(proposal.id,"approved")}><Check size={15}/> Schválit</button></div>}</div>)}
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
    {contextOpen&&<div className="modal-layer"><button className="modal-scrim" onClick={()=>setContextOpen(false)} aria-label="Zavřít kontext jednotky"/><div className="modal"><div className="modal-head"><div><h2>Kontext jednotky {unit.id}</h2><p>Aktuální propojená data z katalogu, klientů a obchodního procesu.</p></div><button className="icon-button" onClick={()=>setContextOpen(false)}><X size={19}/></button></div><div className="context-links"><div><Home size={16}/><span><small>Jednotka</small><strong>{unit.layout} · {unit.area.toLocaleString("cs-CZ")} m²</strong></span></div><div><UserRound size={16}/><span><small>Klient</small><strong>{buyers.map(item=>item.name).join(" a ")||"Bez přiřazeného klienta"}</strong></span></div><div><FileText size={16}/><span><small>Obchodní etapa</small><strong>{commercial?.stage??"Bez aktivního obchodního procesu"}</strong></span></div></div><dl className="context-detail-list"><div><dt>Obchodní stav</dt><dd>{unit.status}</dd></div><div><dt>Aktivní rezervace</dt><dd>{commercial?.hold?`${commercial.hold.type==="reservation"?"Rezervace":"Předrezervace"} do ${formatPragueDate(commercial.hold.expiresAt)}`:"Není"}</dd></div><div><dt>Aktuální cena</dt><dd>{formatMoney(unit.price)}</dd></div><div><dt>Upozornění</dt><dd>{unit.attention||"Bez otevřených bodů"}</dd></div></dl><div className="modal-foot"><button className="primary-button" onClick={()=>setContextOpen(false)}>Rozumím</button></div></div></div>}
    </>
  );
}

function UnitContracts({ unit,openContract,onNewContract,onWorkflow }: { unit:UnitRecord;openContract:(contract:(typeof contracts)[number])=>void;onNewContract?:()=>void;onWorkflow?: (contract:(typeof contracts)[number])=>void }) {
  const rows=contracts.filter(contract=>contract.unit===unit.id);
  return <section className="card detail-tab-card"><div className="tab-card-header"><div><h2>Smlouvy jednotky {unit.id}</h2><p>Workflow a logické verze smluv používají jeden zdroj dat.</p></div>{onNewContract&&<button className="primary-button" onClick={onNewContract}><Plus size={17} /> Nová smlouva</button>}</div><div className="document-list">{rows.map(row=>{const latest=row.versions?.[0];return <article key={row.id??`${row.unit}-${row.type}`}><span className="document-icon"><FileText size={21} /></span><button className="document-link-copy" onClick={()=>openContract(row)}><strong>{row.title??row.type}</strong><small>{row.reference?`${row.reference} · `:""}{latest?`verze v${String(latest.number).padStart(2,"0")} · ${latest.name}`:"Bez verze"}</small></button><Badge>{row.state}</Badge>{onWorkflow&&row.id?<button className="secondary-button compact" onClick={()=>onWorkflow(row)}>{row.action} <ChevronRight size={15}/></button>:<span/>}</article>})}{!rows.length&&<div className="empty-filter-state"><FileText size={22}/><strong>Jednotka zatím nemá smlouvu</strong><small>Nová smlouva bude navázána na existující obchodní proces.</small></div>}</div><div className="sharepoint-banner"><FolderOpen size={21}/><span><strong>Repository je připravené pro budoucí dokumenty</strong><small>DOCX ani SharePoint synchronizace v této etapě nejsou aktivní.</small></span></div></section>;
}

function UnitPayments({unit}:{unit:UnitRecord}) {
  return <PaymentContextTable title={`Splátkový kalendář jednotky ${unit.id}`} description="Předpisy, částečné úhrady a historie používají stejný zdroj jako globální Platby." filters={{unit:unit.id}}/>;
}

function PaymentContextTable({title,description,filters,openUnit,project}:{title:string;description:string;filters:{project?:string;unit?:string;partyId?:string;contractId?:string;salesCaseId?:string};openUnit?:(unit:UnitRecord)=>void;project?:ProjectRecord}){
  const [rows,setRows]=useState<PaymentRecord[]>([]);const [loading,setLoading]=useState(true);const [error,setError]=useState("");const [selected,setSelected]=useState<PaymentRecord|null>(null);
  useEffect(()=>{const controller=new AbortController();paymentRepository.list(filters,controller.signal).then(result=>setRows(result.payments)).catch(err=>{if((err as Error).name!=="AbortError")setError(err instanceof Error?err.message:"Platby nelze načíst");}).finally(()=>setLoading(false));return()=>controller.abort();},[filters.project,filters.unit,filters.partyId,filters.contractId,filters.salesCaseId]);
  const total=rows.reduce((sum,row)=>sum+row.amount,0);const paid=rows.reduce((sum,row)=>sum+row.paid,0);
  const content=<><div className="metric-row payments-metrics"><div className="metric-card"><span className="metric-icon green"><Banknote size={20}/></span><span><small>Uhrazeno</small><strong>{formatMoney(paid)}</strong><em>nereverzované úhrady</em></span></div><div className="metric-card"><span className="metric-icon blue"><CircleDollarSign size={20}/></span><span><small>Předepsáno</small><strong>{formatMoney(total)}</strong><em>{rows.length} předpisů</em></span></div><div className="metric-card danger-metric"><span className="metric-icon red"><AlertTriangle size={20}/></span><span><small>Po splatnosti</small><strong>{rows.filter(row=>row.status==="overdue").length}</strong><em>vyžaduje pozornost</em></span></div></div><section className="card detail-tab-card"><div className="tab-card-header"><div><h2>{title}</h2><p>{description}</p></div></div><div className="unit-table-wrap"><table className="data-table"><thead><tr><th>Jednotka</th><th>Klient</th><th>Splátka</th><th>Splatnost</th><th>Předpis</th><th>Uhrazeno</th><th>Stav</th><th/></tr></thead><tbody>{rows.map(row=><tr key={row.id} onClick={()=>setSelected(row)}><td><strong>{row.unit}</strong></td><td>{row.client}</td><td>{row.label}</td><td>{formatPragueDate(row.dueAt)}</td><td><strong>{formatMoney(row.amount)}</strong></td><td>{formatMoney(row.paid)}</td><td><Badge tone={row.status==="overdue"?"danger":row.status==="paid"?"success":"neutral"}>{paymentStatusLabel[row.status]}</Badge></td><td><ChevronRight size={17}/></td></tr>)}</tbody></table></div>{loading&&<div className="empty-filter-state"><Clock3 size={20}/><strong>Načítám platby…</strong></div>}{error&&<div className="empty-filter-state"><AlertTriangle size={20}/><strong>Platby nelze načíst</strong><small>{error}</small></div>}{!loading&&!error&&!rows.length&&<div className="empty-filter-state"><Banknote size={20}/><strong>Bez platebních předpisů</strong><small>V tomto kontextu zatím není žádná platební povinnost.</small></div>}</section>{selected&&<PaymentDetailModal payment={selected} close={()=>setSelected(null)} openUnit={()=>{const unit=units.find(item=>item.id===selected.unit);if(unit&&openUnit)openUnit(unit);}} canRecord={false} canReverse={false} saved={()=>setSelected(null)}/>}</>;
  return project?<div className="project-module-stack"><div className="project-scope-banner card"><Building2 size={17}/><span><strong>{project.name}</strong><small>Platby jsou omezené na tento projekt.</small></span></div>{content}</div>:<div className="detail-tab-stack">{content}</div>;
}

const clientChangeStatusLabels:Record<string,string>={requested:"Požadováno",pricing:"K nacenění",pending_approval:"Ke schválení",approved:"Schváleno",in_progress:"V realizaci",completed:"Dokončeno",cancelled:"Zrušeno"};
const clientChangeStatusTones:Record<string,string>={requested:"neutral",pricing:"warning",pending_approval:"warning",approved:"success",in_progress:"blue",completed:"success",cancelled:"danger"};

function ClientChangesWorkspace({project,unit,openUnit,notify}:{project:ProjectRecord;unit?:UnitRecord;openUnit:(unit:UnitRecord)=>void;notify:(message:string)=>void}){
  const [rows,setRows]=useState<ClientChangeRecord[]>([]);const [loading,setLoading]=useState(true);const [error,setError]=useState("");const [creating,setCreating]=useState(false);const [archiveTarget,setArchiveTarget]=useState<ClientChangeRecord|null>(null);const [reload,setReload]=useState(0);
  const projectId=backendEntityId(project.backendId);const unitId=unit?backendEntityId(unit.backendId):null;const projectUnits=units.filter(item=>unitBelongsToProject(item,project));
  useEffect(()=>{const controller=new AbortController();if(!projectId||(unit&&!unitId)){Promise.resolve().then(()=>{setRows([]);setLoading(false);setError("Klientské změny vyžadují skutečné ID projektu a jednotky.");});return()=>controller.abort();}clientChangeRepository.list({projectId,unitId:unitId??undefined},controller.signal).then(value=>{setRows(value);setError("");}).catch(problem=>{if((problem as Error).name!=="AbortError")setError(problem instanceof Error?problem.message:"Klientské změny nelze načíst");}).finally(()=>setLoading(false));return()=>controller.abort();},[projectId,unitId,reload,unit]);
  const total=rows.reduce((sum,row)=>sum+(row.surchargeAmount??0),0);
  const table=<><div className="unit-table-wrap"><table className="data-table unit-changes-table"><thead><tr><th>Změna</th>{!unit&&<th>Jednotka</th>}<th>Klient</th><th>Kategorie</th><th>Stav</th><th>Cena / doplatek</th><th>Termín</th><th>Datum požadavku</th><th/></tr></thead><tbody>{rows.map(row=><tr key={row.id}><td><strong>{row.title}</strong><small className="change-source">{row.sourceType==="catalog"?`Ceník · ${row.catalogItemCode}`:"Individuální změna"}</small></td>{!unit&&<td><button className="unit-link" onClick={()=>{const target=projectUnits.find(item=>item.backendId===row.unitId);if(target)openUnit(target);}}>{row.unitCode}</button></td>}<td>{row.partyName}</td><td>{row.category}</td><td><Badge tone={clientChangeStatusTones[row.status]??"neutral"}>{clientChangeStatusLabels[row.status]??row.status}</Badge></td><td><strong>{row.surchargeAmount===null?"K nacenění":formatMoney(row.surchargeAmount)}</strong></td><td>{row.dueAt?formatPragueDate(row.dueAt):"—"}</td><td>{formatPragueDate(row.requestedAt)}</td><td><button className="ghost-icon" aria-label={`Archivovat ${row.title}`} onClick={()=>setArchiveTarget(row)}><X size={16}/></button></td></tr>)}</tbody></table></div>{loading&&<div className="empty-filter-state"><Clock3 size={20}/><strong>Načítám klientské změny…</strong></div>}{error&&<div className="empty-filter-state"><AlertTriangle size={20}/><strong>Klientské změny nelze načíst</strong><small>{error}</small></div>}{!loading&&!error&&!rows.length&&<div className="empty-filter-state"><SlidersHorizontal size={22}/><strong>Zatím bez klientských změn</strong><small>Nový požadavek bude bezpečně provázán s jednotkou a klientem.</small></div>}</>;
  const content=unit?<div className="detail-tab-stack"><section className="card unit-change-context"><div className="change-context-copy"><span className="change-context-icon"><Link2 size={19}/></span><span><strong>Provázané údaje bez duplikace</strong><small>Jednotka, klient a aktivní obchodní případ zůstávají canonical zdrojem dat.</small></span></div><div className="change-context-grid"><span><small>JEDNOTKA</small><strong>{unit.id}</strong><em>{unit.project}</em></span><span><small>KLIENT</small><strong>{unit.client||"Bez přiřazeného klienta"}</strong><em>z karty klienta</em></span><span><small>DOPLATKY CELKEM</small><strong>{formatMoney(total)}</strong><em>{rows.length} změn</em></span><span><small>DOKUMENTY</small><strong>Vazby bez kopií</strong><em>v dokumentech jednotky</em></span></div></section><section className="card detail-tab-card"><div className="tab-card-header"><div><h2>Klientské změny jednotky {unit.id}</h2><p>Individuální požadavky i položky z budoucího ceníku.</p></div><button className="primary-button" onClick={()=>setCreating(true)}><Plus size={17}/> Nová změna</button></div>{table}</section></div>:<ProjectModuleFrame project={project} title="Klientské změny" description="Požadavky klientů na standardy a provedení jednotek." action="Nový požadavek" onAction={()=>setCreating(true)}>{table}</ProjectModuleFrame>;
  return <>{content}{creating&&<NewClientChangeModal project={project} fixedUnit={unit} close={()=>setCreating(false)} save={async input=>{await clientChangeRepository.create(input);setCreating(false);setReload(value=>value+1);notify("Klientská změna byla vytvořena");}}/>}{archiveTarget&&<FormModal title="Archivovat klientskou změnu" close={()=>setArchiveTarget(null)} saveLabel="Archivovat" onSave={async()=>{await clientChangeRepository.archive(archiveTarget.id,"Archivováno uživatelem z přehledu");setArchiveTarget(null);setReload(value=>value+1);notify("Klientská změna byla archivována");}}><p className="form-help"><AlertTriangle size={16}/> Opravdu chcete archivovat změnu „{archiveTarget.title}“? Záznam zůstane zachovaný v auditní historii.</p></FormModal>}</>;
}

function NewClientChangeModal({project,fixedUnit,close,save}:{project:ProjectRecord;fixedUnit?:UnitRecord;close:()=>void;save:(input:NewClientChangeInput)=>Promise<void>}){
  const projectUnits=units.filter(item=>unitBelongsToProject(item,project));const [unitKey,setUnitKey]=useState(fixedUnit?.id??projectUnits.find(item=>unitCommercialContexts[item.id]?.buyers.length)?.id??projectUnits[0]?.id??"");const selectedUnit=projectUnits.find(item=>item.id===unitKey);const buyerIds=new Set((unitCommercialContexts[unitKey]?.buyers??[]).map(item=>item.partyId));const candidates=clients.filter(client=>buyerIds.has(client.id)||client.units.includes(unitKey));
  const [partyId,setPartyId]=useState("");const [title,setTitle]=useState("");const [description,setDescription]=useState("");const [sourceType,setSourceType]=useState<"individual"|"catalog">("individual");const [catalogItemCode,setCatalogItemCode]=useState("");const [category,setCategory]=useState("");const [surcharge,setSurcharge]=useState("");const [requestedAt,setRequestedAt]=useState(localDateKey(new Date()));const [dueAt,setDueAt]=useState("");const effectivePartyId=candidates.some(item=>item.id===partyId)?partyId:candidates[0]?.id??"";
  return <FormModal title="Nová klientská změna" close={close} saveLabel="Vytvořit změnu" onSave={async()=>{const projectId=backendEntityId(project.backendId);const unitId=backendEntityId(selectedUnit?.backendId);if(!projectId||!unitId)throw new Error("Projekt nebo jednotka nemá skutečný databázový identifikátor");if(!effectivePartyId)throw new Error("Vybraná jednotka nemá přiřazeného klienta");if(title.trim().length<2||category.trim().length<2)throw new Error("Doplňte název a kategorii změny");if(sourceType==="catalog"&&!catalogItemCode.trim())throw new Error("Doplňte kód položky ceníku");await save({projectId,unitId,partyId:effectivePartyId,title:title.trim(),description:description.trim(),sourceType,catalogItemCode:catalogItemCode.trim()||undefined,category:category.trim(),surchargeAmount:surcharge?numberValue(surcharge):null,currency:"CZK",requestedAt,dueAt:dueAt||null});}}><label><span>Jednotka</span><select value={unitKey} disabled={Boolean(fixedUnit)} onChange={event=>{setUnitKey(event.target.value);setPartyId("");}}>{projectUnits.map(item=><option key={item.id} value={item.id}>{item.id} · {item.layout} · {item.status}</option>)}</select></label><label><span>Klient</span><select value={effectivePartyId} onChange={event=>setPartyId(event.target.value)}><option value="">Vyberte klienta</option>{candidates.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>{!candidates.length&&<small>Nejdříve přiřaďte klienta k obchodnímu případu jednotky.</small>}</label><label><span>Název / popis změny</span><input autoFocus value={title} onChange={event=>setTitle(event.target.value)} placeholder="Např. změna podlahy"/></label><div className="form-row"><label><span>Kategorie</span><input value={category} onChange={event=>setCategory(event.target.value)} placeholder="Povrchy, elektro…"/></label><label><span>Zdroj</span><select value={sourceType} onChange={event=>setSourceType(event.target.value as "individual"|"catalog")}><option value="individual">Individuální změna</option><option value="catalog">Položka z ceníku</option></select></label></div>{sourceType==="catalog"&&<label><span>Kód položky ceníku</span><input value={catalogItemCode} onChange={event=>setCatalogItemCode(event.target.value)}/></label>}<div className="form-row"><label><span>Cena / doplatek</span><input inputMode="decimal" value={surcharge} onChange={event=>setSurcharge(event.target.value)} placeholder="K nacenění"/></label><label><span>Datum požadavku</span><input type="date" value={requestedAt} onChange={event=>setRequestedAt(event.target.value)}/></label></div><label><span>Termín</span><input type="date" value={dueAt} onChange={event=>setDueAt(event.target.value)}/></label><label><span>Poznámka</span><textarea rows={3} value={description} onChange={event=>setDescription(event.target.value)}/></label></FormModal>;
}

function UnitClientChanges({unit,notify}:{unit:UnitRecord;notify:(message:string)=>void}){const project=projects.find(item=>unitBelongsToProject(unit,item));if(!project)return <PilotEmptyState title="Klientské změny" detail="Projekt jednotky se nepodařilo určit."/>;return <ClientChangesWorkspace project={project} unit={unit} openUnit={()=>undefined} notify={notify}/>;}

function LegacyUnitClientChanges({ unit, notify }: { unit: UnitRecord; notify: (message: string) => void }) {
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
function DocumentConnectionBanner({connection}:{connection:DocumentConnectionState}){if(connection.status==="connected")return <div className="sharepoint-banner"><CheckCircle2 size={19}/><span><strong>SharePoint je připojen</strong><small>{connection.lastSuccessfulSyncAt?`Poslední úspěšná synchronizace ${new Date(connection.lastSuccessfulSyncAt).toLocaleString("cs-CZ")}`:"Připojení je připravené k synchronizaci."}</small></span></div>;return <div className="unassigned-doc document-connection-note"><AlertTriangle size={19}/><span><strong>SharePoint zatím není připojen</strong><small>Preview bezpečně zobrazuje pouze CRM metadata a existující preview média. Žádný soubor se nevydává za nahraný na SharePoint.</small></span></div>;}
function DocumentList({documents,loading,notify:_notify,openDocument}:{documents:DocumentRecord[];loading:boolean;notify:(message:string)=>void;openDocument?:(document:DocumentRecord)=>void}){if(loading)return <div className="empty-filter-state"><Clock3 size={21}/><strong>Načítám dokumenty</strong></div>;if(!documents.length)return <div className="empty-filter-state"><FolderOpen size={22}/><strong>Žádné dokumenty v tomto rozsahu</strong><small>Zdroj zatím neobsahuje odpovídající dokumentová metadata.</small></div>;return <div className="document-list document-metadata-list">{documents.map(document=>{const related=[...document.units,...document.parties,...document.contracts];return <article key={document.id} className="clickable-document" onClick={()=>openDocument?.(document)}><span className="document-icon"><FileText size={21}/></span><span><strong>{document.name}</strong><small>{document.typeName} · {related.length?related.join(" · "):document.projectName}</small></span><span className="document-meta"><small>Poslední změna</small><strong>{document.updatedAt?new Date(document.updatedAt).toLocaleDateString("cs-CZ"):"—"}</strong></span><span className="document-meta"><small>Autor</small><strong>{document.author??"—"}</strong></span><Badge tone={documentStatusTone(document.status)}>{documentStatusLabel(document.status)}</Badge>{openDocument?<button className="ghost-icon" onClick={event=>{event.stopPropagation();openDocument(document);}} aria-label={`Detail ${document.name}`}><ChevronRight size={18}/></button>:document.webUrl?<Link className="ghost-icon" href={document.webUrl} target="_blank" rel="noreferrer" aria-label={`Otevřít ${document.name}`}><ExternalLink size={18}/></Link>:<Link className="ghost-icon" href={documentRoute(document.id)} aria-label={`Detail ${document.name}`}><ChevronRight size={18}/></Link>}</article>;})}</div>;}

const documentStatusOptions:{code:DocumentStatus;label:string}[]=[{code:"draft",label:"Koncept"},{code:"ready",label:"Připraveno"},{code:"sent",label:"Odesláno"},{code:"negotiation",label:"Ve vyjednávání"},{code:"signed",label:"Podepsáno"},{code:"archived",label:"Archiv"}];
function documentStatusLabel(value:string){return documentStatusOptions.find(option=>option.code===value)?.label??value;}
function documentStatusTone(value:string){return value==="signed"?"success":value==="negotiation"?"purple":value==="sent"?"warning":value==="ready"?"blue":"neutral";}
function documentDate(value:string|null|undefined){return value?formatPragueDate(value):"—";}

function DocumentsPage({selectedDocumentId,openDocument,closeDocument,openUnit,openClient,openContract,notify,reloadKey,onEdit,onNewVersion}:{selectedDocumentId:string|null;openDocument:(document:DocumentRecord)=>void;closeDocument:()=>void;openUnit:(unit:UnitRecord)=>void;openClient:(identity:string)=>void;openContract:(contract:(typeof contracts)[number])=>void;notify:(message:string)=>void;reloadKey:number;onEdit?:(document:DocumentRecord)=>void;onNewVersion?:(document:DocumentRecord)=>void}){
  const router=useRouter();const pathname=usePathname();const params=useSearchParams();const [documents,setDocuments]=useState<DocumentRecord[]>([]);const [loading,setLoading]=useState(true);const query=params.get("q")??"";const contextQuery=params.get("dcontext")??"";const typeFilters=listParam(params,"dtype");const statusFilters=listParam(params,"dstatus");const projectFilters=listParam(params,"dproject");const sort=params.get("dsort")??"updated";const direction=(params.get("ddir")==="asc"?"asc":"desc") as SortDirection;
  useEffect(()=>{if(selectedDocumentId)return;const controller=new AbortController();documentRepository.listAll({},controller.signal).then(result=>setDocuments(result.documents)).catch(()=>setDocuments([])).finally(()=>setLoading(false));return()=>controller.abort();},[reloadKey,selectedDocumentId]);
  if(selectedDocumentId)return <DocumentDetail documentId={selectedDocumentId} close={closeDocument} openUnit={openUnit} openClient={openClient} openContract={openContract} reloadKey={reloadKey} onEdit={onEdit} onNewVersion={onNewVersion}/>;
  const change=(patch:Record<string,string|string[]>)=>router.replace(updateSearch(pathname,params.toString(),patch),{scroll:false});
  const filteredDocuments=documents.filter(document=>(!query||document.name.toLocaleLowerCase("cs-CZ").includes(query.toLocaleLowerCase("cs-CZ")))&&(!contextQuery||[document.projectName,...document.units,...document.parties].join(" ").toLocaleLowerCase("cs-CZ").includes(contextQuery.toLocaleLowerCase("cs-CZ")))&&(!typeFilters.length||typeFilters.includes(document.typeName))&&(!statusFilters.length||statusFilters.includes(documentStatusLabel(document.status)))&&(!projectFilters.length||projectFilters.includes(document.projectName)));
  const sortedDocuments=stableSort(filteredDocuments,document=>sort==="created"?document.createdAt:sort==="type"?document.typeName:sort==="status"?documentStatusOptions.findIndex(item=>item.code===document.status):sort==="name"?document.name:sort==="project"?document.projectName:sort==="context"?[...document.parties,...document.units].join(" "):document.updatedAt,direction,document=>document.id);
  const signed=documents.filter(document=>document.status==="signed").length;const action=documents.filter(document=>["draft","negotiation"].includes(document.status)).length;
  return <div className="module-stack document-workspace">
    <div className="document-summary-strip"><span><FolderOpen size={18}/><small>Všechny dokumenty</small><strong>{documents.length}</strong></span><span><AlertTriangle size={18}/><small>Vyžadují pozornost</small><strong>{action}</strong></span><span><CheckCircle2 size={18}/><small>Podepsané</small><strong>{signed}</strong></span><span><History size={18}/><small>Poslední změna</small><strong>{documents[0]?documentDate(documents[0].updatedAt):"—"}</strong></span></div>
    <section className="card module-card">
      <div className="document-quick-filter"><button className={!statusFilters.length?"active":""} onClick={()=>change({dstatus:""})}>Všechny</button>{documentStatusOptions.filter(item=>item.code!=="archived").map(item=><button key={item.code} className={statusFilters.length===1&&statusFilters[0]===item.label?"active":""} onClick={()=>change({dstatus:item.label})}>{item.label}<span>{documents.filter(document=>document.status===item.code).length}</span></button>)}</div>
      <div className="document-result-bar"><span><strong>{filteredDocuments.length}</strong> dokumentů</span>{(query||contextQuery||typeFilters.length||statusFilters.length||projectFilters.length)>0&&<button className="text-button" onClick={()=>change({q:"",dcontext:"",dtype:"",dstatus:"",dproject:""})}>Zrušit filtry</button>}</div>
      <div className="document-table-head">
        <ListColumnFilter label="Dokument" active={Boolean(query)} sortDirection={sort==="name"?direction:undefined} onSort={next=>change({dsort:"name",ddir:next})}><input value={query} onChange={event=>change({q:event.target.value})} placeholder="Název dokumentu…" aria-label="Filtrovat název dokumentu"/></ListColumnFilter>
        <ListColumnFilter label="Typ" active={typeFilters.length>0} sortDirection={sort==="type"?direction:undefined} onSort={next=>change({dsort:"type",ddir:next})}><MultiSelectFilter options={documentTypeOptions.map(option=>option.name)} selected={typeFilters} onChange={values=>change({dtype:values})} allLabel="Všechny typy" ariaLabel="Filtrovat typ dokumentu"/></ListColumnFilter>
        <ListColumnFilter label="Projekt" active={projectFilters.length>0} sortDirection={sort==="project"?direction:undefined} onSort={next=>change({dsort:"project",ddir:next})}><MultiSelectFilter options={projects.map(item=>item.name)} selected={projectFilters} onChange={values=>change({dproject:values})} allLabel="Všechny projekty" ariaLabel="Filtrovat projekt dokumentu"/></ListColumnFilter>
        <ListColumnFilter label="Klient / jednotka" active={Boolean(contextQuery)} sortDirection={sort==="context"?direction:undefined} onSort={next=>change({dsort:"context",ddir:next})}><input value={contextQuery} onChange={event=>change({dcontext:event.target.value})} placeholder="Klient nebo jednotka…" aria-label="Filtrovat klienta nebo jednotku"/></ListColumnFilter>
        <ListColumnFilter label="Aktuální stav" active={statusFilters.length>0} sortDirection={sort==="status"?direction:undefined} onSort={next=>change({dsort:"status",ddir:next})}><MultiSelectFilter options={documentStatusOptions.map(option=>option.label)} selected={statusFilters} onChange={values=>change({dstatus:values})} allLabel="Všechny stavy" ariaLabel="Filtrovat stav dokumentu"/></ListColumnFilter>
        <ListColumnFilter label="Verze"/>
        <ListColumnFilter label="Poslední změna" sortType="date" sortDirection={sort==="updated"?direction:undefined} onSort={next=>change({dsort:"updated",ddir:next})}/>
        <span/>
      </div>
      <div className="document-central-list">{loading?<div className="empty-filter-state"><Clock3 size={21}/><strong>Načítám dokumenty</strong></div>:sortedDocuments.map(document=><button key={document.id} onClick={()=>openDocument(document)}><span className="document-name-cell"><i><FileText size={19}/></i><span><strong>{document.name}</strong><small>{document.author??"Bez autora"}</small></span></span><span>{document.typeName}</span><span><strong>{document.projectName}</strong></span><span className="document-relations"><strong>{document.parties.slice(0,2).join(" · ")||"—"}</strong><small>{document.units.slice(0,3).join(" · ")||"Bez jednotky"}</small></span><span><Badge tone={documentStatusTone(document.status)}>{documentStatusLabel(document.status)}</Badge></span><strong className="document-version-cell">{document.version??"—"}</strong><span>{documentDate(document.updatedAt)}</span><ChevronRight size={17}/></button>)}</div>
      {!loading&&!filteredDocuments.length&&<div className="empty-filter-state"><Search size={22}/><strong>Žádný dokument neodpovídá filtrům</strong><small>Změňte filtry v hlavičkách sloupců.</small></div>}
    </section>
  </div>;
}

function DocumentDetail({documentId,close,openUnit,openClient,openContract,reloadKey,onEdit,onNewVersion}:{documentId:string;close:()=>void;openUnit:(unit:UnitRecord)=>void;openClient:(identity:string)=>void;openContract:(contract:(typeof contracts)[number])=>void;reloadKey:number;onEdit?:(document:DocumentRecord)=>void;onNewVersion?:(document:DocumentRecord)=>void}){
  const [document,setDocument]=useState<DocumentRecord|null>(null);const [loading,setLoading]=useState(true);const [tab,setTab]=useState<"overview"|"history"|"versions"|"links"|"notes">("overview");
  useEffect(()=>{const controller=new AbortController();documentRepository.get(documentId,controller.signal).then(setDocument).finally(()=>setLoading(false));return()=>controller.abort();},[documentId,reloadKey]);
  if(loading)return <section className="card detail-tab-card"><div className="empty-filter-state"><Clock3 size={22}/><strong>Načítám detail dokumentu</strong></div></section>;
  if(!document)return <section className="card detail-tab-card"><div className="empty-filter-state"><AlertTriangle size={22}/><strong>Dokument nebyl nalezen</strong><button className="secondary-button" onClick={close}>Zpět na dokumenty</button></div></section>;
  const links=[...document.units.map(value=>({kind:"Jednotka",value,icon:Home})),...document.parties.map(value=>({kind:"Klient",value,icon:UserRound})),...document.contracts.map(value=>({kind:"Smlouva",value,icon:FileCheck2})),...document.salesCases.map(value=>({kind:"Obchodní vazba",value,icon:Link2}))];
  const activate=(kind:string,value:string)=>{if(kind==="Jednotka"){const unit=units.find(item=>item.id===value);if(unit)openUnit(unit);}else if(kind==="Klient")openClient(value);else if(kind==="Smlouva"){const contract=contracts.find(item=>item.id===value||item.reference===value||value.includes(item.unit)&&value.includes(item.type));if(contract)openContract(contract);}};
  return <div className="document-detail"><div className="unit-breadcrumb"><button onClick={close}><ArrowLeft size={16}/> Dokumenty</button><ChevronRight size={14}/><strong>{document.name}</strong></div><section className="card document-detail-hero"><span className="document-hero-icon"><FileText size={25}/></span><div><span className="eyebrow">{document.typeName}</span><h1>{document.name}</h1><p>{document.projectName} · {document.version??"bez verze"} · upraveno {documentDate(document.updatedAt)}</p></div><Badge tone={documentStatusTone(document.status)}>{documentStatusLabel(document.status)}</Badge><div className="project-detail-actions">{onNewVersion&&<button className="primary-button" onClick={()=>onNewVersion(document)}><Upload size={16}/> Nová verze</button>}{onEdit&&<button className="secondary-button" onClick={()=>onEdit(document)}><SlidersHorizontal size={16}/> Upravit metadata</button>}</div></section>
    <nav className="unit-tabs unit-detail-tabs document-detail-tabs">{([["overview","Přehled",LayoutDashboard],["history","Historie",History],["versions","Verze",FileText],["links","Vazby",Link2],["notes","Poznámky",MessageSquare]] as const).map(([id,label,Icon])=><button key={id} className={tab===id?"active":""} onClick={()=>setTab(id)}><Icon size={17}/>{label}{id==="versions"&&<span>{document.versions?.length??0}</span>}{id==="links"&&<span>{links.length}</span>}</button>)}</nav>
    {tab==="overview"&&<div className="document-detail-grid"><section className="card document-metadata-card"><SectionTitle title="Metadata dokumentu"/><dl><div><dt>Název</dt><dd>{document.name}</dd></div><div><dt>Typ</dt><dd>{document.typeName}</dd></div><div><dt>Stav</dt><dd><Badge tone={documentStatusTone(document.status)}>{documentStatusLabel(document.status)}</Badge></dd></div><div><dt>Aktuální verze</dt><dd>{document.version??"—"}</dd></div><div><dt>Vytvořeno</dt><dd>{documentDate(document.createdAt)}</dd></div><div><dt>Autor poslední změny</dt><dd>{document.author??"—"}</dd></div></dl>{document.note&&<div className="document-note"><MessageSquare size={16}/><span><small>POZNÁMKA</small><p>{document.note}</p></span></div>}</section><aside className="card document-links-card"><SectionTitle title="Související záznamy"/>{links.slice(0,6).map(({kind,value,icon:Icon})=><button key={`${kind}-${value}`} onClick={()=>activate(kind,value)}><Icon size={17}/><span><small>{kind}</small><strong>{value}</strong></span><ChevronRight size={16}/></button>)}</aside></div>}
    {tab==="history"&&<section className="card detail-tab-card"><div className="tab-card-header"><div><h2>Historie dokumentu</h2><p>Auditovatelná časová osa verzí, stavů a metadat.</p></div></div><div className="document-timeline">{(document.events??[]).map(event=><article key={event.id}><span><History size={15}/></span><div><strong>{event.title}</strong>{event.note&&<p>{event.note}</p>}<small>{documentDate(event.occurredAt)} · {event.actor}{event.versionLabel?` · ${event.versionLabel}`:""}</small></div>{event.newStatus&&<Badge tone={documentStatusTone(event.newStatus)}>{documentStatusLabel(event.newStatus)}</Badge>}</article>)}</div></section>}
    {tab==="versions"&&<section className="card detail-tab-card"><div className="tab-card-header"><div><h2>Fyzické verze</h2><p>Každá verze je samostatný neměnný záznam s vlastním stavem a autorem.</p></div>{onNewVersion&&<button className="primary-button" onClick={()=>onNewVersion(document)}><Plus size={15}/> Nová verze</button>}</div><div className="document-version-list">{(document.versions??[]).map(version=><article key={version.id}><span className="version-badge">{version.label}</span><span><strong>{document.name}</strong><small>{version.note??"Bez poznámky"} · {documentDate(version.createdAt)} · {version.author??"—"}</small></span><Badge tone={documentStatusTone(version.status)}>{documentStatusLabel(version.status)}</Badge></article>)}</div></section>}
    {tab==="links"&&<section className="card detail-tab-card"><div className="tab-card-header"><div><h2>Vazby dokumentu</h2><p>Jeden dokument může být současně propojený s více záznamy bez duplikace.</p></div></div><div className="document-link-grid">{links.map(({kind,value,icon:Icon})=><button key={`${kind}-${value}`} onClick={()=>activate(kind,value)}><Icon size={19}/><span><small>{kind}</small><strong>{value}</strong></span><ChevronRight size={17}/></button>)}</div></section>}
    {tab==="notes"&&<section className="card detail-tab-card"><div className="tab-card-header"><div><h2>Poznámky</h2><p>Interní kontext oddělený od fyzického souboru.</p></div>{onEdit&&<button className="secondary-button" onClick={()=>onEdit(document)}>Upravit poznámku</button>}</div>{document.note?<div className="document-note large"><MessageSquare size={18}/><p>{document.note}</p></div>:<div className="empty-filter-state"><MessageSquare size={21}/><strong>Dokument nemá poznámku</strong></div>}</section>}
  </div>;
}

function ClientDocuments({client}:{client:(typeof clients)[number]}){const router=useRouter();const [documents,setDocuments]=useState<DocumentRecord[]>([]);const [loading,setLoading]=useState(true);useEffect(()=>{const controller=new AbortController();documentRepository.listParty(client.id,controller.signal).then(result=>setDocuments(result.documents)).finally(()=>setLoading(false));return()=>controller.abort();},[client.id]);return <section className="card detail-tab-card"><div className="tab-card-header"><div><h2>Dokumenty klienta</h2><p>Dokumenty navázané na canonical záznam {client.name}.</p></div></div><DocumentList documents={documents} loading={loading} notify={()=>{}} openDocument={document=>router.push(documentRoute(document.id))}/></section>;}

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

function DocumentCreateModal({close,save}:{close:()=>void;save:(value:NewDocumentInput)=>Promise<void>}){const [projectCode,setProjectCode]=useState(projects[0]?.backendId??projects[0]?.code??"");const project=projects.find(item=>(item.backendId??item.code)===projectCode)??projects[0];const relevantUnits=units.filter(unit=>project&&unitBelongsToProject(unit,project));const relevantClients=clients.filter(client=>project&&client.projectNames.some(name=>projectMatchesName(project,name)));const relevantContracts=contracts.filter(contract=>project&&projectMatchesName(project,contract.project));const [name,setName]=useState("");const [typeCode,setTypeCode]=useState(documentTypeOptions[0].code);const [status,setStatus]=useState<DocumentStatus>("draft");const [unit,setUnit]=useState("");const [party,setParty]=useState("");const [contract,setContract]=useState("");const [salesCase,setSalesCase]=useState("");const [note,setNote]=useState("");return <FormModal title="Nový dokument" close={close} onSave={async()=>{if(!name.trim())throw new Error("Doplňte název dokumentu");const type=documentTypeOptions.find(item=>item.code===typeCode)!;await save({projectId:projectCode,projectName:project.name,name:name.trim(),typeCode,typeName:type.name,status,note,unit:unit||undefined,party:party||undefined,contract:contract||undefined,salesCase:salesCase||undefined});}} saveLabel="Vytvořit dokument"><div className="form-row"><label><span>Projekt</span><select value={projectCode} onChange={event=>{setProjectCode(event.target.value);setUnit("");setParty("");setContract("");}}>{projects.map(item=><option key={item.code} value={item.backendId??item.code}>{item.name}</option>)}</select></label><label><span>Typ dokumentu</span><select value={typeCode} onChange={event=>setTypeCode(event.target.value)}>{documentTypeOptions.map(item=><option key={item.code} value={item.code}>{item.name}</option>)}</select></label></div><label><span>Název dokumentu</span><input value={name} onChange={event=>setName(event.target.value)} placeholder="Např. SBK A203 – Novákovi"/></label><div className="form-row"><label><span>Výchozí stav</span><select value={status} onChange={event=>setStatus(event.target.value as DocumentStatus)}>{documentStatusOptions.filter(item=>["draft","ready"].includes(item.code)).map(item=><option key={item.code} value={item.code}>{item.label}</option>)}</select></label><label><span>Jednotka</span><select value={unit} onChange={event=>setUnit(event.target.value)}><option value="">Bez vazby na jednotku</option>{relevantUnits.map(item=><option key={item.id} value={item.id}>{item.id} · {item.layout}</option>)}</select></label></div><div className="form-row"><label><span>Klient</span><select value={party} onChange={event=>setParty(event.target.value)}><option value="">Bez vazby na klienta</option>{relevantClients.map(item=><option key={item.id} value={item.name}>{item.name}</option>)}</select></label><label><span>Smlouva</span><select value={contract} onChange={event=>setContract(event.target.value)}><option value="">Bez vazby na smlouvu</option>{relevantContracts.map(item=><option key={item.id??item.reference} value={item.id??item.reference}>{item.type} · {item.unit}</option>)}</select></label></div><label><span>Technická vazba na sales case</span><input value={salesCase} onChange={event=>setSalesCase(event.target.value)} placeholder="Volitelné – interní identifikátor obchodní vazby"/></label><label><span>Poznámka</span><textarea value={note} onChange={event=>setNote(event.target.value)} rows={3} placeholder="Interní kontext dokumentu"/></label><p className="form-help"><Link2 size={14}/> Vazby se ukládají samostatně; dokument nevytváří kopii klienta, jednotky ani smlouvy.</p></FormModal>;}
function DocumentEditModal({document,close,save}:{document:DocumentRecord;close:()=>void;save:(value:{name:string;typeCode:string;typeName:string;status:DocumentStatus;note:string})=>Promise<void>}){const [name,setName]=useState(document.name);const [typeCode,setTypeCode]=useState(document.typeCode);const [status,setStatus]=useState<DocumentStatus>(document.status);const [note,setNote]=useState(document.note??"");return <FormModal title="Upravit metadata dokumentu" close={close} onSave={async()=>{if(!name.trim())throw new Error("Název dokumentu nesmí být prázdný");const type=documentTypeOptions.find(item=>item.code===typeCode)??{name:document.typeName};await save({name:name.trim(),typeCode,typeName:type.name,status,note});}}><label><span>Název</span><input value={name} onChange={event=>setName(event.target.value)}/></label><div className="form-row"><label><span>Typ</span><select value={typeCode} onChange={event=>setTypeCode(event.target.value)}>{documentTypeOptions.map(item=><option key={item.code} value={item.code}>{item.name}</option>)}</select></label><label><span>Stav</span><select value={status} onChange={event=>setStatus(event.target.value as DocumentStatus)}>{documentStatusOptions.map(item=><option key={item.code} value={item.code}>{item.label}</option>)}</select></label></div><label><span>Interní poznámka</span><textarea rows={4} value={note} onChange={event=>setNote(event.target.value)}/></label><p className="form-help"><History size={14}/> Změna metadat nebo stavu vytvoří auditní událost; fyzická verze se nepřepisuje.</p></FormModal>;}
function DocumentVersionModal({document,close,save}:{document:DocumentRecord;close:()=>void;save:(value:{label:string;status:DocumentStatus;note:string})=>Promise<void>}){const highest=Math.max(0,...(document.versions??[]).map(version=>Number(version.label.replace(/\D/g,""))||0));const [label,setLabel]=useState(`v${highest+1}`);const [status,setStatus]=useState<DocumentStatus>(document.status==="signed"?"ready":document.status);const [note,setNote]=useState("");return <FormModal title={`Nová verze · ${document.name}`} close={close} onSave={async()=>{if(!label.trim())throw new Error("Doplňte označení verze");if(!note.trim())throw new Error("Doplňte popis změny verze");await save({label:label.trim(),status,note});}} saveLabel="Vytvořit verzi"><div className="form-row"><label><span>Označení verze</span><input value={label} onChange={event=>setLabel(event.target.value)}/></label><label><span>Stav verze</span><select value={status} onChange={event=>setStatus(event.target.value as DocumentStatus)}>{documentStatusOptions.filter(item=>item.code!=="archived").map(item=><option key={item.code} value={item.code}>{item.label}</option>)}</select></label></div><label><span>Popis změn</span><textarea rows={4} value={note} onChange={event=>setNote(event.target.value)} placeholder="Co se oproti předchozí verzi změnilo?"/></label><p className="form-help"><FileCheck2 size={14}/> Vznikne nová fyzická verze pod stejným logickým dokumentem; předchozí verze zůstává zachována.</p></FormModal>;}
function EditProjectModal({project,memberships,canChangeManager,canChangeStatus,close,save}:{project:ProjectRecord;memberships:MembershipOption[];canChangeManager:boolean;canChangeStatus:boolean;close:()=>void;save:(value:{name:string;location:string;lifecycleStatus:string;managerMembershipId:string|null;plannedCompletion:string|null;stageCode:string;stageReason:string})=>Promise<void>}){
  const initialCompletion=projectCompletionMonthValue(project.plannedCompletionFrom??project.plannedCompletionTo);const [initialYear="",initialMonth=""]=initialCompletion.split("-");
  const [name,setName]=useState(project.name);const [location,setLocation]=useState(project.location);const [lifecycleStatus,setLifecycleStatus]=useState(project.lifecycleStatus??"active");const [manager,setManager]=useState(project.managerMembershipId??"");const [completionMonth,setCompletionMonth]=useState(initialMonth);const [completionYear,setCompletionYear]=useState(initialYear);const [stage,setStage]=useState(project.stageCode??projectConstructionCode(project.stage)??"preparation");const [reason,setReason]=useState("");
  return <FormModal title="Upravit projekt" close={close} onSave={async()=>{if(Boolean(completionMonth)!==Boolean(completionYear))throw new Error("Vyberte měsíc i rok plánovaného dokončení");await save({name,location,lifecycleStatus,managerMembershipId:manager||null,plannedCompletion:projectCompletionStorageDate(completionMonth&&completionYear?`${completionYear}-${completionMonth}`:""),stageCode:stage,stageReason:reason});}}><div className="form-row"><label><span>Název projektu</span><input value={name} onChange={e=>setName(e.target.value)} /></label><label><span>Lokalita</span><input value={location} onChange={e=>setLocation(e.target.value)} /></label></div><div className="form-row"><label><span>Životní cyklus projektu</span><select value={lifecycleStatus} onChange={e=>setLifecycleStatus(e.target.value)}><option value="preparation">Příprava</option><option value="active">Aktivní</option><option value="completed">Dokončený</option><option value="archived">Archivovaný</option></select></label><label><span>Vedoucí projektu</span><select value={manager} disabled={!canChangeManager} onChange={e=>setManager(e.target.value)}><option value="">Bez vedoucího</option>{memberships.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div><MonthYearPicker month={completionMonth} year={completionYear} onMonth={setCompletionMonth} onYear={setCompletionYear}/><label><span>Aktuální fáze projektu</span><select value={stage} disabled={!canChangeStatus} onChange={e=>setStage(e.target.value)}>{PROJECT_CONSTRUCTION_PHASES.map(item=><option key={item.code} value={item.code}>{item.label}</option>)}</select></label>{stage!==(project.stageCode??projectConstructionCode(project.stage))&&<label><span>Důvod změny fáze</span><textarea value={reason} onChange={e=>setReason(e.target.value)} rows={2} placeholder="Krátké vysvětlení pro historii projektu" /></label>}</FormModal>;
}

const czechMonths=["leden","únor","březen","duben","květen","červen","červenec","srpen","září","říjen","listopad","prosinec"];
function MonthYearPicker({month,year,onMonth,onYear}:{month:string;year:string;onMonth:(value:string)=>void;onYear:(value:string)=>void}){const currentYear=new Date().getFullYear();const years=Array.from(new Set([...(year?[Number(year)]:[]),...Array.from({length:18},(_,index)=>currentYear-1+index)])).filter(Number.isFinite).sort((a,b)=>a-b);return <fieldset className="month-year-picker"><legend>Plánované dokončení</legend><label><span>Měsíc</span><select aria-label="Měsíc plánovaného dokončení" value={month} onChange={event=>onMonth(event.target.value)}><option value="">Vyberte měsíc</option>{czechMonths.map((label,index)=><option key={label} value={String(index+1).padStart(2,"0")}>{label}</option>)}</select></label><label><span>Rok</span><select aria-label="Rok plánovaného dokončení" value={year} onChange={event=>onYear(event.target.value)}><option value="">Vyberte rok</option>{years.map(item=><option key={item} value={item}>{item}</option>)}</select></label></fieldset>}
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
function NewClientModal({projects:projectRows,close,save}:{projects:ProjectRecord[];close:()=>void;save:(value:{projectId:string;kind:"individual"|"organization";firstName?:string;lastName?:string;legalName?:string;registrationNumber?:string;email?:string;phone?:string})=>Promise<void>}){
  const [kind,setKind]=useState<"individual"|"organization">("individual");const [projectId,setProjectId]=useState(projectRows[0]?.backendId??"");const [firstName,setFirstName]=useState("");const [lastName,setLastName]=useState("");const [legalName,setLegalName]=useState("");const [registrationNumber,setRegistrationNumber]=useState("");const [email,setEmail]=useState("");const [phone,setPhone]=useState("");
  return <FormModal title="Nový klient nebo zájemce" close={close} saveLabel="Vytvořit klienta" onSave={async()=>{if(!projectId)throw new Error("Vyberte projekt");if(kind==="individual"&&(!firstName.trim()||!lastName.trim()))throw new Error("Doplňte jméno a příjmení");if(kind==="organization"&&!legalName.trim())throw new Error("Doplňte název společnosti");await save({projectId,kind,firstName:firstName.trim()||undefined,lastName:lastName.trim()||undefined,legalName:legalName.trim()||undefined,registrationNumber:registrationNumber.trim()||undefined,email:email.trim()||undefined,phone:phone.trim()||undefined});}}><div className="form-row"><label><span>Typ klienta</span><select value={kind} onChange={event=>setKind(event.target.value as "individual"|"organization")}><option value="individual">Fyzická osoba</option><option value="organization">Právnická osoba</option></select></label><label><span>Projekt</span><select value={projectId} onChange={event=>setProjectId(event.target.value)}>{projectRows.map(project=><option key={project.backendId} value={project.backendId}>{project.name}</option>)}</select></label></div>{kind==="individual"?<div className="form-row"><label><span>Jméno</span><input autoFocus value={firstName} onChange={event=>setFirstName(event.target.value)}/></label><label><span>Příjmení</span><input value={lastName} onChange={event=>setLastName(event.target.value)}/></label></div>:<div className="form-row"><label><span>Název společnosti</span><input autoFocus value={legalName} onChange={event=>setLegalName(event.target.value)}/></label><label><span>IČO</span><input value={registrationNumber} onChange={event=>setRegistrationNumber(event.target.value)}/></label></div>}<div className="form-row"><label><span>E-mail</span><input type="email" value={email} onChange={event=>setEmail(event.target.value)}/></label><label><span>Telefon</span><input type="tel" value={phone} onChange={event=>setPhone(event.target.value)}/></label></div></FormModal>;
}
function HandoverScheduleModal({units:unitRows,memberships,close,save}:{units:UnitRecord[];memberships:MembershipOption[];close:()=>void;save:(value:{unitId:string;scheduledAt:string;responsibleMembershipId:string})=>Promise<void>}){
  const candidates=unitRows.filter(unit=>unit.status!=="Volný"&&unit.handover==="Neplánováno");const [unitId,setUnitId]=useState(candidates[0]?.backendId??"");const [responsibleMembershipId,setResponsibleMembershipId]=useState(memberships[0]?.id??"");const [scheduledAt,setScheduledAt]=useState(()=>{const initial=addCalendarDays(new Date(),1);initial.setHours(10,0,0,0);return initial.toISOString().slice(0,16);});
  return <FormModal title="Naplánovat předání" close={close} saveLabel="Naplánovat" onSave={async()=>{if(!unitId)throw new Error("Vyberte jednotku");if(!responsibleMembershipId)throw new Error("Vyberte odpovědnou osobu");const date=new Date(scheduledAt);if(Number.isNaN(date.getTime())||date<=new Date())throw new Error("Termín musí být v budoucnu");await save({unitId,scheduledAt:date.toISOString(),responsibleMembershipId});}}><label><span>Jednotka</span><select value={unitId} onChange={event=>setUnitId(event.target.value)}>{candidates.map(unit=><option key={unit.backendId} value={unit.backendId}>{unit.id} · {unit.project}{unit.client?` · ${unit.client}`:""}</option>)}</select>{!candidates.length&&<small>Žádná vhodná jednotka bez aktivního předání.</small>}</label><div className="form-row"><label><span>Datum a čas</span><input type="datetime-local" value={scheduledAt} onChange={event=>setScheduledAt(event.target.value)}/></label><label><span>Odpovědná osoba</span><select value={responsibleMembershipId} onChange={event=>setResponsibleMembershipId(event.target.value)}>{memberships.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div></FormModal>;
}
function NewContractModal({units:unitRows,close,save}:{units:UnitRecord[];close:()=>void;save:(value:{salesCaseId:string;type:"rs"|"sbk"|"ks"|"amendment";reference:string;title:string})=>Promise<void>}){
  const candidates=unitRows.filter(unit=>Boolean(unitCommercialContexts[unit.id]?.salesCaseId));const [unitKey,setUnitKey]=useState(candidates[0]?.id??"");const [type,setType]=useState<"rs"|"sbk"|"ks"|"amendment">("rs");const [reference,setReference]=useState("");const [title,setTitle]=useState("");const selectedUnit=candidates.find(unit=>unit.id===unitKey);
  return <FormModal title="Nová smlouva" close={close} saveLabel="Vytvořit smlouvu" onSave={async()=>{const salesCaseId=unitCommercialContexts[unitKey]?.salesCaseId;if(!salesCaseId)throw new Error("Vyberte jednotku s aktivním obchodním procesem");if(!reference.trim()||!title.trim())throw new Error("Doplňte označení a název smlouvy");await save({salesCaseId,type,reference:reference.trim(),title:title.trim()});}}><label><span>Jednotka a klient</span><select value={unitKey} onChange={event=>setUnitKey(event.target.value)}>{candidates.map(unit=><option key={unit.id} value={unit.id}>{unit.id} · {unit.client||"aktivní obchodní proces"} · {unit.project}</option>)}</select>{!candidates.length&&<small>Nejdříve u jednotky vytvořte předrezervaci nebo rezervaci.</small>}</label><div className="form-row"><label><span>Typ smlouvy</span><select value={type} onChange={event=>setType(event.target.value as typeof type)}><option value="rs">RS</option><option value="sbk">SBK</option><option value="ks">KS</option><option value="amendment">Dodatek</option></select></label><label><span>Označení smlouvy</span><input value={reference} onChange={event=>setReference(event.target.value)} placeholder={`Např. ${type.toUpperCase()}-${selectedUnit?.id??"A101"}`}/></label></div><label><span>Název</span><input value={title} onChange={event=>setTitle(event.target.value)} placeholder={`${type.toUpperCase()} · ${selectedUnit?.id??"jednotka"}`}/></label><p className="form-help"><Link2 size={14}/> Smlouva se naváže na existující sales case, jednotku a jeho účastníky. Klientská data se nekopírují.</p></FormModal>;
}
function ContractVersionModal({contract,close,save}:{contract:(typeof contracts)[number];close:()=>void;save:(value:{name:string;source:string;basedOnVersionId?:string})=>Promise<void>}){const latest=contract.versions?.[0];const next=(latest?.number??0)+1;const [name,setName]=useState(`${contract.reference??`${contract.type}-${contract.unit}`}_v${String(next).padStart(2,"0")}`);const [source,setSource]=useState("manual");return <FormModal title={`Nová verze · ${contract.reference??contract.type}`} close={close} saveLabel="Vytvořit verzi" onSave={async()=>{if(!name.trim())throw new Error("Doplňte název verze");await save({name:name.trim(),source,basedOnVersionId:latest?.id});}}><label><span>Název logické verze</span><input autoFocus value={name} onChange={event=>setName(event.target.value)}/></label><label><span>Zdroj verze</span><select value={source} onChange={event=>setSource(event.target.value)}><option value="manual">Ručně připravená verze</option><option value="received">Verze vrácená klientem</option><option value="generated">Vygenerováno z CRM</option></select></label>{latest&&<p className="form-help"><Link2 size={14}/> Nová verze naváže na v{latest.number} a předchozí záznam zůstane zachován.</p>}</FormModal>}
function ContractSignatureModal({value,close,save}:{value:{contract:(typeof contracts)[number];partyName:string};close:()=>void;save:(reason:string)=>Promise<void>}){const [reason,setReason]=useState("Podpis ověřen podle podepsané smlouvy");return <FormModal title={`Zaznamenat podpis · ${value.partyName}`} close={close} saveLabel="Potvrdit podpis" onSave={async()=>{if(reason.trim().length<5)throw new Error("Doplňte způsob ověření podpisu");if(!window.confirm(`Potvrzujete podpis účastníka ${value.partyName}?`))return;await save(reason.trim());}}><p className="form-help"><FileCheck2 size={14}/> Podpis se uloží k nejnovější logické verzi smlouvy {value.contract.reference??value.contract.type}. Poslední chybějící podpis dokončí smluvní workflow.</p><label><span>Způsob ověření / poznámka</span><textarea rows={3} value={reason} onChange={event=>setReason(event.target.value)}/></label></FormModal>}
function ContractWorkflowModal({contract,close,save}:{contract:(typeof contracts)[number];close:()=>void;save:(value:{to:string;reason:string})=>Promise<void>}){const options=availableContractTransitions(contract.statusCode??contract.state);const [to,setTo]=useState<string>(options[0]??"");const [reason,setReason]=useState("");return <FormModal title={`Workflow ${contract.type} · ${contract.unit}`} close={close} onSave={async()=>{if(!to)throw new Error("Pro aktuální stav není dostupný ruční přechod");if(!reason.trim())throw new Error("Doplňte důvod změny");if((to==="cancelled"||to==="terminated")&&!window.confirm("Tato změna je obchodně významná. Opravdu pokračovat?"))return;await save({to,reason});}}><label><span>Aktuální stav</span><input value={contractStatusLabel(contract.statusCode??contract.state)} disabled/></label><label><span>Nový stav</span><select value={to} onChange={e=>setTo(e.target.value)}>{options.map(item=><option key={item} value={item}>{contractStatusLabel(item)}</option>)}</select></label><label><span>Důvod změny</span><textarea rows={3} value={reason} onChange={e=>setReason(e.target.value)}/></label><p className="form-help"><History size={14}/> Dostupné jsou pouze doménově povolené přechody. Podepsání vzniká dokončením podpisů.</p></FormModal>}
function FormModal({title,close,onSave,children,saveLabel="Uložit"}:{title:string;close:()=>void;onSave:()=>Promise<void>;children:React.ReactNode;saveLabel?:string}){const [busy,setBusy]=useState(false);const [error,setError]=useState("");const submit=async()=>{setBusy(true);setError("");try{await onSave();}catch(problem){setError(problem instanceof Error?problem.message:"Změnu se nepodařilo uložit");}finally{setBusy(false);}};return <div className="modal-layer"><button className="modal-scrim" onClick={close} aria-label="Zavřít dialog" /><div className="modal form-modal"><div className="modal-head"><div><h2>{title}</h2><p>Změna se uloží přes řízenou doménovou operaci.</p></div><button className="icon-button" onClick={close}><X size={19}/></button></div><div className="modal-form">{children}{error&&<div className="form-error"><AlertTriangle size={15}/>{error}</div>}</div><div className="modal-foot"><button className="secondary-button" onClick={close} disabled={busy}>Zrušit</button><button className="primary-button" onClick={()=>void submit()} disabled={busy}>{busy?"Ukládám…":saveLabel}</button></div></div></div>}

function NewProjectModal({memberships,close,save}:{memberships:MembershipOption[];close:()=>void;save:(value:{name:string;code:string;location:string;address:string;description:string;constructionStatus:string;plannedHandoverFrom:string|null;managerMembershipId:string|null;projectCompany:string;defaultCurrency:string;plannedUnitCount:number|null;note:string})=>Promise<void>}){
  const [name,setName]=useState("");const [code,setCode]=useState("");const [location,setLocation]=useState("");const [address,setAddress]=useState("");const [description,setDescription]=useState("");const [constructionStatus,setConstructionStatus]=useState("preparation");const [completionMonth,setCompletionMonth]=useState("");const [completionYear,setCompletionYear]=useState("");const [managerMembershipId,setManagerMembershipId]=useState("");const [projectCompany,setProjectCompany]=useState("");const [defaultCurrency,setDefaultCurrency]=useState("CZK");const [plannedUnitCount,setPlannedUnitCount]=useState("");const [note,setNote]=useState("");
  return <FormModal title="Nový projekt" close={close} saveLabel="Založit projekt" onSave={async()=>{const normalizedCode=code.trim().toUpperCase();if(name.trim().length<2)throw new Error("Doplňte název projektu");if(!/^[A-Z0-9ČŘŠŽÝÁÍÉÚŮĚ_-]{2,16}$/.test(normalizedCode))throw new Error("Kód musí mít 2–16 velkých písmen, číslic, pomlček nebo podtržítek");if(!location.trim())throw new Error("Doplňte lokalitu projektu");if(Boolean(completionMonth)!==Boolean(completionYear))throw new Error("Vyberte měsíc i rok plánovaného dokončení");await save({name:name.trim(),code:normalizedCode,location:location.trim(),address:address.trim(),description:description.trim(),constructionStatus,plannedHandoverFrom:projectCompletionStorageDate(completionMonth&&completionYear?`${completionYear}-${completionMonth}`:""),managerMembershipId:managerMembershipId||null,projectCompany:projectCompany.trim(),defaultCurrency,plannedUnitCount:plannedUnitCount?Number(plannedUnitCount):null,note:note.trim()});}}>
    <div className="form-row"><label><span>Název projektu</span><input autoFocus value={name} onChange={event=>{setName(event.target.value);if(!code)setCode(projectCodeSuggestion(event.target.value));}} placeholder="Např. Rezidence Vltavská"/></label><label><span>Kód projektu</span><input maxLength={16} value={code} onChange={event=>setCode(event.target.value.toUpperCase())} placeholder="RVL"/></label></div>
    <div className="form-row"><label><span>Lokalita</span><input value={location} onChange={event=>setLocation(event.target.value)} placeholder="Praha 6"/></label><label><span>Adresa</span><input value={address} onChange={event=>setAddress(event.target.value)} placeholder="Ulice a číslo"/></label></div>
    <label><span>Stručný popis</span><textarea rows={3} value={description} onChange={event=>setDescription(event.target.value)}/></label>
    <label><span>Počáteční fáze výstavby</span><select value={constructionStatus} onChange={event=>setConstructionStatus(event.target.value)}>{PROJECT_CONSTRUCTION_PHASES.map(option=><option key={option.code} value={option.code}>{option.label}</option>)}</select></label><MonthYearPicker month={completionMonth} year={completionYear} onMonth={setCompletionMonth} onYear={setCompletionYear}/>
    <div className="form-row"><label><span>Vedoucí projektu</span><select value={managerMembershipId} onChange={event=>setManagerMembershipId(event.target.value)}><option value="">Zatím nepřiřazen</option>{memberships.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label><span>Projektová společnost</span><input value={projectCompany} onChange={event=>setProjectCompany(event.target.value)} placeholder="SPV / vlastník projektu"/></label></div>
    <div className="form-row"><label><span>Měna</span><select value={defaultCurrency} onChange={event=>setDefaultCurrency(event.target.value)}><option value="CZK">CZK</option><option value="EUR">EUR</option></select></label><label><span>Plánovaný počet jednotek</span><input type="number" min="0" value={plannedUnitCount} onChange={event=>setPlannedUnitCount(event.target.value)}/></label></div>
    <label><span>Interní poznámka</span><textarea rows={2} value={note} onChange={event=>setNote(event.target.value)}/></label>
    <p className="form-help"><ShieldCheck size={14}/> Projekt vznikne prázdný. Jednotky, klienti ani jiné demo záznamy se automaticky nevytvoří.</p>
  </FormModal>;
}

function projectCodeSuggestion(value:string){return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").split(/\s+/).filter(Boolean).map(part=>part[0]).join("").replace(/[^A-Z0-9]/gi,"").slice(0,8).toUpperCase();}
function slugifyProject(value:string){const slug=value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");return slug||`projekt-${Date.now()}`;}
function numberValue(value:string){if(!value.trim())return undefined;const number=Number(value.replace(",","."));return Number.isFinite(number)?number:undefined;}
function projectMatchesName(project:ProjectRecord,name:string){return name===project.name||name===project.sourceName;}
function unitBelongsToProject(unit:UnitRecord,project:ProjectRecord){return Boolean((unit.projectBackendId&&project.backendId&&unit.projectBackendId===project.backendId)||(unit.projectCode&&unit.projectCode===project.code)||projectMatchesName(project,unit.project));}
function isDejviceUnit(unit:UnitRecord){return unit.projectCode==="DEJ"||unit.project==="Rezidence Dejvice"||unit.project==="Rezidence Dejvice Test";}
function backendEntityId(value?:string|null){return value&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)?value:null;}
function projectRouteId(project:ProjectRecord){return project.backendId??project.code;}
function unitRouteId(unit:UnitRecord){return unit.backendId??unit.id;}

type TaskTarget={kind:"project"|"unit"|"party"|"contract";id:string;projectId:string;label:string};
function taskTargetOptions():TaskTarget[]{
  const result:TaskTarget[]=[];
  for(const project of projects){const projectId=backendEntityId(project.backendId);if(projectId)result.push({kind:"project",id:projectId,projectId,label:`Projekt · ${project.name}`});}
  for(const unit of units){const id=backendEntityId(unit.backendId),projectId=backendEntityId(unit.projectBackendId);if(id&&projectId)result.push({kind:"unit",id,projectId,label:`Jednotka ${unit.id} · ${unit.project}`});}
  for(const client of clients){const project=projects.find(item=>client.projectNames.some(name=>projectMatchesName(item,name)));const projectId=backendEntityId(project?.backendId);if(backendEntityId(client.id)&&projectId)result.push({kind:"party",id:client.id,projectId,label:`Klient · ${client.name}`});}
  for(const contract of contracts){const project=projects.find(item=>projectMatchesName(item,contract.project));const projectId=backendEntityId(project?.backendId);if(contract.id&&backendEntityId(contract.id)&&projectId)result.push({kind:"contract",id:contract.id,projectId,label:`Smlouva ${contract.type} · ${contract.unit}`});}
  return result;
}

function TaskModal({ close, save,memberships,targets,defaultUnit }: { close: () => void; save: (value:{title:string;description:string;target:TaskTarget;assigneeMembershipId:string;priority:"low"|"medium"|"high";dueAt:string}) => Promise<void>;memberships:MembershipOption[];targets:TaskTarget[];defaultUnit?:string }) {
  const initialTarget=targets.find(item=>item.kind==="unit"&&item.id===defaultUnit)??targets.find(item=>item.kind==="unit")??targets[0];
  const [title,setTitle]=useState("");const [description,setDescription]=useState("");const [targetId,setTargetId]=useState(initialTarget?`${initialTarget.kind}:${initialTarget.id}`:"");const [assigneeId,setAssigneeId]=useState(memberships[0]?.id??"");const [priority,setPriority]=useState<"low"|"medium"|"high">("medium");const [dueAt,setDueAt]=useState(()=>localDateKey(addCalendarDays(new Date(),1)));
  return <FormModal title="Nový úkol" close={close} saveLabel="Vytvořit úkol" onSave={async()=>{if(!title.trim())throw new Error("Doplňte název úkolu");const target=targets.find(item=>`${item.kind}:${item.id}`===targetId);if(!target)throw new Error("Vyberte objekt, ke kterému úkol patří");if(!assigneeId)throw new Error("Vyberte odpovědnou osobu");await save({title:title.trim(),description:description.trim(),target,assigneeMembershipId:assigneeId,priority,dueAt});}}><label><span>Název úkolu</span><input autoFocus value={title} onChange={event=>setTitle(event.target.value)} placeholder="Co je potřeba udělat?"/></label><label><span>Popis</span><textarea rows={3} value={description} onChange={event=>setDescription(event.target.value)} placeholder="Kontext a očekávaný výsledek"/></label><label><span>Vazba na objekt</span><select value={targetId} onChange={event=>setTargetId(event.target.value)}><option value="" disabled>Vyberte projekt, jednotku, klienta nebo smlouvu</option>{targets.map(item=><option key={`${item.kind}:${item.id}`} value={`${item.kind}:${item.id}`}>{item.label}</option>)}</select></label><div className="form-row"><label><span>Termín</span><input type="date" value={dueAt} onChange={event=>setDueAt(event.target.value)}/></label><label><span>Odpovědná osoba</span><select value={assigneeId} onChange={event=>setAssigneeId(event.target.value)}><option value="" disabled>Vyberte aktivního uživatele</option>{memberships.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label><span>Priorita</span><select value={priority} onChange={event=>setPriority(event.target.value as "low"|"medium"|"high")}><option value="low">Nízká</option><option value="medium">Střední</option><option value="high">Vysoká</option></select></label></div></FormModal>;
}

function IssueReportModal({page,close,save}:{page:Page;close:()=>void;save:(value:{subject:string;description:string;priority:"normal"|"high"})=>Promise<void>}){
  const [subject,setSubject]=useState("");const [description,setDescription]=useState("");const [priority,setPriority]=useState<"normal"|"high">("normal");
  return <FormModal title="Nahlásit problém" close={close} saveLabel="Odeslat hlášení" onSave={async()=>{if(subject.trim().length<3||description.trim().length<5)throw new Error("Doplňte stručný název a popis problému");await save({subject:subject.trim(),description:description.trim(),priority});}}><p className="form-help"><MessageSquare size={14}/> Hlášení se uloží jako interní záznam včetně aktuální stránky: {pageTitles[page].title}.</p><label><span>Název problému</span><input autoFocus value={subject} onChange={event=>setSubject(event.target.value)} placeholder="Co nefunguje nebo není srozumitelné?"/></label><label><span>Popis a očekávané chování</span><textarea rows={5} value={description} onChange={event=>setDescription(event.target.value)} placeholder="Popište postup, výsledek a co jste očekávali."/></label><label><span>Priorita</span><select value={priority} onChange={event=>setPriority(event.target.value as "normal"|"high")}><option value="normal">Běžná</option><option value="high">Vysoká – blokuje práci</option></select></label></FormModal>;
}

function ProfileModal({session,close,openSettings,openAdmin,canAdmin}:{session:IdentitySession;close:()=>void;openSettings:()=>void;openAdmin:()=>void;canAdmin:boolean}){const scopes=session.workspace.projectScopes??[];const [workspaces,setWorkspaces]=useState<Array<{tenantId:string;tenantName:string;tenantSlug:string}>>([]);useEffect(()=>{const controller=new AbortController();identityRepository.listWorkspaces(controller.signal).then(setWorkspaces).catch(()=>undefined);return()=>controller.abort();},[]);return <div className="modal-layer"><button className="modal-scrim" onClick={close} aria-label="Zavřít profil"/><div className="modal profile-modal"><div className="modal-head"><div><h2>Profil a pracovní prostor</h2><p>Přihlášený uživatel a jeho efektivní oprávnění.</p></div><button className="icon-button" onClick={close}><X size={19}/></button></div><div className="profile-summary"><Avatar initials={session.user.initials||initials(session.user.displayName)}/><span><strong>{session.user.displayName}</strong><small>{session.user.email}{session.user.jobTitle?` · ${session.user.jobTitle}`:""}</small></span><Badge tone="success">Aktivní</Badge></div><div className="profile-workspace"><Building2 size={18}/><span><small>PRACOVNÍ PROSTOR</small><strong>{session.workspace.tenantName}</strong></span>{session.workspace.roles.map(role=><Badge key={role} tone="neutral">{roleLabel([role])}</Badge>)}</div>{workspaces.length>1&&<label className="workspace-switch"><span>Přepnout pracovní prostor</span><select defaultValue={session.workspace.tenantId} onChange={()=>window.location.reload()}>{workspaces.map(workspace=><option key={workspace.tenantId} value={workspace.tenantId}>{workspace.tenantName}</option>)}</select></label>}<section className="profile-section"><h3>Projektové rozsahy</h3>{scopes.length?scopes.map(scope=><div key={scope.projectId}><span><strong>{scope.projectName}</strong><small>{scope.roles.map(role=>roleLabel([role])).join(", ")}</small></span></div>):<p>Tenantová role umožňuje práci ve všech dostupných projektech.</p>}</section><div className="profile-actions"><button className="secondary-button" onClick={openSettings}><Settings size={16}/> Nastavení profilu</button>{canAdmin&&<button className="secondary-button" onClick={openAdmin}><ShieldCheck size={16}/> Uživatelé a role</button>}{session.source==="production-api"?<button className="secondary-button danger-text" onClick={()=>void entraAuth.logout()}><LogOut size={16}/> Odhlásit se</button>:<Link className="secondary-button danger-text" href="/signout-with-chatgpt?return_to=%2F"><LogOut size={16}/> Odhlásit se</Link>}</div></div></div>}

function ProfileSettingsModal({user,close,save}:{user:IdentitySession["user"];close:()=>void;save:(value:ProfileInput)=>Promise<void>}){
  const [displayName,setDisplayName]=useState(user.displayName);const [jobTitle,setJobTitle]=useState(user.jobTitle??"");const [phone,setPhone]=useState(user.phone??"");const [profileInitials,setProfileInitials]=useState(user.initials??initials(user.displayName));const [language,setLanguage]=useState<"cs"|"en">(user.language??"cs");const [timezone,setTimezone]=useState(user.timezone??"Europe/Prague");const [emailNotifications,setEmailNotifications]=useState(user.notifications?.email??true);const [inAppNotifications,setInAppNotifications]=useState(user.notifications?.inApp??true);
  return <FormModal title="Nastavení profilu" close={close} onSave={async()=>{if(displayName.trim().length<2)throw new Error("Doplňte zobrazované jméno");await save({displayName:displayName.trim(),jobTitle,phone,initials:profileInitials,language,timezone,notifications:{email:emailNotifications,inApp:inAppNotifications}});}}><div className="form-row"><label><span>Zobrazované jméno</span><input value={displayName} onChange={event=>setDisplayName(event.target.value)}/></label><label><span>Iniciály</span><input maxLength={4} value={profileInitials} onChange={event=>setProfileInitials(event.target.value.toUpperCase())}/></label></div><div className="form-row"><label><span>Pracovní pozice</span><input value={jobTitle} onChange={event=>setJobTitle(event.target.value)}/></label><label><span>Telefon</span><input value={phone} onChange={event=>setPhone(event.target.value)}/></label></div><label><span>Pracovní e-mail z Microsoft Entra ID</span><input value={user.email} disabled/><small>Tento údaj se spravuje v Microsoft 365.</small></label><div className="form-row"><label><span>Jazyk</span><select value={language} onChange={event=>setLanguage(event.target.value as "cs"|"en")}><option value="cs">Čeština</option><option value="en">English</option></select></label><label><span>Časové pásmo</span><select value={timezone} onChange={event=>setTimezone(event.target.value)}><option value="Europe/Prague">Europe/Prague</option><option value="Europe/Bratislava">Europe/Bratislava</option><option value="Europe/London">Europe/London</option></select></label></div><fieldset className="admin-check-grid"><legend>Notifikace</legend><label><input type="checkbox" checked={inAppNotifications} onChange={event=>setInAppNotifications(event.target.checked)}/><span>V aplikaci</span></label><label><input type="checkbox" checked={emailNotifications} onChange={event=>setEmailNotifications(event.target.checked)}/><span>E-mailem</span></label></fieldset><p className="form-help"><ShieldCheck size={14}/> Změny profilu se ukládají a zapisují do auditu.</p></FormModal>;
}

function MediaModal({value,close,save}:{value:{title:string;kind:"cover"|"floorplan"};close:()=>void;save:(file:File)=>Promise<void>}){const [file,setFile]=useState<File|null>(null);const [preview,setPreview]=useState<string|null>(null);return <FormModal title={value.title} close={close} saveLabel={value.kind==="cover"?"Uložit titulní obrázek":"Uložit půdorys"} onSave={async()=>{if(!file)throw new Error("Vyberte obrázek");await save(file);}}><label className="media-dropzone"><ImagePlus size={25}/><span><strong>Vyberte obrázek</strong><small>JPG, PNG nebo WebP · maximálně 12 MB</small></span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={event=>{const selected=event.target.files?.[0]??null;setFile(selected);setPreview(selected?URL.createObjectURL(selected):null);}}/></label>{preview&&<img className={`media-preview ${value.kind}`} src={preview} alt="Náhled vybraného obrázku"/>}<p className="form-help"><FolderOpen size={14}/> Preview ukládá soubor do R2. Produkční repository je připravené na metadata a budoucí SharePoint external ID.</p></FormModal>}

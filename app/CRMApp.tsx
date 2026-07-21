"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  KeyRound,
  LayoutDashboard,
  Link2,
  List,
  Mail,
  MapPin,
  Menu,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  Table2,
  Upload,
  UserRound,
  Users,
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
  unitTimeline,
  units,
  type UnitRecord,
} from "./crm-data";

type Page = "dashboard" | "projects" | "clients" | "contracts" | "payments" | "handovers" | "tasks";
type UnitTab = "overview" | "contracts" | "payments" | "changes" | "documents" | "handover" | "tasks" | "history";
type ProjectTab = "overview" | "units" | "clients" | "contracts" | "payments" | "changes" | "handovers" | "documents";
type ProjectRecord = (typeof projects)[number];

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
  if (["Po splatnosti", "Vyžaduje pozornost", "Vysoká"].includes(value)) return "danger";
  if (["Předrezervace", "Odeslána", "Čeká na úhradu", "Střední"].includes(value)) return "warning";
  if (["KS", "SBK", "Ve vyjednávání", "Ke kontrole", "Předání"].includes(value)) return "purple";
  if (["RS", "V přípravě", "Aktivní klient"].includes(value)) return "blue";
  return "neutral";
};

function Badge({ children, tone }: { children: React.ReactNode; tone?: string }) {
  return <span className={`badge ${tone || statusClass(String(children))}`}>{children}</span>;
}

function TableColumnFilter({ label, active = false, className = "", children }: { label: string; active?: boolean; className?: string; children?: React.ReactNode }) {
  return <th className={`column-filter ${active ? "active" : ""} ${className}`.trim()}><span className="column-filter-heading">{label}{children && <Filter size={12} />}</span>{children && <span className="column-filter-control">{children}</span>}</th>;
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

export default function CRMApp() {
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
  const [search, setSearch] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [taskRows, setTaskRows] = useState(initialTasks);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/tasks")
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((payload: { tasks?: Array<{ id: string; title: string; objectId: string; priority: string; dueAt: string | null }> }) => {
        if (!active || !payload.tasks?.length) return;
        const saved = payload.tasks.map((task) => ({
          id: Number(task.id),
          title: task.title,
          object: `${task.objectId} · Ručně vytvořený úkol`,
          project: "Rezidence Javorová",
          due: task.dueAt === "2026-07-22" ? "Zítra" : task.dueAt || "Bez termínu",
          priority: task.priority === "high" ? "Vysoká" : task.priority === "low" ? "Nízká" : "Střední",
          owner: "Iva",
          done: false,
        }));
        setTaskRows((rows) => [...saved, ...rows.filter((row) => !saved.some((item) => item.title === row.title))]);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  const filteredUnits = useMemo(() => {
    return units.filter((unit) => {
      const matchesProject = projectFilter === "Všechny projekty" || unit.project === projectFilter;
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
  }, [projectFilter, buildingFilter, floorFilter, statusFilter, layoutFilter, areaFrom, areaTo, priceFrom, priceTo]);

  const searchResults = useMemo(() => {
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
  }, [search]);

  const navigate = (nextPage: Page) => {
    setPage(nextPage);
    setUnitDetail(null);
    setUnitPreview(null);
    setSelectedProject(null);
    if (nextPage !== "clients") setSelectedClientName(null);
    setMobileNav(false);
  };

  const openProject = (project: ProjectRecord, tab: ProjectTab = "overview") => {
    setPage("projects");
    setSelectedProject(project);
    setProjectTab(tab);
    setProjectFilter(project.name);
    setBuildingFilter([]);
    setFloorFilter([]);
    setStatusFilter([]);
    setLayoutFilter([]);
    setAreaFrom("");
    setAreaTo("");
    setPriceFrom("");
    setPriceTo("");
    setUnitDetail(null);
    setUnitPreview(null);
    setMobileNav(false);
  };

  const openUnit = (unit: UnitRecord) => {
    const project = projects.find((item) => item.name === unit.project) || projects[0];
    setSelectedProject(project);
    setProjectTab("units");
    setProjectFilter(unit.project);
    setUnitDetail(unit);
    setUnitPreview(null);
    setUnitTab("overview");
    setPage("projects");
    setSearch("");
    setSearchFocused(false);
  };

  const openClient = (name: string) => {
    setSelectedClientName(name);
    setPage("clients");
    setUnitDetail(null);
    setUnitPreview(null);
    setSelectedProject(null);
  };

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

  const toggleTask = (id: number) => {
    setTaskRows((rows) => rows.map((task) => (task.id === id ? { ...task, done: !task.done } : task)));
    notify("Úkol byl aktualizován");
  };

  const saveTask = (title: string) => {
    const optimisticTask = {
      id: Date.now(),
      title,
      object: "A203 · Ručně vytvořený úkol",
      project: "Rezidence Javorová",
      due: "Zítra",
      priority: "Střední",
      owner: "Iva",
      done: false,
    };
    setTaskRows((rows) => [optimisticTask, ...rows]);
    setNewTaskOpen(false);
    notify(`Úkol „${title}“ byl vytvořen`);
    void fetch("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, objectType: "unit", objectId: "A203", priority: "medium", dueAt: "2026-07-22" }),
    }).catch(() => undefined);
  };

  return (
    <div className="crm-shell">
      <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
        <div className="brand">
          <span className="brand-mark"><Building2 size={20} /></span>
          <span>Develo<span>CRM</span></span>
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
                {item.id === "tasks" && <span className="nav-count">5</span>}
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
          <div className="sync-state"><CheckCircle2 size={15} /><span>SharePoint synchronizován</span></div>
          <button className="user-profile">
            <Avatar initials="IN" />
            <span><strong>Iva Novotná</strong><small>Obchodní administrativa</small></span>
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
              onChange={(event) => setSearch(event.target.value)}
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
            <Avatar initials="IN" small />
          </div>
        </header>

        <main className="main-content">
          {unitDetail ? (
            <UnitDetail unit={unitDetail} tab={unitTab} onTab={setUnitTab} onBack={() => setUnitDetail(null)} notify={notify} openTask={() => setNewTaskOpen(true)} openClient={openClient} />
          ) : selectedProject ? (
            <ProjectDetail
              project={selectedProject}
              tab={projectTab}
              onTab={setProjectTab}
              onBack={() => { setSelectedProject(null); setProjectFilter("Všechny projekty"); }}
              openClient={openClient}
              unitView={unitView}
              setUnitView={setUnitView}
              filteredUnits={filteredUnits}
              previewUnit={setUnitPreview}
              openUnit={openUnit}
              buildingFilter={buildingFilter}
              setBuildingFilter={setBuildingFilter}
              floorFilter={floorFilter}
              setFloorFilter={setFloorFilter}
              statusFilter={statusFilter}
              setStatusFilter={setStatusFilter}
              layoutFilter={layoutFilter}
              setLayoutFilter={setLayoutFilter}
              areaFrom={areaFrom}
              setAreaFrom={setAreaFrom}
              areaTo={areaTo}
              setAreaTo={setAreaTo}
              priceFrom={priceFrom}
              setPriceFrom={setPriceFrom}
              priceTo={priceTo}
              setPriceTo={setPriceTo}
              notify={notify}
            />
          ) : (
            <>
              <div className="page-header">
                <div>
                  <div className="eyebrow">ÚTERÝ 21. ČERVENCE 2026</div>
                  <h1>{pageTitles[page].title}</h1>
                  <p>{pageTitles[page].subtitle}</p>
                </div>
                <div className="page-actions">
                  {page === "projects" && <button className="secondary-button" onClick={() => notify("Ceník se připravuje ke stažení")}><Download size={17} /> Export ceníku</button>}
                  {page === "contracts" && <button className="secondary-button" onClick={() => notify("Otevírám správu šablon")}><FileCheck2 size={17} /> Šablony</button>}
                  <button className="primary-button" onClick={() => page === "tasks" ? setNewTaskOpen(true) : notify(page === "clients" ? "Formulář nového klienta je připraven" : "Nový záznam lze nyní založit")}>
                    <Plus size={18} /> {page === "tasks" ? "Nový úkol" : page === "clients" ? "Nový klient" : page === "contracts" ? "Nová smlouva" : page === "payments" ? "Přidat platbu" : page === "handovers" ? "Naplánovat předání" : page === "projects" ? "Nový projekt" : "Přidat úkol"}
                  </button>
                </div>
              </div>

              {page === "dashboard" && <Dashboard navigate={navigate} openUnit={openUnit} taskRows={taskRows} toggleTask={toggleTask} />}
              {page === "projects" && <Projects openProject={openProject} />}
              {page === "clients" && <ClientsPage openUnit={openUnit} selectedClientName={selectedClientName} setSelectedClientName={setSelectedClientName} notify={notify} />}
              {page === "contracts" && <ContractsPage openUnit={openUnit} notify={notify} />}
              {page === "payments" && <PaymentsPage openUnit={openUnit} notify={notify} />}
              {page === "handovers" && <HandoversPage openUnit={openUnit} notify={notify} />}
              {page === "tasks" && <TasksPage rows={taskRows} toggleTask={toggleTask} openUnit={openUnit} />}
            </>
          )}
        </main>
      </div>

      {unitPreview && <UnitPreview unit={unitPreview} close={() => setUnitPreview(null)} open={() => openUnit(unitPreview)} previous={() => browsePreview(-1)} next={() => browsePreview(1)} position={Math.max(1, filteredUnits.findIndex((item) => item.id === unitPreview.id) + 1)} total={filteredUnits.length} />}
      {unitPreview && <button className="panel-scrim" aria-label="Zavřít náhled" onClick={() => setUnitPreview(null)} />}
      {newTaskOpen && <TaskModal close={() => setNewTaskOpen(false)} save={saveTask} />}
      {toast && <div className="toast"><CheckCircle2 size={18} /> {toast}</div>}
    </div>
  );
}

function Dashboard({ navigate, openUnit, taskRows, toggleTask }: { navigate: (page: Page) => void; openUnit: (unit: UnitRecord) => void; taskRows: typeof initialTasks; toggleTask: (id: number) => void }) {
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
          {taskRows.slice(0, 4).map((task) => (
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
          <article className="project-card card" key={project.name}>
            <div className={`project-cover ${project.color}`}><span>{project.code}</span><Badge tone="neutral">{project.stage}</Badge></div>
            <div className="project-card-body">
              <div><h3>{project.name}</h3><p><MapPin size={14} /> {project.location}</p></div>
              <div className="project-unit-stats">
                <span><i className="available" /><strong>{project.available}</strong><small>volných</small></span>
                <span><i className="reserved" /><strong>{project.reserved}</strong><small>rezervovaných</small></span>
                <span><i className="sold" /><strong>{project.sold}</strong><small>prodaných</small></span>
                <span><strong>{project.units}</strong><small>celkem</small></span>
              </div>
              <div className="large-progress"><span><small>Prodejnost projektu</small><strong>{Math.round((project.sold + project.handedOver) / project.units * 100)} %</strong></span><div><i style={{ width: `${(project.sold + project.handedOver) / project.units * 100}%` }} /></div></div>
              <div className="project-card-meta"><span><small>VEDOUCÍ PROJEKTU</small><strong>{project.manager}</strong></span><span><small>PLÁNOVANÉ PŘEDÁNÍ</small><strong>{project.plannedHandover}</strong></span></div>
              <button className="secondary-button full" onClick={() => openProject(project)}>Otevřít detail projektu <ArrowRight size={16} /></button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
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
};

function ProjectDetail({ project, tab, onTab, onBack, notify, openClient, ...unitListProps }: UnitListProps & { tab: ProjectTab; onTab: (tab: ProjectTab) => void; onBack: () => void; notify: (message: string) => void; openClient: (name: string) => void }) {
  const projectClients = clients.filter((client) => client.projectNames.includes(project.name));
  const projectContracts = contracts.filter((contract) => contract.project === project.name);
  const projectPayments = payments.filter((payment) => payment.project === project.name);
  const projectHandovers = units.filter((unit) => unit.project === project.name && unit.handover !== "Neplánováno");
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
    { id: "documents", label: "Dokumenty", icon: FolderOpen, count: 18 },
  ];
  return (
    <div className="project-detail">
      <div className="unit-breadcrumb"><button onClick={onBack}><ArrowLeft size={16} /> Všechny projekty</button><ChevronRight size={14} /><strong>{project.name}</strong></div>
      <div className="project-detail-hero card">
        <div className={`project-detail-mark ${project.color}`}>{project.code}</div>
        <div><span className="eyebrow">AKTUÁLNÍ PROJEKT</span><h1>{project.name} <Badge tone="neutral">{project.stage}</Badge></h1><p><MapPin size={14} /> {project.location} · {project.buildings.join(" · ")}</p></div>
        <div className="project-detail-actions"><button className="secondary-button" onClick={() => notify("Ceník se připravuje ke stažení")}><Download size={16} /> Export ceníku</button><button className="primary-button" onClick={() => onTab("units")}><Home size={16} /> Otevřít jednotky</button></div>
      </div>
      <section className="card project-context-card" aria-label="Souhrn projektu">
        <div className="project-context-summary">
          <div><span className="project-summary-icon phase"><HardHat size={19} /></span><span><small>AKTUÁLNÍ FÁZE</small><strong>{project.stage}</strong></span></div>
          <div><span className="project-summary-icon manager"><UserRound size={19} /></span><span><small>VEDOUCÍ PROJEKTU</small><strong>{project.manager}</strong></span></div>
          <div><span className="project-summary-icon handover"><CalendarDays size={19} /></span><span><small>PLÁNOVANÉ PŘEDÁNÍ</small><strong>{project.plannedHandover}</strong></span></div>
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
      {tab === "contracts" && <ProjectContracts project={project} openUnit={unitListProps.openUnit} notify={notify} />}
      {tab === "payments" && <ProjectPayments project={project} openUnit={unitListProps.openUnit} />}
      {tab === "changes" && <ProjectClientChanges project={project} openUnit={unitListProps.openUnit} notify={notify} />}
      {tab === "handovers" && <ProjectHandovers project={project} openUnit={unitListProps.openUnit} notify={notify} />}
      {tab === "documents" && <ProjectDocuments project={project} notify={notify} />}
    </div>
  );
}

function ProjectOverview({ project, onTab }: { project: ProjectRecord; onTab: (tab: ProjectTab) => void }) {
  const projectTasks = initialTasks.filter((task) => task.project === project.name);
  const projectPayments = payments.filter((payment) => payment.project === project.name);
  const projectHandovers = units.filter((unit) => unit.project === project.name && unit.handover !== "Neplánováno");
  const projectUnitIds = units.filter((unit) => unit.project === project.name).map((unit) => unit.id);
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
            <button onClick={() => onTab("contracts")}><span className="attention-type blue"><FileText size={17} /></span><span><strong>Dokončit rozpracované smlouvy</strong><small>{contracts.filter((contract) => contract.project === project.name && contract.state !== "Podepsána").length} smlouvy čekají na další krok</small></span><Badge tone="blue">Smlouvy</Badge><ChevronRight size={16} /></button>
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
  const { project, unitView, setUnitView, filteredUnits, previewUnit, openUnit, buildingFilter, floorFilter, statusFilter, layoutFilter, areaFrom, areaTo, priceFrom, priceTo } = props;
  const [unitQuery, setUnitQuery] = useState("");
  const [clientQuery, setClientQuery] = useState("");
  const projectUnits = units.filter((unit) => unit.project === project.name);
  const buildings = Array.from(new Set(projectUnits.map((unit) => unit.building)));
  const floors = Array.from(new Set(projectUnits.map((unit) => unit.floor)));
  const visibleUnits = filteredUnits.filter((unit) => unit.id.toLowerCase().includes(unitQuery.toLowerCase()) && (unit.client || "").toLowerCase().includes(clientQuery.toLowerCase()));
  const activeCount = [unitQuery, buildingFilter.length, floorFilter.length, statusFilter.length, layoutFilter.length, areaFrom, areaTo, priceFrom, priceTo, clientQuery].filter(Boolean).length;
  const reset = () => { setUnitQuery(""); setClientQuery(""); props.setBuildingFilter([]); props.setFloorFilter([]); props.setStatusFilter([]); props.setLayoutFilter([]); props.setAreaFrom(""); props.setAreaTo(""); props.setPriceFrom(""); props.setPriceTo(""); };
  return (
    <section className="card units-section">
      <div className="project-scope-banner"><Building2 size={17} /><span><strong>{project.name}</strong><small>Zobrazeny jsou pouze jednotky tohoto projektu.</small></span></div>
      <div className="units-result-bar"><span><strong>{visibleUnits.length}</strong> jednotek odpovídá filtrům {activeCount > 0 && <Badge tone="blue">{activeCount} aktivních</Badge>}</span><div className="unit-result-actions">{activeCount > 0 && <button className="text-button" onClick={reset}>Vymazat filtry</button>}<div className="view-toggle"><button className={unitView === "table" ? "active" : ""} onClick={() => setUnitView("table")} aria-label="Tabulkové zobrazení"><Table2 size={17} /></button><button className={unitView === "cards" ? "active" : ""} onClick={() => setUnitView("cards")} aria-label="Kartové zobrazení"><List size={17} /></button></div></div></div>
      {unitView === "table" ? <div className="unit-table-wrap"><table className="data-table unit-table filter-table"><thead><tr><TableColumnFilter label="Jednotka" active={Boolean(unitQuery)}><input value={unitQuery} onChange={(event) => setUnitQuery(event.target.value)} placeholder="A203…" aria-label="Filtrovat jednotky" /></TableColumnFilter><TableColumnFilter label="Budova / etapa" active={buildingFilter.length > 0}><MultiSelectFilter options={buildings} selected={buildingFilter} onChange={props.setBuildingFilter} allLabel="Všechny budovy / etapy" ariaLabel="Filtrovat budovu nebo etapu" /></TableColumnFilter><TableColumnFilter label="Podlaží" active={floorFilter.length > 0}><MultiSelectFilter options={floors} selected={floorFilter} onChange={props.setFloorFilter} allLabel="Všechna podlaží" ariaLabel="Filtrovat podlaží" /></TableColumnFilter><TableColumnFilter label="Dispozice" active={layoutFilter.length > 0}><MultiSelectFilter options={["1+kk", "2+kk", "3+kk", "4+kk", "5+kk"]} selected={layoutFilter} onChange={props.setLayoutFilter} allLabel="Všechny dispozice" ariaLabel="Filtrovat dispozici" /></TableColumnFilter><TableColumnFilter label="Plocha m²" active={Boolean(areaFrom || areaTo)}><span className="column-range"><input inputMode="decimal" value={areaFrom} onChange={(event) => props.setAreaFrom(event.target.value)} placeholder="Od" aria-label="Plocha od" /><i>–</i><input inputMode="decimal" value={areaTo} onChange={(event) => props.setAreaTo(event.target.value)} placeholder="Do" aria-label="Plocha do" /></span></TableColumnFilter><TableColumnFilter label="Aktuální cena" active={Boolean(priceFrom || priceTo)}><span className="column-range"><input inputMode="decimal" value={priceFrom} onChange={(event) => props.setPriceFrom(event.target.value)} placeholder="Od mil." aria-label="Cena od" /><i>–</i><input inputMode="decimal" value={priceTo} onChange={(event) => props.setPriceTo(event.target.value)} placeholder="Do mil." aria-label="Cena do" /></span></TableColumnFilter><TableColumnFilter label="Obchodní stav" active={statusFilter.length > 0}><MultiSelectFilter options={["Volný", "Předrezervace", "RS", "SBK", "KS", "Předáno"]} selected={statusFilter} onChange={props.setStatusFilter} allLabel="Všechny stavy" ariaLabel="Filtrovat obchodní stav" /></TableColumnFilter><TableColumnFilter label="Klient" active={Boolean(clientQuery)}><input value={clientQuery} onChange={(event) => setClientQuery(event.target.value)} placeholder="Jméno…" aria-label="Filtrovat klienta" /></TableColumnFilter><th /></tr></thead><tbody>{visibleUnits.map((unit) => <tr key={unit.id} onClick={() => openUnit(unit)} tabIndex={0} onKeyDown={(event) => event.key === "Enter" && openUnit(unit)}><td><strong>{unit.id}</strong></td><td>{unit.building}</td><td>{unit.floor}</td><td>{unit.layout}</td><td>{unit.area.toLocaleString("cs-CZ")} m²</td><td><strong>{formatMoney(unit.price)}</strong></td><td><Badge>{unit.status}</Badge></td><td>{unit.client || <span className="muted">—</span>}</td><td><ChevronRight size={18} /></td></tr>)}</tbody></table></div> : <div className="unit-card-grid">{visibleUnits.map((unit) => <button className="unit-card" key={unit.id} onClick={() => previewUnit(unit)}><span className="unit-card-top"><strong>{unit.id}</strong><Badge>{unit.status}</Badge></span><span className="unit-card-plan"><span className="plan-room r1" /><span className="plan-room r2" /><span className="plan-room r3" /><Home size={22} /></span><span className="unit-card-info"><strong>{unit.layout} · {unit.area.toLocaleString("cs-CZ")} m²</strong><small>{unit.building} · {unit.floor}</small></span><span className="unit-card-price"><strong>{formatMoney(unit.price)}</strong><ChevronRight size={17} /></span></button>)}</div>}
      {!visibleUnits.length && <div className="empty-filter-state"><Search size={22} /><strong>Žádná jednotka neodpovídá kombinaci filtrů</strong><small>Zkuste upravit filtry přímo v hlavičce tabulky.</small><button className="secondary-button compact" onClick={reset}>Vymazat filtry</button></div>}
      <div className="table-footer"><span>Zobrazeno {visibleUnits.length} výsledků v projektu {project.name}</span><div><button disabled><ChevronRight className="rotate-180" size={16} /></button><button className="active">1</button><button><ChevronRight size={16} /></button></div></div>
    </section>
  );
}

function ProjectClients({ project, openClient, openUnit, notify }: { project: ProjectRecord; openClient: (name: string) => void; openUnit: (unit: UnitRecord) => void; notify: (message: string) => void }) {
  const rows = clients.filter((client) => client.projectNames.includes(project.name));
  return <ProjectModuleFrame project={project} title="Klienti projektu" description="Klienti a zájemci filtrovaní pouze pro tento projekt." action="Přidat klienta" onAction={() => notify("Formulář nového klienta je připraven")}><table className="data-table"><thead><tr><th>Klient</th><th>Typ</th><th>Jednotky v projektu</th><th>Stav vztahu</th><th>Smluvní stav</th><th>Telefon</th><th>E-mail</th><th /></tr></thead><tbody>{rows.map((client) => { const projectUnits = client.units.filter((code) => units.some((unit) => unit.id === code && unit.project === project.name)); return <tr key={client.id} onClick={() => openClient(client.name)}><td><span className="client-name-cell"><Avatar initials={client.initials} small /><strong>{client.name}</strong></span></td><td><Badge tone="neutral">{client.kind}</Badge></td><td>{projectUnits.map((code) => <button className="unit-link" key={code} onClick={(event) => { event.stopPropagation(); const unit = units.find((item) => item.id === code); if (unit) openUnit(unit); }}>{code}</button>)}</td><td><Badge>{client.state}</Badge></td><td>{client.contractStatus}</td><td>{client.phone}</td><td>{client.email}</td><td><ChevronRight size={17} /></td></tr>; })}</tbody></table></ProjectModuleFrame>;
}

function ProjectContracts({ project, openUnit, notify }: { project: ProjectRecord; openUnit: (unit: UnitRecord) => void; notify: (message: string) => void }) {
  const rows = contracts.filter((contract) => contract.project === project.name);
  return <ProjectModuleFrame project={project} title="Smlouvy projektu" description="Rezervační, budoucí kupní a kupní smlouvy v projektu." action="Nová smlouva" onAction={() => notify("Formulář nové smlouvy je připraven")}><table className="data-table"><thead><tr><th>Jednotka</th><th>Klient</th><th>Typ smlouvy</th><th>Stav</th><th>Aktualizováno</th><th>Odpovědná osoba</th><th>Další krok</th><th /></tr></thead><tbody>{rows.map((contract) => <tr key={`${contract.unit}-${contract.type}`} onClick={() => { const unit = units.find((item) => item.id === contract.unit); if (unit) openUnit(unit); }}><td><strong>{contract.unit}</strong></td><td>{contract.client}</td><td><Badge tone="blue">{contract.type}</Badge></td><td><Badge>{contract.state}</Badge></td><td>{contract.updated}</td><td>{contract.owner}</td><td>{contract.action}</td><td><ChevronRight size={17} /></td></tr>)}</tbody></table></ProjectModuleFrame>;
}

function ProjectPayments({ project, openUnit }: { project: ProjectRecord; openUnit: (unit: UnitRecord) => void }) {
  const rows = payments.filter((payment) => payment.project === project.name);
  const total = rows.reduce((sum, payment) => sum + payment.amount, 0);
  const paid = rows.reduce((sum, payment) => sum + payment.paid, 0);
  return <div className="project-module-stack"><div className="metric-row payments-metrics"><div className="metric-card"><span className="metric-icon green"><Banknote size={20} /></span><span><small>Uhrazeno</small><strong>{formatMoney(paid)}</strong><em>evidované platby projektu</em></span></div><div className="metric-card"><span className="metric-icon blue"><CircleDollarSign size={20} /></span><span><small>Předepsáno</small><strong>{formatMoney(total)}</strong><em>v aktuálním přehledu</em></span></div><div className="metric-card danger-metric"><span className="metric-icon red"><AlertTriangle size={20} /></span><span><small>Po splatnosti</small><strong>{rows.filter((payment) => payment.state === "Po splatnosti").length}</strong><em>vyžaduje pozornost</em></span></div></div><ProjectModuleFrame project={project} title="Platby projektu" description="Splátkový kalendář a skutečné úhrady jednotek."><table className="data-table"><thead><tr><th>Jednotka</th><th>Klient</th><th>Splátka</th><th>Splatnost</th><th>Předpis</th><th>Uhrazeno</th><th>Stav</th><th /></tr></thead><tbody>{rows.map((payment) => <tr key={`${payment.unit}-${payment.installment}`} onClick={() => { const unit = units.find((item) => item.id === payment.unit); if (unit) openUnit(unit); }}><td><strong>{payment.unit}</strong></td><td>{payment.client}</td><td>{payment.installment}</td><td>{payment.due}</td><td><strong>{formatMoney(payment.amount)}</strong></td><td>{formatMoney(payment.paid)}</td><td><Badge>{payment.state}</Badge></td><td><ChevronRight size={17} /></td></tr>)}</tbody></table></ProjectModuleFrame></div>;
}

function ProjectClientChanges({ project, openUnit, notify }: { project: ProjectRecord; openUnit: (unit: UnitRecord) => void; notify: (message: string) => void }) {
  const projectUnits = units.filter((unit) => unit.project === project.name && unit.client).slice(0, 4);
  const states = ["Ke schválení", "Schváleno", "V realizaci", "Uzavřeno"];
  return <ProjectModuleFrame project={project} title="Klientské změny" description="Požadavky klientů na standardy a provedení jednotek." action="Nový požadavek" onAction={() => notify("Formulář klientské změny je připraven")}><table className="data-table"><thead><tr><th>Jednotka</th><th>Klient</th><th>Požadavek</th><th>Termín rozhodnutí</th><th>Dopad do ceny</th><th>Stav</th><th /></tr></thead><tbody>{projectUnits.map((unit, index) => <tr key={unit.id} onClick={() => openUnit(unit)}><td><strong>{unit.id}</strong></td><td>{unit.client}</td><td>{["Změna podlahy v obytných místnostech", "Doplnění elektro vývodů", "Úprava dispozice koupelny", "Příprava pro venkovní žaluzie"][index]}</td><td>{24 + index}. 7. 2026</td><td>{index === 1 ? "18 500 Kč" : index === 3 ? "42 000 Kč" : "K nacenění"}</td><td><Badge>{states[index]}</Badge></td><td><ChevronRight size={17} /></td></tr>)}</tbody></table></ProjectModuleFrame>;
}

function ProjectHandovers({ project, openUnit, notify }: { project: ProjectRecord; openUnit: (unit: UnitRecord) => void; notify: (message: string) => void }) {
  const rows = units.filter((unit) => unit.project === project.name && unit.handover !== "Neplánováno");
  return <ProjectModuleFrame project={project} title="Předání projektu" description="Termíny a připravenost jednotek k předání." action="Naplánovat předání" onAction={() => notify("Kalendář předání je připraven")}><table className="data-table"><thead><tr><th>Jednotka</th><th>Klient</th><th>Budova</th><th>Stavební stav</th><th>Termín / stav předání</th><th>Připravenost</th><th /></tr></thead><tbody>{rows.map((unit, index) => <tr key={unit.id} onClick={() => openUnit(unit)}><td><strong>{unit.id}</strong></td><td>{unit.client || "—"}</td><td>{unit.building}</td><td><Badge tone="blue">{unit.construction}</Badge></td><td>{unit.handover}</td><td><span className="readiness"><span><strong>{index === 0 ? 72 : 88} %</strong></span><div><i style={{ width: `${index === 0 ? 72 : 88}%` }} /></div></span></td><td><ChevronRight size={17} /></td></tr>)}</tbody></table></ProjectModuleFrame>;
}

function ProjectDocuments({ project, notify }: { project: ProjectRecord; notify: (message: string) => void }) {
  return <ProjectModuleFrame project={project} title="Dokumenty projektu" description="Projektové podklady, standardy, technická dokumentace a prodejní materiály." action="Nahrát dokument" onAction={() => notify("Vyberte dokument k nahrání")}><div className="document-list">{["Standardy projektu.pdf", "Technický popis_rev04.pdf", "Situace projektu.pdf", "Prodejní půdorysy.zip", "Rozhodnutí stavebního úřadu.pdf"].map((name, index) => <article key={name}><span className="document-icon"><FileText size={21} /></span><span><strong>{name}</strong><small>{index < 3 ? "Technická dokumentace" : "Prodejní podklady"} · {project.name} · změněno {12 + index}. 7. 2026</small></span><Badge tone="neutral">v{index + 2}</Badge><button className="ghost-icon" onClick={() => notify(`Otevírám ${name}`)}><Eye size={17} /></button></article>)}</div></ProjectModuleFrame>;
}

function ProjectModuleFrame({ project, title, description, action, onAction, children }: { project: ProjectRecord; title: string; description: string; action?: string; onAction?: () => void; children: React.ReactNode }) {
  return <section className="card detail-tab-card project-module-card"><div className="project-scope-banner"><Building2 size={17} /><span><strong>{project.name}</strong><small>Pracujete uvnitř konkrétního projektu.</small></span></div><div className="tab-card-header"><div><h2>{title}</h2><p>{description}</p></div>{action && <button className="primary-button" onClick={onAction}><Plus size={16} /> {action}</button>}</div><div className="unit-table-wrap">{children}</div></section>;
}

function ClientsPage({ openUnit, selectedClientName, setSelectedClientName, notify }: { openUnit: (unit: UnitRecord) => void; selectedClientName: string | null; setSelectedClientName: (name: string | null) => void; notify: (message: string) => void }) {
  const [query, setQuery] = useState("");
  const [quickProject, setQuickProject] = useState("Všichni");
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [projectFilter, setProjectFilter] = useState<string[]>([]);
  const [unitFilter, setUnitFilter] = useState("");
  const [relationFilter, setRelationFilter] = useState<string[]>([]);
  const [contractFilter, setContractFilter] = useState<string[]>([]);
  const [phoneFilter, setPhoneFilter] = useState("");
  const [emailFilter, setEmailFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const selectedClient = selectedClientName ? clients.find((client) => client.name === selectedClientName) : undefined;
  const filtered = useMemo(() => clients.filter((client) => {
    const searchMatch = client.name.toLowerCase().includes(query.toLowerCase());
    const quickMatch = quickProject === "Všichni" || client.projectNames.includes(quickProject);
    const typeMatch = typeFilter.length === 0 || typeFilter.includes(client.kind);
    const projectMatch = projectFilter.length === 0 || projectFilter.some((project) => client.projectNames.includes(project));
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
  const copyEmails = async () => { const value = selectedRows.map((client) => client.email).join("; "); try { await navigator.clipboard.writeText(value); notify(`${selectedRows.length} e-mailů bylo zkopírováno pro BCC`); } catch { notify("E-mailové adresy jsou připravené ke kopírování"); } };
  const downloadCsv = (onlyEmails = false) => {
    const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const csv = onlyEmails ? ["E-mail", ...selectedRows.map((client) => escape(client.email))].join("\n") : ["Jméno / název,E-mail,Telefon,Projekt,Jednotka,Stav", ...selectedRows.map((client) => [client.name, client.email, client.phone, client.projects, client.units.join("; "), client.state].map(escape).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" })); const link = document.createElement("a"); link.href = url; link.download = onlyEmails ? "develocrm-emaily.csv" : "develocrm-klienti.csv"; link.click(); URL.revokeObjectURL(url); notify("Export byl stažen");
  };
  if (selectedClient) return <ClientDetail client={selectedClient} onBack={() => setSelectedClientName(null)} openUnit={openUnit} />;
  return (
    <section className="card module-card">
      <div className="client-quick-views"><div className="client-view-title"><span><Building2 size={17} /></span><span><small>RYCHLÝ POHLED</small><strong>Klienti podle projektu</strong></span></div><div className="client-view-options"><button className={quickProject === "Všichni" ? "active" : ""} onClick={() => setQuickProject("Všichni")}>Všichni <span>{clients.length}</span></button>{projects.slice(0, 2).map((project) => <button key={project.name} className={quickProject === project.name ? "active" : ""} onClick={() => setQuickProject(project.name)}>{project.name}</button>)}<label><select aria-label="Další projekty" value={projects.slice(2).some((project) => project.name === quickProject) ? quickProject : "Další projekty"} onChange={(event) => setQuickProject(event.target.value)}><option disabled>Další projekty</option>{projects.slice(2).map((project) => <option key={project.name}>{project.name}</option>)}</select><ChevronDown size={14} /></label></div></div>
      {selected.size > 0 && <div className="bulk-action-bar"><span><CheckCircle2 size={18} /><strong>Vybráno {selected.size} klientů</strong></span><div><button onClick={copyEmails}><Mail size={15} /> Kopírovat e-maily pro BCC</button><button onClick={() => downloadCsv(false)}><Download size={15} /> Excel / CSV</button><button onClick={() => downloadCsv(true)}><FileText size={15} /> Pouze e-maily</button><button className="ghost-icon" onClick={() => setSelected(new Set())} aria-label="Zrušit výběr"><X size={17} /></button></div></div>}
      {allPageSelected && filtered.length > pageRows.length && selected.size < filtered.length && <div className="select-all-results"><Check size={15} /> Vybráno všech {pageRows.length} klientů na této stránce. <button onClick={selectAllResults}>Vybrat všech {filtered.length} výsledků aktuálního filtru</button></div>}
      <div className="unit-table-wrap"><table className="data-table client-table filter-table"><thead><tr><th className="checkbox-cell"><button className={`table-checkbox ${allPageSelected ? "checked" : ""}`} onClick={togglePage} aria-label="Vybrat klienty na stránce">{allPageSelected && <Check size={13} />}</button></th><TableColumnFilter label="Jméno / název" active={Boolean(query)}><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Hledat jméno…" aria-label="Filtrovat jméno nebo název" /></TableColumnFilter><TableColumnFilter label="Typ" active={typeFilter.length > 0}><MultiSelectFilter options={["FO", "PO"]} selected={typeFilter} onChange={setTypeFilter} allLabel="Všechny typy" ariaLabel="Filtrovat typ klienta" /></TableColumnFilter><TableColumnFilter label="Projekt" active={projectFilter.length > 0}><MultiSelectFilter options={projects.map((project) => project.name)} selected={projectFilter} onChange={setProjectFilter} allLabel="Všechny projekty" ariaLabel="Filtrovat projekt" /></TableColumnFilter><TableColumnFilter label="Jednotka / jednotky" active={Boolean(unitFilter)}><input value={unitFilter} onChange={(event) => setUnitFilter(event.target.value)} placeholder="A203…" aria-label="Filtrovat jednotku" /></TableColumnFilter><TableColumnFilter label="Stav vztahu" active={relationFilter.length > 0}><MultiSelectFilter options={["Zájemce", "Aktivní klient", "Předání", "Předáno"]} selected={relationFilter} onChange={setRelationFilter} allLabel="Všechny vztahy" ariaLabel="Filtrovat stav vztahu" /></TableColumnFilter><TableColumnFilter label="Smluvní stav" active={contractFilter.length > 0}><MultiSelectFilter options={["Podepsaná KS", "Podepsaná SBK", "RS k podpisu", "Předrezervace", "Bez smlouvy"]} selected={contractFilter} onChange={setContractFilter} allLabel="Všechny smluvní stavy" ariaLabel="Filtrovat smluvní stav" /></TableColumnFilter><TableColumnFilter label="Telefon" active={Boolean(phoneFilter)}><input value={phoneFilter} onChange={(event) => setPhoneFilter(event.target.value)} placeholder="Telefon…" aria-label="Filtrovat telefon" /></TableColumnFilter><TableColumnFilter label="E-mail" active={Boolean(emailFilter)}><input value={emailFilter} onChange={(event) => setEmailFilter(event.target.value)} placeholder="E-mail…" aria-label="Filtrovat e-mail" /></TableColumnFilter><th /></tr></thead><tbody>{pageRows.map((client) => <tr key={client.id} onClick={() => setSelectedClientName(client.name)}><td className="checkbox-cell"><button className={`table-checkbox ${selected.has(client.id) ? "checked" : ""}`} onClick={(event) => { event.stopPropagation(); toggle(client.id); }} aria-label={`Vybrat ${client.name}`}>{selected.has(client.id) && <Check size={13} />}</button></td><td><span className="client-name-cell"><Avatar initials={client.initials} small /><span><strong>{client.name}</strong></span></span></td><td><Badge tone="neutral">{client.kind}</Badge></td><td><span className="multi-value">{client.projectNames.map((project) => <small key={project}>{project}</small>)}</span></td><td>{client.units.map((unit) => <button className="unit-link" key={unit} onClick={(event) => { event.stopPropagation(); openUnit(units.find((item) => item.id === unit) || units[0]); }}>{unit}</button>)}</td><td><Badge>{client.state}</Badge></td><td>{client.contractStatus}</td><td>{client.phone}</td><td><a href={`mailto:${client.email}`} onClick={(event) => event.stopPropagation()}>{client.email}</a></td><td><ChevronRight size={17} /></td></tr>)}</tbody></table></div>
      {!filtered.length && <div className="empty-filter-state"><Search size={22} /><strong>Žádný klient neodpovídá filtrům</strong><small>Změňte projekt, stav vztahu nebo hledaný výraz.</small></div>}
      <div className="table-footer"><span>Zobrazeno {pageRows.length} z {filtered.length} výsledků · jedna společná databáze napříč firmou</span><div><button disabled><ChevronRight className="rotate-180" size={16} /></button><button className="active">1</button><button><ChevronRight size={16} /></button></div></div>
    </section>
  );
}

function ClientDetail({ client, onBack, openUnit }: { client: (typeof clients)[number]; onBack: () => void; openUnit: (unit: UnitRecord) => void }) {
  return <div className="client-detail"><div className="unit-breadcrumb"><button onClick={onBack}><ArrowLeft size={16} /> Klienti a zájemci</button><ChevronRight size={14} /><strong>{client.name}</strong></div><div className="client-detail-hero card"><Avatar initials={client.initials} /><div><span className="eyebrow">{client.type.toUpperCase()}</span><h1>{client.name} <Badge>{client.state}</Badge></h1><p><Mail size={14} /> {client.email} <span>·</span> <UserRound size={14} /> {client.phone}</p></div><button className="primary-button"><MessageSquare size={16} /> Přidat aktivitu</button></div><div className="client-detail-grid"><section className="card client-relations"><SectionTitle title="Projekty a jednotky" /><p className="section-description">Všechny vztahy klienta napříč společnou firemní databází.</p>{client.units.map((unitCode, index) => { const unit = units.find((item) => item.id === unitCode) || units[0]; return <button key={unitCode} onClick={() => openUnit(unit)}><span className="unit-symbol"><Home size={18} /></span><span><strong>{unit.id} · {unit.layout}</strong><small>{unit.project} · {unit.building}</small></span><Badge>{index === 0 ? client.state : "Zájemce"}</Badge><ChevronRight size={17} /></button>; })}</section><aside className="card client-contact-panel"><SectionTitle title="Kontaktní údaje" /><dl><div><dt>E-mail</dt><dd>{client.email}</dd></div><div><dt>Telefon</dt><dd>{client.phone}</dd></div><div><dt>Typ osoby</dt><dd>{client.kind}</dd></div><div><dt>Smluvní stav</dt><dd>{client.contractStatus}</dd></div></dl></aside><section className="card client-history"><SectionTitle title="Historie zájmu" /><div className="unit-table-wrap"><table className="data-table"><thead><tr><th>Datum</th><th>Projekt / jednotka</th><th>Typ zájmu</th><th>Výsledek</th></tr></thead><tbody><tr><td>12. 3. 2026</td><td><strong>{client.projectNames[0]} · {client.units[0]}</strong></td><td>Předrezervace</td><td><Badge tone="success">Pokračuje</Badge></td></tr><tr><td>4. 2. 2026</td><td><strong>Rezidence Javorová · B207</strong></td><td>Prohlídka</td><td><Badge tone="neutral">Bez realizace</Badge></td></tr></tbody></table></div></section></div></div>;
}

function ContractsPage({ openUnit, notify }: { openUnit: (unit: UnitRecord) => void; notify: (message: string) => void }) {
  const stages = ["V přípravě", "Odeslána", "Ve vyjednávání", "Podepsána"];
  return (
    <div className="module-stack">
      <div className="metric-row">
        <div className="metric-card"><span className="metric-icon blue"><FileText size={20} /></span><span><small>V přípravě</small><strong>8</strong><em>3 čekají na data</em></span></div>
        <div className="metric-card"><span className="metric-icon sand"><Mail size={20} /></span><span><small>Odeslané</small><strong>12</strong><em>4 déle než 3 dny</em></span></div>
        <div className="metric-card"><span className="metric-icon purple"><MessageSquare size={20} /></span><span><small>Ve vyjednávání</small><strong>6</strong><em>2 změny dnes</em></span></div>
        <div className="metric-card"><span className="metric-icon green"><FileCheck2 size={20} /></span><span><small>Podepsané tento měsíc</small><strong>14</strong><em>+3 oproti červnu</em></span></div>
      </div>
      <section className="card module-card">
        <div className="module-toolbar"><div className="inline-search"><Search size={17} /><input placeholder="Hledat smlouvu, klienta…" /></div><button className="filter-button"><Filter size={16} /> Stav</button><button className="filter-button"><Building2 size={16} /> Projekt</button><span className="result-count">40 smluv</span></div>
        <div className="contract-list">
          {contracts.map((contract) => {
            const activeIndex = Math.max(0, stages.indexOf(contract.state));
            return (
              <article key={`${contract.unit}-${contract.type}`}>
                <button className="contract-main" onClick={() => openUnit(units.find((unit) => unit.id === contract.unit) || units[0])}>
                  <span className="contract-type">{contract.type}</span><span className="contract-copy"><strong>{contract.unit} · {contract.client}</strong><small>{contract.project} · změněno {contract.updated}</small></span><Badge>{contract.state}</Badge><span className="contract-action"><small>DOPORUČENÁ AKCE</small><strong>{contract.action}</strong></span><ChevronRight size={18} />
                </button>
                <div className="contract-flow">{stages.map((stage, index) => <span key={stage} className={index <= activeIndex ? "complete" : ""}><i>{index < activeIndex ? <Check size={11} /> : index + 1}</i>{stage}</span>)}</div>
              </article>
            );
          })}
        </div>
        <div className="table-footer"><span>Zobrazeno 5 z 40 smluv</span><button className="text-button" onClick={() => notify("Další smlouvy byly načteny")}>Načíst další <ChevronDown size={15} /></button></div>
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

function TasksPage({ rows, toggleTask, openUnit }: { rows: typeof initialTasks; toggleTask: (id: number) => void; openUnit: (unit: UnitRecord) => void }) {
  return (
    <section className="card module-card tasks-module">
      <nav className="task-tabs" aria-label="Pohledy úkolů"><button className="active" aria-current="page"><UserRound className="task-tab-icon" size={17} /> Moje úkoly <span>5</span></button><button><List className="task-tab-icon" size={17} /> Všechny</button><button><CheckCircle2 className="task-tab-icon" size={17} /> Dokončené</button><div /><button className="filter-button task-filter-action"><Filter size={16} /> Filtry</button></nav>
      <div className="task-section-label"><span>Dnes</span><i /></div>
      <div className="large-task-list">
        {rows.map((task) => <article key={task.id} className={task.done ? "done" : ""}>
          <button onClick={() => toggleTask(task.id)} className="task-check large" aria-label={`Dokončit úkol ${task.title}`}>{task.done && <Check size={15} />}</button>
          <span className={`priority-bar ${task.priority.toLowerCase().replace("á", "a").replace("ř", "r")}`} />
          <button className="task-main-copy" onClick={() => openUnit(units.find((unit) => unit.id === task.object.split(" · ")[0]) || units[0])}><strong>{task.title}</strong><small>{task.object} · {task.project}</small></button>
          <Badge tone={task.priority === "Vysoká" ? "danger" : task.priority === "Střední" ? "warning" : "neutral"}>{task.priority}</Badge>
          <span className={`task-due ${task.due === "Dnes" ? "urgent" : ""}`}><Clock3 size={15} />{task.due}</span>
          <Avatar initials={task.owner === "Iva" ? "IN" : "MJ"} small />
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

function UnitDetail({ unit, tab, onTab, onBack, notify, openTask, openClient }: { unit: UnitRecord; tab: UnitTab; onTab: (tab: UnitTab) => void; onBack: () => void; notify: (message: string) => void; openTask: () => void; openClient: (name: string) => void }) {
  const tabs: { id: UnitTab; label: string; icon: typeof Home; count?: number }[] = [
    { id: "overview", label: "Přehled", icon: LayoutDashboard }, { id: "contracts", label: "Smlouvy", icon: FileText, count: 4 }, { id: "payments", label: "Platby", icon: CircleDollarSign, count: 3 }, { id: "changes", label: "Klientské změny", icon: SlidersHorizontal, count: 3 }, { id: "documents", label: "Dokumenty", icon: FolderOpen, count: 12 }, { id: "handover", label: "Předání", icon: KeyRound }, { id: "tasks", label: "Úkoly", icon: ClipboardCheck, count: 2 }, { id: "history", label: "Historie", icon: History },
  ];
  return (
    <div className="unit-detail">
      <div className="unit-breadcrumb"><button onClick={onBack}><ArrowLeft size={16} /> Jednotky</button><ChevronRight size={14} /><span>{unit.project}</span><ChevronRight size={14} /><strong>{unit.id}</strong></div>
      <div className="unit-hero">
        <div className="unit-identity"><span className="unit-symbol"><Home size={23} /></span><div><span>{unit.project} · {unit.building}</span><h1>{unit.id} <Badge>{unit.status}</Badge></h1><p>{unit.layout} · {unit.area.toLocaleString("cs-CZ")} m² · {unit.floor} · orientace {unit.orientation}</p></div></div>
        <div className="unit-hero-actions"><button className="secondary-button" onClick={() => notify("Odkaz na jednotku byl zkopírován")}><Link2 size={17} /> Sdílet odkaz</button><button className="primary-button" onClick={() => notify("Kontrola dat: chybí číslo účtu klienta")}><FileText size={17} /> Vygenerovat SBK</button><button className="icon-button"><MoreHorizontal size={19} /></button></div>
      </div>
      <div className="unit-status-strip">
        <span><small>OBCHODNÍ STAV</small><strong><Badge>{unit.status}</Badge> Ve vyjednávání</strong></span>
        <span><small>STAV VÝSTAVBY</small><strong><HardHat size={16} /> {unit.construction}</strong></span>
        <span><small>PŘEDÁNÍ</small><strong><KeyRound size={16} /> {unit.handover}</strong></span>
        <span className="attention-status"><small>VYŽADUJE POZORNOST</small><strong><AlertTriangle size={16} /> {unit.attention || "Bez otevřených bodů"}</strong></span>
      </div>
      <nav className="unit-tabs unit-detail-tabs" aria-label="Navigace jednotky">{tabs.map((item) => { const TabIcon = item.icon; return <button key={item.id} className={tab === item.id ? "active" : ""} aria-current={tab === item.id ? "page" : undefined} onClick={() => onTab(item.id)}><TabIcon className="unit-tab-icon" size={17} />{item.label}{item.count && <span aria-label={`${item.count} položek`}>{item.count}</span>}</button>; })}</nav>

      {tab === "overview" && <UnitOverview unit={unit} notify={notify} openClient={openClient} />}
      {tab === "contracts" && <UnitContracts notify={notify} />}
      {tab === "payments" && <UnitPayments />}
      {tab === "changes" && <UnitClientChanges unit={unit} notify={notify} />}
      {tab === "documents" && <UnitDocuments notify={notify} />}
      {tab === "handover" && <UnitHandover notify={notify} />}
      {tab === "tasks" && <UnitTasks openTask={openTask} />}
      {tab === "history" && <UnitHistory />}
    </div>
  );
}

function UnitOverview({ unit, notify, openClient }: { unit: UnitRecord; notify: (message: string) => void; openClient: (name: string) => void }) {
  const [floorplanOpen, setFloorplanOpen] = useState(false);
  const [priceHistoryOpen, setPriceHistoryOpen] = useState(false);
  return (
    <>
    <div className="unit-overview-grid">
      <div className="unit-main-column">
        <section className="card sales-process-card">
          <SectionTitle title="Prodejní proces" />
          <div className="sales-progress">{["Zájem", "Předrezervace", "RS", "SBK", "KS", "Předání"].map((stage, index) => <div key={stage} className={index <= 3 ? "complete" : index === 4 ? "current" : ""}><span>{index <= 3 ? <Check size={14} /> : index + 1}</span><strong>{stage}</strong><small>{index === 3 ? "Ve vyjednávání" : index < 3 ? "Hotovo" : "Čeká"}</small></div>)}</div>
          <div className="next-action"><span className="next-action-icon"><Sparkles size={19} /></span><div><small>DOPORUČENÝ DALŠÍ KROK</small><strong>Doplňte číslo účtu a vygenerujte novou verzi SBK</strong><p>Kontrola našla 1 chybějící povinný údaj.</p></div><button className="primary-button" onClick={() => notify("Otevírám údaje klienta")}>Doplnit údaj <ArrowRight size={16} /></button></div>
        </section>
        <section className="card client-detail-card">
          <SectionTitle title="Klient" action="Otevřít kartu klienta" onAction={() => unit.client ? openClient(unit.client) : notify("Jednotka zatím nemá přiřazeného klienta")} />
          <div className="buyers"><div><Avatar initials="JN" /><span><strong>Jana Nováková</strong><small>Kupující · podíl 1/2</small><em><Mail size={14} /> jana.novakova@email.cz</em></span></div><div><Avatar initials="PN" /><span><strong>Petr Novák</strong><small>Kupující · podíl 1/2</small><em><Mail size={14} /> petr.novak@email.cz</em></span></div></div>
          <div className="client-note"><MessageSquare size={16} /><span><small>INTERNÍ POZNÁMKA</small><p>Preferují komunikaci e-mailem. Financování z vlastních zdrojů.</p></span></div>
        </section>
        <section className="card accessories-card">
          <SectionTitle title="Příslušenství" />
          <div className="accessory-list"><span><i className="accessory-icon"><Home size={17} /></i><span><strong>Sklep S18</strong><small>plocha 4,6 m² · 1. podzemní podlaží</small></span><Badge tone="success">Přiřazeno</Badge></span><span><i className="accessory-icon"><KeyRound size={17} /></i><span><strong>Parkovací stání P32</strong><small>podzemní garáž · sekce A</small></span><Badge tone="success">Přiřazeno</Badge></span><span><i className="accessory-icon"><Activity size={17} /></i><span><strong>Wallbox WB32</strong><small>vazba na parkovací stání P32</small></span><Badge tone="blue">Objednáno</Badge></span></div>
        </section>
        <section className="card price-card">
          <SectionTitle title="Cena" action="Otevřít historii cen" onAction={() => setPriceHistoryOpen(true)} />
          <div className="price-summary"><span><small>AKTUÁLNÍ CENA CELKEM</small><strong>{formatMoney(unit.price)}</strong><em>včetně DPH</em></span><button className="secondary-button compact" onClick={() => notify("Cenu lze nyní upravit")}><CreditCard size={16} /> Upravit cenu</button></div>
          <div className="price-breakdown"><span><i className="price-dot apartment" /><span><strong>Základní cena jednotky</strong><small>{unit.layout} · {unit.area.toLocaleString("cs-CZ")} m²</small></span><b>8 350 000 Kč</b></span><span><i className="price-dot storage" /><span><strong>Příslušenství</strong><small>sklep, parkovací stání a wallbox</small></span><b>640 000 Kč</b></span></div>
        </section>
        <section className="card interest-history-card">
          <SectionTitle title="Historie zájmu" />
          <p className="section-description">Záznam zůstává uložený i po ukončení zájmu nebo opětovném uvolnění jednotky.</p>
          <div className="unit-table-wrap"><table className="data-table"><thead><tr><th>Datum</th><th>Zájemce</th><th>Typ / stupeň zájmu</th><th>Výsledek</th></tr></thead><tbody><tr><td>12. 3. 2026</td><td><strong>Jana a Petr Novákovi</strong></td><td>Předrezervace → RS</td><td><Badge tone="success">Aktivní klienti</Badge></td></tr><tr><td>4. 2. 2026</td><td><strong>Lucie Hájková</strong></td><td>Prohlídka + nabídka</td><td><Badge tone="neutral">Zvolila jiný byt</Badge></td></tr><tr><td>22. 1. 2026</td><td><strong>NORD Invest a.s.</strong></td><td>Cenová poptávka</td><td><Badge tone="neutral">Bez realizace</Badge></td></tr><tr><td>15. 1. 2026</td><td><strong>Adam Doležal</strong></td><td>Webový zájem</td><td><Badge tone="neutral">Nekontaktní</Badge></td></tr></tbody></table></div>
        </section>
        <section className="card recent-card">
          <SectionTitle title="Poslední aktivita" action="Celá historie" onAction={() => notify("Otevřete záložku Historie")} />
          <div className="timeline-mini">{unitTimeline.slice(0, 4).map((item) => <div key={item.date}><span className={`timeline-icon ${item.icon}`}>{item.icon === "contract" ? <FileText size={16} /> : item.icon === "payment" ? <Banknote size={16} /> : item.icon === "build" ? <HardHat size={16} /> : <History size={16} />}</span><span><strong>{item.title}</strong><small>{item.detail}</small></span><time>{item.date}</time></div>)}</div>
        </section>
      </div>
      <aside className="unit-side-column">
        <section className="card floorplan-card"><div className="section-title"><h2>Půdorys</h2><button className="ghost-icon" onClick={() => setFloorplanOpen(true)} aria-label="Otevřít velký půdorys"><ExternalLink size={17} /></button></div><button className="floorplan-preview-button" onClick={() => setFloorplanOpen(true)} aria-label="Zvětšit půdorys"><div className="large-floorplan"><div className="room living"><span>OBÝVACÍ POKOJ + KK<small>32,1 m²</small></span></div><div className="room bed"><span>LOŽNICE<small>14,8 m²</small></span></div><div className="room bath"><span>KOUPELNA<small>5,4 m²</small></span></div><div className="room hall"><span>CHODBA<small>8,3 m²</small></span></div><div className="room bed2"><span>POKOJ<small>12,4 m²</small></span></div><div className="room wc"><span>WC</span></div><div className="balcony">LODŽIE · 8,2 m²</div></div><span className="enlarge-hint"><Eye size={15} /> Otevřít větší náhled</span></button><button className="secondary-button full" onClick={() => notify(`Stahuji půdorys ${unit.id}`)}><Download size={16} /> Stáhnout půdorys</button></section>
        <section className="card parameters-card"><SectionTitle title="Základní parametry" /><dl><div><dt>Dispozice</dt><dd>{unit.layout}</dd></div><div><dt>Podlahová plocha</dt><dd>{unit.area.toLocaleString("cs-CZ")} m²</dd></div><div><dt>Podlaží</dt><dd>{unit.floor}</dd></div><div><dt>Balkon / lodžie</dt><dd>8,2 m²</dd></div><div><dt>Orientace</dt><dd>{unit.orientation}</dd></div><div><dt>Standard</dt><dd>Premium</dd></div><div><dt>Vlastnictví</dt><dd>Osobní</dd></div></dl></section>
      </aside>
    </div>
    {floorplanOpen && <div className="modal-layer"><button className="modal-scrim" onClick={() => setFloorplanOpen(false)} aria-label="Zavřít půdorys" /><div className="modal floorplan-modal"><div className="modal-head"><div><h2>Půdorys jednotky {unit.id}</h2><p>{unit.layout} · {unit.area.toLocaleString("cs-CZ")} m² · {unit.floor}</p></div><button className="icon-button" onClick={() => setFloorplanOpen(false)}><X size={19} /></button></div><div className="modal-floorplan"><div className="large-floorplan"><div className="room living"><span>OBÝVACÍ POKOJ + KK<small>32,1 m²</small></span></div><div className="room bed"><span>LOŽNICE<small>14,8 m²</small></span></div><div className="room bath"><span>KOUPELNA<small>5,4 m²</small></span></div><div className="room hall"><span>CHODBA<small>8,3 m²</small></span></div><div className="room bed2"><span>POKOJ<small>12,4 m²</small></span></div><div className="room wc"><span>WC</span></div><div className="balcony">LODŽIE · 8,2 m²</div></div></div></div></div>}
    {priceHistoryOpen && <div className="modal-layer"><button className="modal-scrim" onClick={() => setPriceHistoryOpen(false)} aria-label="Zavřít historii cen" /><div className="modal price-history-modal"><div className="modal-head"><div><h2>Historie ceny · {unit.id}</h2><p>Každá změna je samostatný auditovatelný záznam.</p></div><button className="icon-button" onClick={() => setPriceHistoryOpen(false)}><X size={19} /></button></div><table className="data-table"><thead><tr><th>Platnost od</th><th>Cena</th><th>Změna</th><th>Důvod</th><th>Změnil</th></tr></thead><tbody><tr><td>1. 7. 2026</td><td><strong>{formatMoney(unit.price)}</strong></td><td><Badge tone="warning">+200 000 Kč</Badge></td><td>Aktualizace ceníku Q3</td><td>Pavel Sedlák</td></tr><tr><td>1. 4. 2026</td><td><strong>8 790 000 Kč</strong></td><td><Badge tone="neutral">+150 000 Kč</Badge></td><td>Klientská změna standardu</td><td>Iva Novotná</td></tr><tr><td>15. 1. 2026</td><td><strong>8 640 000 Kč</strong></td><td><Badge tone="neutral">Výchozí</Badge></td><td>První ceník</td><td>Pavel Sedlák</td></tr></tbody></table></div></div>}
    </>
  );
}

function UnitContracts({ notify }: { notify: (message: string) => void }) {
  const rows = [
    { type: "SBK", name: "Smlouva o budoucí kupní smlouvě", state: "Ve vyjednávání", version: "v04", date: "dnes 9:42", action: "Zapracovat připomínky" },
    { type: "RS", name: "Rezervační smlouva", state: "Podepsána", version: "v03", date: "18. 3. 2026", action: "Otevřít" },
    { type: "Dodatek", name: "Dodatek č. 1 k RS", state: "Podepsána", version: "v02", date: "2. 4. 2026", action: "Otevřít" },
  ];
  return <section className="card detail-tab-card"><div className="tab-card-header"><div><h2>Smlouvy jednotky A203</h2><p>Všechny smlouvy a jejich souborové verze na jednom místě.</p></div><button className="primary-button" onClick={() => notify("Vyberte typ nové smlouvy")}><Plus size={17} /> Nová smlouva</button></div><div className="document-list">{rows.map((row) => <article key={row.name}><span className="document-icon"><FileText size={21} /></span><span><strong>{row.name}</strong><small>{row.type} · verze {row.version} · {row.date}</small></span><Badge>{row.state}</Badge><button className="secondary-button compact" onClick={() => notify(`${row.name}: ${row.action}`)}>{row.action} <ChevronRight size={15} /></button></article>)}</div><div className="sharepoint-banner"><FolderOpen size={21} /><span><strong>Soubory jsou bezpečně uloženy na SharePointu</strong><small>CRM eviduje vazby, verze a obchodní stav dokumentů.</small></span><button className="text-button" onClick={() => notify("Otevírám složku jednotky na SharePointu")}>Otevřít složku <ExternalLink size={14} /></button></div></section>;
}

function UnitPayments() {
  const rows = [
    { name: "Rezervační poplatek", due: "20. 3. 2026", amount: 250000, paid: 250000, state: "Uhrazeno" },
    { name: "2. splátka · 25 %", due: "15. 7. 2026", amount: 2247500, paid: 2247500, state: "Uhrazeno" },
    { name: "3. splátka · 30 %", due: "31. 7. 2026", amount: 2697000, paid: 0, state: "Čeká na úhradu" },
  ];
  return <div className="detail-tab-stack"><div className="metric-row"><div className="metric-card wide"><span className="metric-icon green"><Banknote size={20} /></span><span><small>Uhrazeno</small><strong>2 497 500 Kč</strong><em>28 % kupní ceny</em></span></div><div className="metric-card wide"><span className="metric-icon sand"><Clock3 size={20} /></span><span><small>Nejbližší splátka</small><strong>2 697 000 Kč</strong><em>splatnost 31. 7. 2026</em></span></div><div className="metric-card wide"><span className="metric-icon blue"><CircleDollarSign size={20} /></span><span><small>Zbývá uhradit</small><strong>6 492 500 Kč</strong><em>72 % kupní ceny</em></span></div></div><section className="card detail-tab-card"><div className="tab-card-header"><div><h2>Splátkový kalendář</h2><p>Plánované a skutečné platby včetně částečných úhrad.</p></div><button className="secondary-button"><Plus size={16} /> Upravit kalendář</button></div><div className="unit-table-wrap"><table className="data-table"><thead><tr><th>Splátka</th><th>Splatnost</th><th>Předpis</th><th>Uhrazeno</th><th>Stav</th></tr></thead><tbody>{rows.map((row) => <tr key={row.name}><td><strong>{row.name}</strong></td><td>{row.due}</td><td><strong>{formatMoney(row.amount)}</strong></td><td>{formatMoney(row.paid)}</td><td><Badge>{row.state}</Badge></td></tr>)}</tbody></table></div></section></div>;
}

function UnitClientChanges({ unit, notify }: { unit: UnitRecord; notify: (message: string) => void }) {
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

function UnitDocuments({ notify }: { notify: (message: string) => void }) {
  const docs = [
    { name: "SBK_A203_v04.docx", category: "Smlouva · SBK", author: "Pavel Sedlák", date: "dnes 9:42", version: "v04" },
    { name: "Půdorys_A203_rev03.pdf", category: "Technická dokumentace", author: "SharePoint", date: "18. 7. 2026", version: "rev03" },
    { name: "Klientské změny_A203.xlsx", category: "Klientské změny", author: "Martin Jelínek", date: "11. 7. 2026", version: "v06" },
    { name: "RS_A203_podepsana.pdf", category: "Smlouva · RS", author: "Iva Novotná", date: "18. 3. 2026", version: "finální" },
  ];
  return <section className="card detail-tab-card"><div className="tab-card-header"><div><h2>Dokumenty</h2><p>Metadata a souborové verze synchronizované se SharePointem.</p></div><div><button className="secondary-button" onClick={() => notify("Otevírám SharePoint") }><ExternalLink size={16} /> SharePoint</button><button className="primary-button" onClick={() => notify("Vyberte soubor k nahrání") }><Upload size={16} /> Nahrát</button></div></div><div className="module-toolbar"><div className="inline-search"><Search size={17} /><input placeholder="Hledat dokument…" /></div><button className="filter-button"><Filter size={16} /> Typ dokumentu</button></div><div className="document-list">{docs.map((doc) => <article key={doc.name}><span className="document-icon"><FileText size={21} /></span><span><strong>{doc.name}</strong><small>{doc.category} · {doc.author} · {doc.date}</small></span><Badge tone="neutral">{doc.version}</Badge><button className="ghost-icon" onClick={() => notify(`Otevírám ${doc.name}`)}><Eye size={18} /></button><button className="ghost-icon"><MoreHorizontal size={18} /></button></article>)}</div><div className="unassigned-doc"><AlertTriangle size={19} /><span><strong>1 nezařazený dokument na SharePointu</strong><small>CRM našlo nový soubor ve složce jednotky bez vazby na obchodní objekt.</small></span><button className="secondary-button compact" onClick={() => notify("Dokument lze nyní přiřadit")}>Přiřadit dokument</button></div></section>;
}

function UnitHandover({ notify }: { notify: (message: string) => void }) {
  const checklist = ["Dokumentace jednotky", "Revize a certifikáty", "Odečty měřidel", "Sada klíčů a čipů", "Kontrola klientských změn", "Fotodokumentace"];
  return <div className="handover-detail-grid"><section className="card detail-tab-card"><div className="tab-card-header"><div><h2>Příprava předání</h2><p>Plánovaný termín: 30. 9. 2026 · 10:00</p></div><Badge tone="warning">Připravenost 72 %</Badge></div><div className="handover-big-progress"><span><strong>72 %</strong><small>4 z 6 oblastí připraveno</small></span><div><i style={{ width: "72%" }} /></div></div><div className="handover-checklist">{checklist.map((item, index) => <button key={item} onClick={() => notify(`${item}: stav byl aktualizován`)}><span className={index < 4 ? "checked" : ""}>{index < 4 && <Check size={14} />}</span><strong>{item}</strong><Badge tone={index < 4 ? "success" : "warning"}>{index < 4 ? "Hotovo" : "Doplnit"}</Badge><ChevronRight size={17} /></button>)}</div></section><aside className="card handover-side"><h3>Rychlé akce</h3><button><CreditCard size={18} /><span><strong>Zapsat odečty</strong><small>Elektřina, voda, teplo</small></span><ChevronRight size={16} /></button><button><KeyRound size={18} /><span><strong>Klíče a čipy</strong><small>Evidence předaných kusů</small></span><ChevronRight size={16} /></button><button><AlertTriangle size={18} /><span><strong>Nedodělky</strong><small>0 otevřených položek</small></span><ChevronRight size={16} /></button><button onClick={() => notify("Protokol je připraven ke generování")}><FileText size={18} /><span><strong>Vygenerovat protokol</strong><small>Word šablona · DOCX</small></span><ChevronRight size={16} /></button></aside></div>;
}

function UnitTasks({ openTask }: { openTask: () => void }) {
  return <section className="card detail-tab-card"><div className="tab-card-header"><div><h2>Úkoly jednotky</h2><p>Ruční i automatické úkoly navázané na A203.</p></div><button className="primary-button" onClick={openTask}><Plus size={17} /> Nový úkol</button></div><div className="large-task-list"><article><button className="task-check large" /><span className="priority-bar vysoka" /><span className="task-main-copy"><strong>Doplnit číslo účtu klienta</strong><small>Automaticky vytvořeno · blokuje generování SBK</small></span><Badge tone="danger">Vysoká</Badge><span className="task-due urgent"><Clock3 size={15} />Dnes</span><Avatar initials="IN" small /></article><article><button className="task-check large" /><span className="priority-bar stredni" /><span className="task-main-copy"><strong>Zapracovat připomínky klienta</strong><small>Smlouva SBK · verze v04</small></span><Badge tone="warning">Střední</Badge><span className="task-due"><Clock3 size={15} />Zítra</span><Avatar initials="PS" small /></article></div></section>;
}

function UnitHistory() {
  return <section className="card detail-tab-card history-tab"><div className="tab-card-header"><div><h2>Kompletní historie jednotky</h2><p>Auditní stopa obchodních, finančních a dokumentových změn.</p></div><button className="filter-button"><Filter size={16} /> Typ události</button></div><div className="full-timeline">{unitTimeline.map((item) => <article key={item.date}><div className={`timeline-icon ${item.icon}`}>{item.icon === "contract" ? <FileText size={17} /> : item.icon === "payment" ? <Banknote size={17} /> : item.icon === "build" ? <HardHat size={17} /> : <History size={17} />}</div><div><time>{item.date}</time><strong>{item.title}</strong><p>{item.detail}</p></div></article>)}</div></section>;
}

function TaskModal({ close, save }: { close: () => void; save: (title: string) => void }) {
  const [title, setTitle] = useState("");
  return <div className="modal-layer"><button className="modal-scrim" onClick={close} aria-label="Zavřít dialog" /><div className="modal"><div className="modal-head"><div><h2>Nový úkol</h2><p>Úkol se zobrazí v kontextu jednotky i v globálním přehledu.</p></div><button className="icon-button" onClick={close}><X size={19} /></button></div><div className="modal-form"><label><span>Název úkolu</span><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Co je potřeba udělat?" /></label><div className="form-row"><label><span>Vazba</span><select><option>Jednotka A203</option><option>Smlouva SBK</option><option>Klient Novákovi</option></select></label><label><span>Termín</span><input type="date" defaultValue="2026-07-22" /></label></div><div className="form-row"><label><span>Odpovědná osoba</span><select><option>Iva Novotná</option><option>Pavel Sedlák</option><option>Martin Jelínek</option></select></label><label><span>Priorita</span><select><option>Střední</option><option>Vysoká</option><option>Nízká</option></select></label></div><label><span>Poznámka</span><textarea placeholder="Volitelný kontext k úkolu" rows={3} /></label></div><div className="modal-foot"><button className="secondary-button" onClick={close}>Zrušit</button><button className="primary-button" disabled={!title.trim()} onClick={() => save(title.trim())}><Check size={17} /> Vytvořit úkol</button></div></div></div>;
}

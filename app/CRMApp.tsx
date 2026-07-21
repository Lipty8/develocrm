"use client";

import { useEffect, useMemo, useState } from "react";
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
  Handshake,
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
type UnitTab = "overview" | "contracts" | "payments" | "documents" | "handover" | "tasks" | "history";

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
  projects: { title: "Projekty a jednotky", subtitle: "Portfolio projektů, dostupnost a obchodní stav jednotek." },
  clients: { title: "Klienti a zájemci", subtitle: "Jedno místo pro kontakty, jednotky a historii zájmu." },
  contracts: { title: "Smlouvy", subtitle: "Rozpracované smlouvy napříč všemi projekty." },
  payments: { title: "Platby", subtitle: "Splátkový kalendář, úhrady a položky vyžadující pozornost." },
  handovers: { title: "Předání", subtitle: "Termíny, připravenost jednotek a otevřené nedodělky." },
  tasks: { title: "Úkoly", subtitle: "Moje práce a automaticky vytvořené úkoly v souvislostech." },
};

const statusClass = (value: string) => {
  if (["Uhrazeno", "Podepsána", "Předáno", "Dokončeno", "Hotovo"].includes(value)) return "success";
  if (["Po splatnosti", "Vyžaduje pozornost", "Vysoká"].includes(value)) return "danger";
  if (["Předrezervace", "Odeslána", "Čeká na úhradu", "Střední"].includes(value)) return "warning";
  if (["KS", "SBK", "Ve vyjednávání", "Ke kontrole", "Předání"].includes(value)) return "purple";
  if (["RS", "V přípravě", "Aktivní klient"].includes(value)) return "blue";
  return "neutral";
};

function Badge({ children, tone }: { children: React.ReactNode; tone?: string }) {
  return <span className={`badge ${tone || statusClass(String(children))}`}>{children}</span>;
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
  const [unitView, setUnitView] = useState<"table" | "cards">("table");
  const [statusFilter, setStatusFilter] = useState("Všechny stavy");
  const [layoutFilter, setLayoutFilter] = useState("Všechny dispozice");
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
      const matchesStatus = statusFilter === "Všechny stavy" || unit.status === statusFilter;
      const matchesLayout = layoutFilter === "Všechny dispozice" || unit.layout === layoutFilter;
      return matchesStatus && matchesLayout;
    });
  }, [statusFilter, layoutFilter]);

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
    setMobileNav(false);
  };

  const openUnit = (unit: UnitRecord) => {
    setUnitDetail(unit);
    setUnitPreview(null);
    setUnitTab("overview");
    setPage("projects");
    setSearch("");
    setSearchFocused(false);
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
          <button onClick={() => navigate("projects")}>
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
                  <button key={`${result.title}-${index}`} onClick={() => result.unit ? openUnit(result.unit) : navigate("clients")}>
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
            <UnitDetail unit={unitDetail} tab={unitTab} onTab={setUnitTab} onBack={() => setUnitDetail(null)} notify={notify} openTask={() => setNewTaskOpen(true)} />
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
                    <Plus size={18} /> {page === "tasks" ? "Nový úkol" : page === "clients" ? "Nový klient" : page === "contracts" ? "Nová smlouva" : page === "payments" ? "Přidat platbu" : page === "handovers" ? "Naplánovat předání" : page === "projects" ? "Nová jednotka" : "Přidat úkol"}
                  </button>
                </div>
              </div>

              {page === "dashboard" && <Dashboard navigate={navigate} openUnit={openUnit} taskRows={taskRows} toggleTask={toggleTask} />}
              {page === "projects" && <Projects unitView={unitView} setUnitView={setUnitView} filteredUnits={filteredUnits} statusFilter={statusFilter} setStatusFilter={setStatusFilter} layoutFilter={layoutFilter} setLayoutFilter={setLayoutFilter} previewUnit={setUnitPreview} />}
              {page === "clients" && <ClientsPage openUnit={openUnit} />}
              {page === "contracts" && <ContractsPage openUnit={openUnit} notify={notify} />}
              {page === "payments" && <PaymentsPage openUnit={openUnit} notify={notify} />}
              {page === "handovers" && <HandoversPage openUnit={openUnit} notify={notify} />}
              {page === "tasks" && <TasksPage rows={taskRows} toggleTask={toggleTask} openUnit={openUnit} />}
            </>
          )}
        </main>
      </div>

      {unitPreview && <UnitPreview unit={unitPreview} close={() => setUnitPreview(null)} open={() => openUnit(unitPreview)} />}
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

function Projects({ unitView, setUnitView, filteredUnits, statusFilter, setStatusFilter, layoutFilter, setLayoutFilter, previewUnit }: {
  unitView: "table" | "cards";
  setUnitView: (value: "table" | "cards") => void;
  filteredUnits: UnitRecord[];
  statusFilter: string;
  setStatusFilter: (value: string) => void;
  layoutFilter: string;
  setLayoutFilter: (value: string) => void;
  previewUnit: (unit: UnitRecord) => void;
}) {
  const [portfolio, setPortfolio] = useState<"portfolio" | "units">("units");
  return (
    <div className="projects-page">
      <div className="subnav-tabs"><button className={portfolio === "portfolio" ? "active" : ""} onClick={() => setPortfolio("portfolio")}>Přehled projektů</button><button className={portfolio === "units" ? "active" : ""} onClick={() => setPortfolio("units")}>Všechny jednotky <span>174</span></button></div>
      {portfolio === "portfolio" ? (
        <div className="project-cards">
          {projects.map((project) => (
            <article className="project-card card" key={project.name}>
              <div className={`project-cover ${project.color}`}><span>{project.name.split(" ").map((part) => part[0]).join("").slice(0, 2)}</span><Badge tone="neutral">{project.stage}</Badge></div>
              <div className="project-card-body">
                <div><h3>{project.name}</h3><p><MapPin size={14} /> {project.location}</p></div>
                <div className="project-stat-grid"><span><strong>{project.units}</strong><small>jednotek</small></span><span><strong>{project.sold}</strong><small>prodáno</small></span><span><strong>{project.units - project.sold}</strong><small>volných</small></span><span><strong>{project.revenue}</strong><small>objem prodeje</small></span></div>
                <div className="large-progress"><span><small>Prodej projektu</small><strong>{Math.round(project.sold / project.units * 100)} %</strong></span><div><i style={{ width: `${project.sold / project.units * 100}%` }} /></div></div>
                <button className="secondary-button full" onClick={() => setPortfolio("units")}>Otevřít projekt <ArrowRight size={16} /></button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <section className="card units-section">
          <div className="units-toolbar">
            <div className="filter-group">
              <label><span>Stav</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option>Všechny stavy</option><option>Volný</option><option>Předrezervace</option><option>RS</option><option>SBK</option><option>KS</option><option>Předáno</option></select><ChevronDown size={15} /></label>
              <label><span>Dispozice</span><select value={layoutFilter} onChange={(event) => setLayoutFilter(event.target.value)}><option>Všechny dispozice</option><option>1+kk</option><option>2+kk</option><option>3+kk</option><option>4+kk</option><option>5+kk</option></select><ChevronDown size={15} /></label>
              <button className="filter-button"><SlidersHorizontal size={16} /> Další filtry <span>2</span></button>
            </div>
            <div className="view-toggle"><button className={unitView === "table" ? "active" : ""} onClick={() => setUnitView("table")} aria-label="Tabulkové zobrazení"><Table2 size={17} /></button><button className={unitView === "cards" ? "active" : ""} onClick={() => setUnitView("cards")} aria-label="Kartové zobrazení"><List size={17} /></button></div>
          </div>
          <div className="active-filters"><span>174 jednotek</span><button>70–120 m² <X size={13} /></button><button>do 14 mil. Kč <X size={13} /></button><button className="clear-filter">Zrušit filtry</button></div>
          {unitView === "table" ? (
            <div className="unit-table-wrap">
              <table className="data-table unit-table">
                <thead><tr><th>Jednotka</th><th>Projekt / budova</th><th>Dispozice</th><th>Plocha</th><th>Cena</th><th>Obchodní stav</th><th>Klient</th><th /></tr></thead>
                <tbody>{filteredUnits.map((unit) => (
                  <tr key={unit.id} onClick={() => previewUnit(unit)} tabIndex={0} onKeyDown={(event) => event.key === "Enter" && previewUnit(unit)}>
                    <td><strong>{unit.id}</strong><small>{unit.floor}</small></td>
                    <td><strong>{unit.project}</strong><small>{unit.building}</small></td>
                    <td>{unit.layout}</td><td>{unit.area.toLocaleString("cs-CZ")} m²</td><td><strong>{formatMoney(unit.price)}</strong></td><td><Badge>{unit.status}</Badge></td><td>{unit.client || <span className="muted">—</span>}</td><td><ChevronRight size={18} /></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : (
            <div className="unit-card-grid">{filteredUnits.map((unit) => (
              <button className="unit-card" key={unit.id} onClick={() => previewUnit(unit)}>
                <span className="unit-card-top"><strong>{unit.id}</strong><Badge>{unit.status}</Badge></span>
                <span className="unit-card-plan"><span className="plan-room r1" /><span className="plan-room r2" /><span className="plan-room r3" /><Home size={22} /></span>
                <span className="unit-card-info"><strong>{unit.layout} · {unit.area.toLocaleString("cs-CZ")} m²</strong><small>{unit.project} · {unit.floor}</small></span>
                <span className="unit-card-price"><strong>{formatMoney(unit.price)}</strong><ChevronRight size={17} /></span>
              </button>
            ))}</div>
          )}
          <div className="table-footer"><span>Zobrazeno {filteredUnits.length} z 174 jednotek</span><div><button disabled><ChevronRight className="rotate-180" size={16} /></button><button className="active">1</button><button>2</button><button>3</button><span>…</span><button>18</button><button><ChevronRight size={16} /></button></div></div>
        </section>
      )}
    </div>
  );
}

function ClientsPage({ openUnit }: { openUnit: (unit: UnitRecord) => void }) {
  return (
    <section className="card module-card">
      <div className="module-toolbar"><div className="inline-search"><Search size={17} /><input placeholder="Hledat klienta…" /></div><button className="filter-button"><Filter size={16} /> Typ klienta</button><button className="filter-button"><Building2 size={16} /> Projekt</button><span className="result-count">126 kontaktů</span></div>
      <div className="client-grid">
        {clients.map((client) => (
          <article className="client-card" key={client.name}>
            <div className="client-card-head"><Avatar initials={client.initials} /><div><h3>{client.name}</h3><p>{client.type}</p></div><button className="ghost-icon"><MoreHorizontal size={18} /></button></div>
            <div className="client-contact"><span><Mail size={15} />{client.contact.split(" · ")[0]}</span><span><UserRound size={15} />{client.contact.split(" · ")[1]}</span></div>
            <div className="client-meta"><span><small>PROJEKT</small><strong>{client.projects}</strong></span><span><small>JEDNOTKY</small><strong>{client.units.join(", ")}</strong></span></div>
            <div className="client-card-foot"><Badge>{client.state}</Badge><button onClick={() => openUnit(units.find((unit) => unit.id === client.units[0]) || units[0])}>Otevřít kartu <ChevronRight size={15} /></button></div>
          </article>
        ))}
      </div>
    </section>
  );
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
  return (
    <div className="module-stack">
      <div className="metric-row payments-metrics">
        <div className="metric-card wide"><span className="metric-icon green"><Banknote size={20} /></span><span><small>Uhrazeno tento měsíc</small><strong>28,4 mil. Kč</strong><em>18 spárovaných plateb</em></span></div>
        <div className="metric-card wide"><span className="metric-icon sand"><Clock3 size={20} /></span><span><small>Splatné do 14 dní</small><strong>16,2 mil. Kč</strong><em>9 očekávaných plateb</em></span></div>
        <div className="metric-card wide danger-metric"><span className="metric-icon red"><AlertTriangle size={20} /></span><span><small>Po splatnosti</small><strong>1,7 mil. Kč</strong><em>3 jednotky</em></span></div>
      </div>
      <section className="card module-card">
        <div className="module-toolbar"><div className="inline-search"><Search size={17} /><input placeholder="Hledat platbu nebo jednotku…" /></div><button className="filter-button"><Filter size={16} /> Stav splatnosti</button><button className="secondary-button compact" onClick={() => notify("Bankovní výpis byl načten")}><Upload size={16} /> Import výpisu</button></div>
        <div className="unit-table-wrap"><table className="data-table payment-table"><thead><tr><th>Jednotka / klient</th><th>Splátka</th><th>Splatnost</th><th>Předpis</th><th>Uhrazeno</th><th>Stav</th><th /></tr></thead><tbody>
          {payments.map((payment) => {
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
      <div className="task-tabs"><button className="active">Moje úkoly <span>5</span></button><button>Všechny</button><button>Dokončené</button><div /><button className="filter-button"><Filter size={16} /> Filtry</button></div>
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

function UnitPreview({ unit, close, open }: { unit: UnitRecord; close: () => void; open: () => void }) {
  return (
    <aside className="preview-panel">
      <div className="preview-header"><div><span className="preview-project">{unit.project} · {unit.building}</span><h2>{unit.id} <Badge>{unit.status}</Badge></h2><p>{unit.layout} · {unit.area.toLocaleString("cs-CZ")} m² · {unit.floor}</p></div><button className="icon-button" onClick={close} aria-label="Zavřít náhled"><X size={20} /></button></div>
      {unit.attention && <div className="preview-attention"><AlertTriangle size={18} /><span><strong>Vyžaduje pozornost</strong><small>{unit.attention}</small></span></div>}
      <div className="mini-floorplan"><div className="room living"><span>Obývací pokoj + kk</span></div><div className="room bed"><span>Ložnice</span></div><div className="room bath"><span>Koupelna</span></div><div className="room hall"><span>Chodba</span></div><div className="room bed2"><span>Pokoj</span></div><div className="balcony">Lodžie 8,2 m²</div></div>
      <div className="preview-grid"><span><small>Aktuální cena</small><strong>{formatMoney(unit.price)}</strong></span><span><small>Stavební stav</small><strong>{unit.construction}</strong></span><span><small>Klient</small><strong>{unit.client || "Bez klienta"}</strong></span><span><small>Předání</small><strong>{unit.handover}</strong></span></div>
      <div className="preview-section"><h3>Příslušenství</h3><p>{unit.accessory}</p></div>
      <div className="preview-flow"><h3>Prodejní proces</h3><div>{["Zájem", "RS", "SBK", "KS", "Předání"].map((stage, index) => <span className={index <= ["Volný", "Předrezervace", "RS", "SBK", "KS", "Předáno"].indexOf(unit.status) - 1 ? "complete" : ""} key={stage}><i>{index + 1}</i><small>{stage}</small></span>)}</div></div>
      <div className="preview-footer"><button className="secondary-button" onClick={close}>Zavřít</button><button className="primary-button" onClick={open}>Otevřít detail <ArrowRight size={17} /></button></div>
    </aside>
  );
}

function UnitDetail({ unit, tab, onTab, onBack, notify, openTask }: { unit: UnitRecord; tab: UnitTab; onTab: (tab: UnitTab) => void; onBack: () => void; notify: (message: string) => void; openTask: () => void }) {
  const tabs: { id: UnitTab; label: string; count?: number }[] = [
    { id: "overview", label: "Přehled" }, { id: "contracts", label: "Smlouvy", count: 4 }, { id: "payments", label: "Platby", count: 3 }, { id: "documents", label: "Dokumenty", count: 12 }, { id: "handover", label: "Předání" }, { id: "tasks", label: "Úkoly", count: 2 }, { id: "history", label: "Historie" },
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
      <div className="unit-tabs">{tabs.map((item) => <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => onTab(item.id)}>{item.label}{item.count && <span>{item.count}</span>}</button>)}</div>

      {tab === "overview" && <UnitOverview unit={unit} notify={notify} />}
      {tab === "contracts" && <UnitContracts notify={notify} />}
      {tab === "payments" && <UnitPayments />}
      {tab === "documents" && <UnitDocuments notify={notify} />}
      {tab === "handover" && <UnitHandover notify={notify} />}
      {tab === "tasks" && <UnitTasks openTask={openTask} />}
      {tab === "history" && <UnitHistory />}
    </div>
  );
}

function UnitOverview({ unit, notify }: { unit: UnitRecord; notify: (message: string) => void }) {
  return (
    <div className="unit-overview-grid">
      <div className="unit-main-column">
        <section className="card sales-process-card">
          <SectionTitle title="Prodejní proces" />
          <div className="sales-progress">{["Zájem", "Předrezervace", "RS", "SBK", "KS", "Předání"].map((stage, index) => <div key={stage} className={index <= 3 ? "complete" : index === 4 ? "current" : ""}><span>{index <= 3 ? <Check size={14} /> : index + 1}</span><strong>{stage}</strong><small>{index === 3 ? "Ve vyjednávání" : index < 3 ? "Hotovo" : "Čeká"}</small></div>)}</div>
          <div className="next-action"><span className="next-action-icon"><Sparkles size={19} /></span><div><small>DOPORUČENÝ DALŠÍ KROK</small><strong>Doplňte číslo účtu a vygenerujte novou verzi SBK</strong><p>Kontrola našla 1 chybějící povinný údaj.</p></div><button className="primary-button" onClick={() => notify("Otevírám údaje klienta")}>Doplnit údaj <ArrowRight size={16} /></button></div>
        </section>
        <section className="card client-detail-card">
          <SectionTitle title="Klienti" action="Upravit" onAction={() => notify("Údaje klientů lze nyní upravit")} />
          <div className="buyers"><div><Avatar initials="JN" /><span><strong>Jana Nováková</strong><small>Kupující · podíl 1/2</small><em><Mail size={14} /> jana.novakova@email.cz</em></span></div><div><Avatar initials="PN" /><span><strong>Petr Novák</strong><small>Kupující · podíl 1/2</small><em><Mail size={14} /> petr.novak@email.cz</em></span></div></div>
          <div className="client-note"><MessageSquare size={16} /><span><small>INTERNÍ POZNÁMKA</small><p>Preferují komunikaci e-mailem. Financování z vlastních zdrojů.</p></span></div>
        </section>
        <section className="card price-card">
          <SectionTitle title="Cena a příslušenství" action="Historie ceny" onAction={() => notify("Zobrazuji historii ceny")} />
          <div className="price-summary"><span><small>AKTUÁLNÍ CENA CELKEM</small><strong>{formatMoney(unit.price)}</strong><em>včetně DPH</em></span><button className="secondary-button compact" onClick={() => notify("Cenu lze nyní upravit")}><CreditCard size={16} /> Upravit cenu</button></div>
          <div className="price-breakdown"><span><i className="price-dot apartment" /><span><strong>Byt {unit.id}</strong><small>{unit.layout} · {unit.area.toLocaleString("cs-CZ")} m²</small></span><b>8 350 000 Kč</b></span><span><i className="price-dot storage" /><span><strong>Sklep S18</strong><small>4,6 m²</small></span><b>190 000 Kč</b></span><span><i className="price-dot parking" /><span><strong>Parkovací stání P32</strong><small>podzemní · s wallboxem</small></span><b>450 000 Kč</b></span></div>
        </section>
        <section className="card recent-card">
          <SectionTitle title="Poslední aktivita" action="Celá historie" onAction={() => notify("Otevřete záložku Historie")} />
          <div className="timeline-mini">{unitTimeline.slice(0, 4).map((item) => <div key={item.date}><span className={`timeline-icon ${item.icon}`}>{item.icon === "contract" ? <FileText size={16} /> : item.icon === "payment" ? <Banknote size={16} /> : item.icon === "build" ? <HardHat size={16} /> : <History size={16} />}</span><span><strong>{item.title}</strong><small>{item.detail}</small></span><time>{item.date}</time></div>)}</div>
        </section>
      </div>
      <aside className="unit-side-column">
        <section className="card floorplan-card"><div className="section-title"><h2>Půdorys</h2><button className="ghost-icon" onClick={() => notify("Půdorys byl otevřen") }><ExternalLink size={17} /></button></div><div className="large-floorplan"><div className="room living"><span>OBÝVACÍ POKOJ + KK<small>32,1 m²</small></span></div><div className="room bed"><span>LOŽNICE<small>14,8 m²</small></span></div><div className="room bath"><span>KOUPELNA<small>5,4 m²</small></span></div><div className="room hall"><span>CHODBA<small>8,3 m²</small></span></div><div className="room bed2"><span>POKOJ<small>12,4 m²</small></span></div><div className="room wc"><span>WC</span></div><div className="balcony">LODŽIE · 8,2 m²</div></div><button className="secondary-button full" onClick={() => notify("Stahuji půdorys A203") }><Download size={16} /> Stáhnout půdorys</button></section>
        <section className="card parameters-card"><SectionTitle title="Parametry" /><dl><div><dt>Dispozice</dt><dd>{unit.layout}</dd></div><div><dt>Podlahová plocha</dt><dd>{unit.area.toLocaleString("cs-CZ")} m²</dd></div><div><dt>Podlaží</dt><dd>{unit.floor}</dd></div><div><dt>Orientace</dt><dd>{unit.orientation}</dd></div><div><dt>Standard</dt><dd>Premium</dd></div><div><dt>Vlastnictví</dt><dd>Osobní</dd></div></dl></section>
        <section className="card interest-card"><SectionTitle title="Historie zájmu" /><div className="interest-list"><span><i /><strong>Novákovi</strong><small>Aktivní klienti · od 12. 3. 2026</small></span><span><i /><strong>Lucie Hájková</strong><small>Ukončeno · 4.–18. 2. 2026</small></span><span><i /><strong>3 další zájemci</strong><small>Poptávky z webového formuláře</small></span></div></section>
      </aside>
    </div>
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

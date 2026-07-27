export const projectTabSlugs = ["overview", "units", "clients", "contracts", "payments", "changes", "handovers", "documents"];
export const unitTabSlugs = ["overview", "contracts", "payments", "changes", "documents", "handover", "tasks", "history"];

const pagePaths = {
  dashboard: "/dashboard",
  projects: "/projects",
  clients: "/clients",
  contracts: "/contracts",
  documents: "/documents",
  payments: "/payments",
  handovers: "/handovers",
  tasks: "/tasks",
  admin: "/admin/users",
};

const decode = (value) => {
  try { return decodeURIComponent(value); } catch { return value; }
};

export function pageRoute(page) {
  return pagePaths[page] ?? pagePaths.dashboard;
}

export function projectRoute(projectId, tab = "overview", search = "") {
  const suffix = tab === "overview" ? "" : `/${projectTabSlugs.includes(tab) ? tab : "overview"}`;
  return `/projects/${encodeURIComponent(projectId)}${suffix}${withSearch(search)}`;
}

export function unitRoute(unitId, tab = "overview") {
  const query = tab === "overview" ? "" : `?tab=${encodeURIComponent(unitTabSlugs.includes(tab) ? tab : "overview")}`;
  return `/units/${encodeURIComponent(unitId)}${query}`;
}

export function clientRoute(clientId) {
  return `/clients/${encodeURIComponent(clientId)}`;
}

export function contractRoute(contractId) {
  return `/contracts/${encodeURIComponent(contractId)}`;
}

export function documentRoute(documentId) {
  return `/contracts/documents/${encodeURIComponent(documentId)}`;
}

export function parseCrmRoute(pathname, search = "") {
  const parts = pathname.split("/").filter(Boolean).map(decode);
  const params = new URLSearchParams(typeof search === "string" ? search.replace(/^\?/, "") : search);
  if (!parts.length || parts[0] === "dashboard") return { page: "dashboard", kind: "page", params };
  if (parts[0] === "projects" && parts[1]) return { page: "projects", kind: "project", projectId: parts[1], projectTab: projectTabSlugs.includes(parts[2]) ? parts[2] : "overview", params };
  if (parts[0] === "projects") return { page: "projects", kind: "page", params };
  if (parts[0] === "units" && parts[1]) return { page: "projects", kind: "unit", unitId: parts[1], unitTab: unitTabSlugs.includes(params.get("tab")) ? params.get("tab") : "overview", params };
  if (parts[0] === "clients" && parts[1]) return { page: "clients", kind: "client", clientId: parts[1], params };
  if (parts[0] === "clients") return { page: "clients", kind: "page", params };
  if (parts[0] === "contracts" && parts[1] === "documents" && parts[2]) return { page: "contracts", kind: "document", documentId: parts[2], params };
  if (parts[0] === "contracts" && parts[1]) return { page: "contracts", kind: "contract", contractId: parts[1], params };
  if (parts[0] === "contracts") return { page: "contracts", kind: "page", params };
  if (parts[0] === "documents" && parts[1]) return { page: "contracts", kind: "legacy-document", documentId: parts[1], params };
  if (parts[0] === "documents") return { page: "contracts", kind: "legacy-documents", params };
  if (parts[0] === "tasks") return { page: "tasks", kind: "page", taskScope: ["mine", "all", "completed"].includes(params.get("scope")) ? params.get("scope") : "mine", params };
  if (parts[0] === "payments") return { page: "payments", kind: "page", params };
  if (parts[0] === "handovers") return { page: "handovers", kind: "page", params };
  if (parts[0] === "admin" && parts[1] === "users") return { page: "admin", kind: "admin-users", params };
  return { page: "dashboard", kind: "not-found", params };
}

export function updateSearch(pathname, currentSearch, patch) {
  const params = new URLSearchParams(typeof currentSearch === "string" ? currentSearch.replace(/^\?/, "") : currentSearch);
  for (const [key, value] of Object.entries(patch)) {
    const normalized = Array.isArray(value) ? value.filter(Boolean).join("~") : value == null ? "" : String(value);
    if (normalized) params.set(key, normalized); else params.delete(key);
  }
  return `${pathname}${withSearch(params.toString())}`;
}

export function listParam(params, key) {
  return (params.get(key) ?? "").split("~").filter(Boolean);
}

function withSearch(search) {
  const normalized = String(search ?? "").replace(/^\?/, "");
  return normalized ? `?${normalized}` : "";
}

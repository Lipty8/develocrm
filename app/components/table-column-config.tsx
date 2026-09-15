"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Columns3, RotateCcw, X } from "lucide-react";
import {
  defaultVisibleColumns,
  normalizeVisibleColumns,
  tableColumnStorageKey,
  toggleVisibleColumn,
} from "../lib/table-column-preferences.mjs";

export type TableColumnDefinition = {
  id: string;
  label: string;
  defaultVisible?: boolean;
  required?: boolean;
  align?: "center" | "action";
  sortable?: boolean;
  filterable?: boolean;
  filterType?: "text" | "enum" | "number-range" | "date-range" | "relation" | "boolean";
  accessor?: string;
  formatter?: "text" | "number" | "money" | "date" | "date-time" | "status" | "relation";
};

export function tableColumnClassName(columns: readonly TableColumnDefinition[], id: string, extra = "") {
  const alignment = columns.find((column) => column.id === id)?.align ?? "center";
  return [`table-column-${alignment}`, extra].filter(Boolean).join(" ");
}

type TableColumnState = {
  visibleIds: string[];
  isVisible: (id: string) => boolean;
  toggle: (id: string) => void;
  reset: () => void;
};

const TableColumnUserContext = createContext("anonymous");

export function useTablePreferenceUserKey() {
  return useContext(TableColumnUserContext);
}

export function TableColumnPreferenceProvider({ userKey, children }: { userKey?: string | null; children: React.ReactNode }) {
  return <TableColumnUserContext.Provider value={userKey || "anonymous"}>{children}</TableColumnUserContext.Provider>;
}

export function useTableColumns(tableId: string, columns: readonly TableColumnDefinition[]): TableColumnState {
  const userKey = useContext(TableColumnUserContext);
  const defaults = useMemo(() => defaultVisibleColumns(columns), [columns]);
  const [visibleIds, setVisibleIds] = useState<string[]>(defaults);
  const hydratedKeyRef = useRef<string | null>(null);
  const storageKey = tableColumnStorageKey(userKey, tableId);

  useEffect(() => {
    let active = true;
    hydratedKeyRef.current = null;
    queueMicrotask(() => {
      if (!active) return;
      try {
        const raw = window.localStorage.getItem(storageKey);
        const saved = raw ? JSON.parse(raw) : null;
        setVisibleIds(normalizeVisibleColumns(columns, saved?.visibleIds));
      } catch {
        setVisibleIds(defaults);
      }
      hydratedKeyRef.current = storageKey;
    });
    return () => { active = false; };
  }, [columns, defaults, storageKey]);

  useEffect(() => {
    if (hydratedKeyRef.current !== storageKey) return;
    window.localStorage.setItem(storageKey, JSON.stringify({ version: 1, visibleIds }));
  }, [storageKey, visibleIds]);

  return {
    visibleIds,
    isVisible: (id) => visibleIds.includes(id),
    toggle: (id) => setVisibleIds((current) => toggleVisibleColumn(columns, current, id)),
    reset: () => {
      window.localStorage.removeItem(storageKey);
      setVisibleIds(defaults);
    },
  };
}

export function TableColumnMenu({ columns, state }: { columns: readonly TableColumnDefinition[]; state: TableColumnState }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<React.CSSProperties>({});

  const placePopover = useCallback(() => {
    const trigger = rootRef.current?.getBoundingClientRect();
    if (!trigger) return;
    const mobile = window.innerWidth <= 720;
    if (mobile) {
      setPosition({ left: 16, right: 16, bottom: 16, top: "auto", width: "auto" });
      return;
    }
    const width = Math.min(320, window.innerWidth - 32);
    const estimatedHeight = Math.min(520, Math.floor(window.innerHeight * .7), columns.length * 42 + 92);
    const top = trigger.bottom + estimatedHeight + 16 > window.innerHeight
      ? Math.max(16, trigger.top - estimatedHeight - 8)
      : trigger.bottom + 8;
    setPosition({
      position: "fixed",
      width,
      left: Math.max(16, Math.min(trigger.right - width, window.innerWidth - width - 16)),
      top,
      right: "auto",
    });
  }, [columns.length]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !popoverRef.current?.contains(target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    const reposition = () => placePopover();
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, placePopover]);

  return <div className="table-column-config" ref={rootRef}>
    <button className={`secondary-button compact table-column-trigger ${open ? "active" : ""}`} type="button" onClick={() => { if(!open)placePopover();setOpen((value) => !value); }} aria-expanded={open} aria-haspopup="dialog"><Columns3 size={16}/> Sloupce</button>
    {open && createPortal(<div ref={popoverRef} className="table-column-popover table-column-popover-portal" style={position} role="dialog" aria-label="Nastavení viditelných sloupců">
      <div className="table-column-popover-head"><strong>Sloupce</strong><button className="ghost-icon" type="button" onClick={() => setOpen(false)} aria-label="Zavřít nastavení sloupců"><X size={16}/></button></div>
      <div className="table-column-options">{columns.map((column) => <label key={column.id} className={column.required ? "required" : ""}><input type="checkbox" checked={state.isVisible(column.id)} disabled={column.required} onChange={() => state.toggle(column.id)}/><span>{column.label}</span>{column.required && <small>povinný</small>}</label>)}</div>
      <button className="table-column-reset" type="button" onClick={state.reset}><RotateCcw size={14}/> Obnovit výchozí sloupce</button>
    </div>, document.body)}
  </div>;
}

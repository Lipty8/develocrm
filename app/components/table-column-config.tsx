"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
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
};

type TableColumnState = {
  visibleIds: string[];
  isVisible: (id: string) => boolean;
  toggle: (id: string) => void;
  reset: () => void;
};

const TableColumnUserContext = createContext("anonymous");

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

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return <div className="table-column-config" ref={rootRef}>
    <button className={`secondary-button compact table-column-trigger ${open ? "active" : ""}`} type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-haspopup="dialog"><Columns3 size={16}/> Sloupce</button>
    {open && <div className="table-column-popover" role="dialog" aria-label="Nastavení viditelných sloupců">
      <div className="table-column-popover-head"><strong>Sloupce</strong><button className="ghost-icon" type="button" onClick={() => setOpen(false)} aria-label="Zavřít nastavení sloupců"><X size={16}/></button></div>
      <div className="table-column-options">{columns.map((column) => <label key={column.id} className={column.required ? "required" : ""}><input type="checkbox" checked={state.isVisible(column.id)} disabled={column.required} onChange={() => state.toggle(column.id)}/><span>{column.label}</span>{column.required && <small>povinný</small>}</label>)}</div>
      <button className="table-column-reset" type="button" onClick={state.reset}><RotateCcw size={14}/> Obnovit výchozí sloupce</button>
    </div>}
  </div>;
}

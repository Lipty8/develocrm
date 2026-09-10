"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { nextSortDirection, type SortDirection } from "../lib/sorting";

type ColumnFilterProps = {
  label: string;
  active?: boolean;
  className?: string;
  children?: React.ReactNode;
  sortDirection?: SortDirection;
  sortType?: "text" | "number" | "date";
  onSort?: (direction: SortDirection) => void;
};

function useOutsideClose<T extends HTMLElement>(close: () => void) {
  const root = useRef<T>(null);
  useEffect(() => {
    const listener = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) close(); };
    document.addEventListener("mousedown", listener);
    return () => document.removeEventListener("mousedown", listener);
  }, [close]);
  return root;
}

function ColumnFilterContent({ label, active = false, children, sortDirection, sortType = "text", onSort, open, setOpen }: ColumnFilterProps & { open: boolean; setOpen: React.Dispatch<React.SetStateAction<boolean>> }) {
  const sorted = sortDirection === "asc" || sortDirection === "desc";
  const sortLabels = sortType === "number" ? ["Od nejnižšího", "Od nejvyššího"] : sortType === "date" ? ["Od nejstaršího", "Od nejnovějšího"] : ["A → Z", "Z → A"];
  return <>
    <span className="column-filter-heading-row">
      <button type="button" className="column-filter-heading" onClick={() => onSort ? onSort(nextSortDirection(sortDirection)) : setOpen(value => !value)} aria-label={onSort ? `Seřadit sloupec ${label}` : `Filtrovat sloupec ${label}`}>
        <span>{label}</span>{sorted && <b aria-label={sortDirection === "asc" ? "Vzestupně" : "Sestupně"}>{sortDirection === "asc" ? "↑" : "↓"}</b>}{active && <i />}
      </button>
      {children && <button type="button" className="column-filter-menu-trigger" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-label={`Filtrovat sloupec ${label}`}><ChevronDown size={12} /></button>}
    </span>
    {open && <span className="column-filter-control">
      {onSort && <span className="column-sort-actions">
        <button type="button" className={sortDirection === "asc" ? "active" : ""} onClick={() => { onSort("asc"); setOpen(false); }}>{sortLabels[0]}</button>
        <button type="button" className={sortDirection === "desc" ? "active" : ""} onClick={() => { onSort("desc"); setOpen(false); }}>{sortLabels[1]}</button>
        <button type="button" className={sortDirection === "none" ? "active" : ""} onClick={() => { onSort("none"); setOpen(false); }}>Bez řazení</button>
      </span>}
      {children && <span className="column-filter-options">{children}</span>}
    </span>}
  </>;
}

export function TableColumnFilter(props: ColumnFilterProps) {
  const [open, setOpen] = useState(false);
  const root = useOutsideClose<HTMLTableCellElement>(() => setOpen(false));
  const interactive = Boolean(props.children || props.onSort);
  const sorted = props.sortDirection === "asc" || props.sortDirection === "desc";
  return <th ref={root} className={`column-filter ${props.active ? "active" : ""} ${sorted ? "sorted" : ""} ${open ? "open" : ""} ${props.className ?? ""}`.trim()}>
    {interactive ? <ColumnFilterContent {...props} open={open} setOpen={setOpen} /> : <span className="column-filter-heading plain"><span>{props.label}</span></span>}
  </th>;
}

export function ListColumnFilter(props: ColumnFilterProps) {
  const [open, setOpen] = useState(false);
  const root = useOutsideClose<HTMLSpanElement>(() => setOpen(false));
  const interactive = Boolean(props.children || props.onSort);
  const sorted = props.sortDirection === "asc" || props.sortDirection === "desc";
  return <span ref={root} role="columnheader" className={`list-column-filter column-filter ${props.active ? "active" : ""} ${sorted ? "sorted" : ""} ${open ? "open" : ""} ${props.className ?? ""}`.trim()}>
    {interactive ? <ColumnFilterContent {...props} open={open} setOpen={setOpen} /> : <span className="column-filter-heading plain"><span>{props.label}</span></span>}
  </span>;
}

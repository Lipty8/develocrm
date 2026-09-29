import type { CSSProperties } from "react";
import type { LucideIcon } from "lucide-react";

export type SummaryStatTone = "neutral" | "success" | "info" | "warning";

export type SummaryStatItem = {
  id: string;
  label: string;
  value: number;
  icon: LucideIcon;
  tone?: SummaryStatTone;
};

export function toggledSummaryFilter(current: readonly string[], selected: string): string[] {
  return current.length === 1 && current[0] === selected ? [] : [selected];
}

export function SummaryStats({ items, selectedId, onSelect, label }: { items: readonly SummaryStatItem[]; selectedId?: string; onSelect?: (id: string) => void; label: string }) {
  const sizing = { "--summary-stat-count": items.length } as CSSProperties;
  return <div className={`summary-stats summary-stats-${items.length}`} aria-label={label} style={sizing}>
    {items.map((item) => {
      const Icon = item.icon;
      const active = selectedId === item.id;
      const content = <><span className="summary-stat-icon"><Icon size={15} /></span><span><small>{item.label}</small><strong>{item.value.toLocaleString("cs-CZ")}</strong></span></>;
      return onSelect
        ? <button type="button" key={item.id} className={`summary-stat summary-stat-${item.tone ?? "neutral"} ${active ? "selected" : ""}`} aria-label={`${item.label}: ${item.value.toLocaleString("cs-CZ")}`} aria-pressed={active} onClick={() => onSelect(item.id)}>{content}</button>
        : <span key={item.id} className={`summary-stat summary-stat-${item.tone ?? "neutral"}`}>{content}</span>;
    })}
  </div>;
}

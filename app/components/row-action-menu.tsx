"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";

export type RowAction = {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
};

export function RowActionMenu({ label, actions }: { label: string; actions: RowAction[] }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<React.CSSProperties>({});

  const place = () => {
    const trigger = triggerRef.current?.getBoundingClientRect();
    if (!trigger) return;
    const width = 230;
    const estimatedHeight = Math.min(actions.length * 44 + 12, 240);
    const top = trigger.bottom + estimatedHeight + 12 > window.innerHeight
      ? Math.max(12, trigger.top - estimatedHeight - 6)
      : trigger.bottom + 6;
    setPosition({
      position: "fixed",
      width,
      left: Math.max(12, Math.min(trigger.right - width, window.innerWidth - width - 12)),
      top,
    });
  };

  useEffect(() => {
    if (!open) return;
    place();
    requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus());
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      } else if (["ArrowDown","ArrowUp","Home","End"].includes(event.key)) {
        const items=Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")??[]);
        if(!items.length)return;
        event.preventDefault();
        const current=items.indexOf(document.activeElement as HTMLButtonElement);
        const next=event.key==="Home"?0:event.key==="End"?items.length-1:event.key==="ArrowUp"?(current<=0?items.length-1:current-1):(current+1)%items.length;
        items[next]?.focus();
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", keyboard);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", keyboard);
      window.removeEventListener("resize", place);
    };
  }, [actions.length, open]);

  return <>
    <button ref={triggerRef} type="button" className="ghost-icon row-action-trigger" aria-label={label} aria-expanded={open} aria-haspopup="menu" onClick={(event) => { event.stopPropagation(); setOpen(value => !value); }}><MoreHorizontal size={18}/></button>
    {open && createPortal(<div ref={menuRef} className="row-action-popover" style={position} role="menu" aria-label={label}>
      {actions.map(action => <button key={action.label} type="button" role="menuitem" className={action.danger ? "danger" : ""} disabled={action.disabled} onClick={(event) => { event.stopPropagation(); setOpen(false); action.onSelect(); }}>{action.label}</button>)}
    </div>, document.body)}
  </>;
}

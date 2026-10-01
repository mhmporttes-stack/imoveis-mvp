"use client";

import { useEffect, useId, useRef, useState } from "react";
import { cx } from "./cx";

// Menu de ações compacto ("⋯"). Abre abaixo do gatilho, fecha com Esc,
// clique fora ou ao escolher; setas ↑/↓ percorrem os itens e o foco volta ao
// gatilho ao fechar. `items`: [{ label, icon, onSelect, tone?, hidden?, separatorBefore? }].
export default function Menu({ label, trigger, items, align = "right", className = "" }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const menuId = useId();
  const visible = items.filter((item) => !item.hidden);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => { if (!rootRef.current?.contains(event.target)) setOpen(false); };
    const onKey = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const buttons = Array.from(rootRef.current?.querySelectorAll('[role="menuitem"]') || []);
        const index = buttons.indexOf(document.activeElement);
        const next = event.key === "ArrowDown" ? (index + 1) % buttons.length : (index - 1 + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    rootRef.current?.querySelector('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cx("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-touch w-touch items-center justify-center rounded-control border border-line bg-white text-ink-2 transition-colors hover:bg-navy/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        {trigger}
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          className={cx(
            "ui-menu absolute bottom-full z-40 mb-2 w-56 rounded-card border border-line bg-white p-1.5 shadow-float sm:bottom-auto sm:top-full sm:mb-0 sm:mt-2",
            align === "right" ? "right-0" : "left-0"
          )}
        >
          {visible.map((item) => (
            <div key={item.label}>
              {item.separatorBefore ? <div className="my-1 border-t border-line" role="separator" /> : null}
              <button
                type="button"
                role="menuitem"
                onClick={() => { setOpen(false); item.onSelect(); }}
                className={cx(
                  "flex min-h-touch w-full items-center gap-2.5 rounded-control px-2.5 text-left text-sm font-medium focus-visible:outline-none",
                  item.tone === "danger" ? "text-danger hover:bg-danger-soft focus-visible:bg-danger-soft" : "text-ink hover:bg-navy/[0.05] focus-visible:bg-navy/[0.05]"
                )}
              >
                {item.icon ? <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" /> : null}
                {item.label}
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

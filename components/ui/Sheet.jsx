"use client";

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { cx } from "./cx";

// Painel sobreposto acessível sobre <dialog> nativo: foco preso, Esc fecha,
// foco volta ao gatilho, fundo inerte e rolagem travada.
// side="bottom" (sheet do celular, padrão), "right" (gaveta lateral no
// desktop) ou "auto" (bottom no celular, right a partir de md).
// Use para consultar/editar sem perder o contexto (padroes-crm.md §Modais).
export default function Sheet({ open, onClose, title, description = "", side = "auto", footer = null, className = "", compact = false, children }) {
  const ref = useRef(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return undefined;
    if (open && !dialog.open) {
      dialog.showModal();
      document.documentElement.classList.add("ui-sheet-open");
    } else if (!open && dialog.open) {
      dialog.close();
    }
    return undefined;
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return undefined;
    const handleClose = () => {
      document.documentElement.classList.remove("ui-sheet-open");
      onClose?.();
    };
    dialog.addEventListener("close", handleClose);
    return () => {
      dialog.removeEventListener("close", handleClose);
      document.documentElement.classList.remove("ui-sheet-open");
    };
  }, [onClose]);

  const sideClass = {
    bottom: "ui-sheet-bottom",
    right: "ui-sheet-right",
    auto: "ui-sheet-bottom md:ui-sheet-right"
  }[side] || "ui-sheet-bottom";

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      className={cx("ui-sheet", side === "auto" ? "ui-sheet-auto" : sideClass, className)}
      onClick={(event) => {
        // Clique no fundo (fora do painel) fecha.
        if (event.target === ref.current) ref.current.close();
      }}
    >
      {open ? (
        <div className="flex max-h-[inherit] flex-col">
          <header className={cx("flex gap-3 px-4 sm:px-5", compact ? "items-center pb-1 pt-4" : "items-start border-b border-line pb-3 pt-3")}>
            <span className="ui-sheet-handle" aria-hidden="true" />
            <div className={cx("min-w-0 flex-1", !compact && "pt-1")}>
              <h2 id={titleId} className={cx("font-semibold tracking-[-0.01em] text-navy", compact ? "text-xl leading-7" : "text-lg leading-6")}>{title}</h2>
              {description ? <p id={descriptionId} className="mt-0.5 text-sm text-ink-2">{description}</p> : null}
            </div>
            <button
              type="button"
              onClick={() => ref.current?.close()}
              className={cx(
                "inline-flex shrink-0 items-center justify-center text-ink-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                compact
                  // Fechar discreto: círculo de 36px, área de toque de 44px pelo ::before.
                  ? "relative h-9 w-9 rounded-full bg-navy/[0.06] hover:bg-navy/[0.1] before:absolute before:-inset-1 before:content-['']"
                  : "h-touch w-touch rounded-control hover:bg-navy/[0.06]"
              )}
              aria-label="Fechar"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </header>
          <div className={cx("min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 sm:px-5", compact ? "pb-4 pt-2" : "py-4")}>{children}</div>
          {footer ? <footer className="border-t border-line px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">{footer}</footer> : null}
        </div>
      ) : null}
    </dialog>
  );
}

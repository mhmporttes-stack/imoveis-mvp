"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import { cx } from "./cx";

// Painel sobreposto acessível sobre <dialog> nativo: foco preso, Esc fecha,
// foco volta ao gatilho, fundo inerte e rolagem travada.
// side="bottom" (sheet do celular, padrão), "right" (gaveta lateral no
// desktop) ou "auto" (bottom no celular, right a partir de md).
// Use para consultar/editar sem perder o contexto (padroes-crm.md §Modais).
// Saída animada (dono, 2026-10-25): ao fechar (X, fundo, Esc ou open=false) o painel desliza 180 ms
// (data-closing + CSS em globals.css) antes do dialog.close() de verdade; com movimento reduzido fecha na hora.
const EXIT_MS = 180;

export default function Sheet({ open, onClose, title, description = "", side = "auto", footer = null, className = "", compact = false, children }) {
  const ref = useRef(null);
  const titleId = useId();
  const descriptionId = useId();
  const [closing, setClosing] = useState(false);
  const closingTimer = useRef(null);
  const frozenBody = useRef(null);

  const finishClose = useCallback(() => {
    clearTimeout(closingTimer.current);
    closingTimer.current = null;
    setClosing(false);
    const dialog = ref.current;
    if (dialog?.open) dialog.close();
  }, []);

  const requestClose = useCallback(() => {
    const dialog = ref.current;
    if (!dialog || !dialog.open || closingTimer.current) return;
    if (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      dialog.close();
      return;
    }
    setClosing(true);
    // Rede de segurança caso o animationend não dispare (aba oculta, animação desligada).
    closingTimer.current = setTimeout(finishClose, EXIT_MS + 80);
  }, [finishClose]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return undefined;
    if (open && closingTimer.current) {
      // Reabriu no meio da saída: cancela e segue aberto.
      clearTimeout(closingTimer.current);
      closingTimer.current = null;
      setClosing(false);
    }
    if (open && !dialog.open) {
      dialog.showModal();
      document.documentElement.classList.add("ui-sheet-open");
    } else if (!open && dialog.open) {
      requestClose();
    }
    return undefined;
  }, [open, requestClose]);

  useEffect(() => () => clearTimeout(closingTimer.current), []);

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

  // Durante a saída o conteúdo fica congelado (o pai pode já ter esvaziado os dados).
  const content = open ? (
    <div className="flex max-h-[inherit] flex-col">
      <header className={cx("flex gap-3 px-4 sm:px-5", compact ? "items-center pb-1 pt-4" : "items-start border-b border-line pb-3 pt-3")}>
        <span className="ui-sheet-handle" aria-hidden="true" />
        <div className={cx("min-w-0 flex-1", !compact && "pt-1")}>
          <h2 id={titleId} className={cx("font-semibold tracking-[-0.01em] text-navy", compact ? "text-xl leading-7" : "text-lg leading-6")}>{title}</h2>
          {description ? <p id={descriptionId} className="mt-0.5 text-sm text-ink-2">{description}</p> : null}
        </div>
        <button
          type="button"
          onClick={requestClose}
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
  ) : null;
  if (open) frozenBody.current = content;
  const body = open ? content : closing ? frozenBody.current : null;

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      className={cx("ui-sheet", side === "auto" ? "ui-sheet-auto" : sideClass, className)}
      data-closing={closing ? "" : undefined}
      onCancel={(event) => {
        // Esc: a saída animada fecha o dialog no fim.
        if (event.cancelable) {
          event.preventDefault();
          requestClose();
        }
      }}
      onAnimationEnd={(event) => {
        if (closing && event.target === event.currentTarget) finishClose();
      }}
      onClick={(event) => {
        // Clique no fundo (fora do painel) fecha.
        if (event.target === ref.current) requestClose();
      }}
    >
      {body}
    </dialog>
  );
}

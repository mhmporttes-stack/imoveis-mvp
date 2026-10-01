"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CircleAlert, CircleCheck, X } from "lucide-react";
import { cx } from "./cx";

// Aviso curto de resultado (substitui alert()). Sucesso some em 3,5s; erro
// fica até fechar ou até o próximo aviso. Anunciado a leitores de tela.
//   const [notify, toastElement] = useToast();
//   notify("Etapa atualizada.");  notify("Não foi possível…", "danger");
export function useToast() {
  const [toast, setToast] = useState(null);
  const timer = useRef(null);
  const notify = useCallback((message, tone = "success") => {
    clearTimeout(timer.current);
    setToast({ message, tone, id: Date.now() });
    if (tone !== "danger") timer.current = setTimeout(() => setToast(null), 3500);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return [notify, <Toast key="toast" toast={toast} onClose={() => setToast(null)} />];
}

function Toast({ toast, onClose }) {
  const danger = toast?.tone === "danger";
  const Icon = danger ? CircleAlert : CircleCheck;
  return (
    <div
      aria-live={danger ? "assertive" : "polite"}
      role={danger ? "alert" : "status"}
      className="pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-4 bottom-[calc(1rem+max(env(safe-area-inset-bottom),var(--admin-bottom-nav-space)))]"
    >
      {toast ? (
        <div
          key={toast.id}
          className={cx(
            "ui-toast pointer-events-auto flex max-w-md items-start gap-2.5 rounded-control px-4 py-3 text-sm shadow-float",
            danger ? "bg-danger-soft text-danger ring-1 ring-danger-line" : "bg-navy text-white"
          )}
        >
          <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p className="min-w-0 flex-1 font-medium">{toast.message}</p>
          <button type="button" onClick={onClose} aria-label="Fechar aviso" className="-m-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-chip opacity-80 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Share, X } from "lucide-react";

const DISMISS_KEY = "mm_admin_pwa_install_hint_dismissed";

export default function AdminPwaInstallHint() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const userAgent = window.navigator.userAgent || "";
    const isAppleTouchDevice = /iPad|iPhone|iPod/.test(userAgent) || (userAgent.includes("Mac") && navigator.maxTouchPoints > 1);
    const isStandalone =
      window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
    const dismissed = window.localStorage.getItem(DISMISS_KEY) === "1";

    if (isAppleTouchDevice && !isStandalone && !dismissed) {
      const timer = window.setTimeout(() => setVisible(true), 1200);
      return () => window.clearTimeout(timer);
    }
  }, []);

  function dismiss() {
    window.localStorage.setItem(DISMISS_KEY, "1");
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <aside className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-4 right-4 z-[130] mx-auto max-w-[560px] rounded-[24px] border border-blue-100 bg-white p-4 text-navy shadow-premium md:left-auto md:right-6 md:mx-0">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#E9F2FF] text-brand">
          <Share className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black uppercase tracking-[0.16em] text-brand">Instalar no iPhone</p>
          <p className="mt-1 text-sm font-semibold leading-6 text-muted">
            Toque em Compartilhar e depois em Adicionar à Tela de Início para abrir o Painel Matheus como aplicativo.
          </p>
        </div>
        <button
          aria-label="Fechar orientação de instalação"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line text-muted transition hover:bg-mist hover:text-navy"
          onClick={dismiss}
          type="button"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </aside>
  );
}

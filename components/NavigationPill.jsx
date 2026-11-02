"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import FloatingStatusPill from "@/components/FloatingStatusPill";
import { createNavigationPill, isPlainNavigationClick, isSameLocation } from "@/components/navigation-pill-core.mjs";

// Pílula "Carregando…" ao tocar em item do menu (barra inferior, folha "Mais", menu lateral) — dono, 2026-11-02. A regra
// (atraso de 120 ms, teto de 15 s) é components/navigation-pill-core.mjs. Aparece acima da folha "Mais" (z-50) e abaixo
// dos modais críticos (z-110+). Some quando o caminho/filtro da tela muda ou no teto de segurança.
const pill = createNavigationPill();

// Props para o link do menu: marca o início no toque (captura: não substitui o onClick do próprio link nem a cena da Meta Diária).
export function navPillProps(href) {
  return {
    onClickCapture(event) {
      if (!isPlainNavigationClick(event)) return;
      if (isSameLocation(href, window.location.pathname, window.location.search)) return;
      pill.start();
    }
  };
}

export default function NavigationPill() {
  const visible = useSyncExternalStore(pill.subscribe, pill.isVisible, () => false);
  const pathname = usePathname();
  const search = useSearchParams().toString();
  useEffect(() => {
    pill.finish();
  }, [pathname, search]);
  return visible ? <FloatingStatusPill label="Carregando…" className="z-[60]" data-navigation-pill="" /> : null;
}

"use client";

import { createContext, useContext } from "react";
import Badge from "@/components/ui/Badge";

// Indicador sutil enquanto a tela mostra o que estava guardado no aparelho e busca a versão nova no servidor
// (cache das telas no aparelho, dono 2026-10-26 — components/device-view-cache.js). Não bloqueia toque nem rolagem.
export default function DeviceCacheRefreshing({ show }) {
  if (!show) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      data-device-cache-refreshing=""
      className="pointer-events-none fixed inset-x-0 z-30 flex justify-center px-4"
      style={{ bottom: "calc(max(env(safe-area-inset-bottom), var(--admin-bottom-nav-space, 0px)) + 12px)" }}
    >
      <Badge tone="info" dot className="shadow-soft">Atualizando…</Badge>
    </div>
  );
}

// Conta que está olhando o painel (lib/chat-viewer-key.mjs), para telas montadas fora de uma página com auth própria
// (ex.: o carregamento do Início). Fornecida por app/admin/layout.jsx.
const ViewerKeyContext = createContext("");

export function ViewerKeyProvider({ viewerKey = "", children }) {
  return <ViewerKeyContext.Provider value={viewerKey}>{children}</ViewerKeyContext.Provider>;
}

export function useViewerKey() {
  return useContext(ViewerKeyContext);
}

"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useWhatsappChatSummary } from "@/components/useWhatsappChatSummary";

// Contadores do menu (clientes novos, aguardando simulação, respostas da Prospecção, agenda). O número do Chat vem do
// resumo do Chat (tempo real). Desempenho (2026-10-20): /api/admin/crm-badge-counts NÃO é mais refeito a cada ping do
// Chat — só ao trocar de tela, ao voltar o foco para a aba e a cada 2 min com a aba visível. Estado compartilhado:
// vários componentes usando o hook fazem uma única busca (inFlight) e um único relógio.
export const CRM_BADGE_POLL_MS = 2 * 60 * 1000;

let counts = { clients: 0, agenda: 0 };
let inFlight = null;
const listeners = new Set();
let stopScheduler = null;

function refresh() {
  if (!inFlight) inFlight = fetch("/api/admin/crm-badge-counts", { cache: "no-store" })
    .then((response) => response.ok ? response.json() : null)
    .then((next) => {
      if (next) {
        counts = next;
        for (const listener of listeners) listener(counts);
      }
    })
    .catch(() => {})
    .finally(() => { inFlight = null; });
  return inFlight;
}

function startScheduler() {
  if (stopScheduler) return;
  const intervalId = setInterval(() => {
    if (document.visibilityState === "visible") refresh();
  }, CRM_BADGE_POLL_MS);
  const onVisibility = () => {
    if (document.visibilityState === "visible") refresh();
  };
  document.addEventListener("visibilitychange", onVisibility);
  stopScheduler = () => {
    clearInterval(intervalId);
    document.removeEventListener("visibilitychange", onVisibility);
    stopScheduler = null;
  };
}

export function useCrmBadgeCounts() {
  const { summary } = useWhatsappChatSummary();
  const pathname = usePathname();
  const [current, setCurrent] = useState(counts);
  useEffect(() => {
    listeners.add(setCurrent);
    setCurrent(counts);
    startScheduler();
    return () => {
      listeners.delete(setCurrent);
      if (!listeners.size) stopScheduler?.();
    };
  }, []);
  // Ao montar e a cada troca de tela (vários componentes na mesma tela = uma busca só, pelo inFlight).
  useEffect(() => {
    refresh();
  }, [pathname]);
  const chat = summary.unreadMessages || 0;
  return { ...current, chat, total: (current.newAttendances || 0) + (current.awaitingSimulation || 0) + (current.prospectingReplies || 0) + current.agenda + chat };
}

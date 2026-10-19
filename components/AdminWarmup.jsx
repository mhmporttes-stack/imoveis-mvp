"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { readChatView, readViewerData, saveChatView, saveViewerData } from "@/components/chat-view-cache";
import { CLIENTS_CACHE_NAME, CLIENTS_DEFAULT_LIST_QUERY, PERFORMANCE_CACHE_NAME } from "@/components/panel-cache-names";

// Pré-carrega as telas da barra inferior depois que o painel abre (pedido do dono, 2026-10-12: "o primeiro toque no Chat
// demora mais"). Só no celular, uma vez por sessão, com o app visível, fora de "economia de dados"/2G, e só as telas que
// a barra mostra para esta conta (decidido no servidor, app/admin/layout.jsx).
// - fullRoutes: tela inteira já montada (Clientes, Chat; admin geral: Online e Desempenho; corretor/associado: Simulador
//   Caixa). Todas só leem. A Meta Diária não é montada ao abrir o app (dono, 2026-10-19, MD-16): monta ao abrir a Meta.
//   Lista decidida em app/admin/layout.jsx (warmupTargets).
// - lightRoutes: só o código da tela (Agenda).
// - chat: lista de conversas no cache do Chat (components/chat-view-cache.js), sem recibo "entregue" nem marcar lida
//   (?warm=1 em /api/admin/whatsapp-chat/conversations). A tela mostra isso na hora e atualiza ao abrir.
const START_DELAY_MS = 3000;
let done = false;

function connectionTooSlow() {
  const connection = typeof navigator !== "undefined" ? navigator.connection : null;
  return Boolean(connection?.saveData) || /(^|-)2g$/.test(connection?.effectiveType || "");
}

function warmChatList(viewerKey) {
  if (readChatView(viewerKey)?.view) return;
  fetch("/api/admin/whatsapp-chat/conversations?filter=all&warm=1", { cache: "no-store" })
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => {
      // Já abriu o Chat enquanto isso (ou trocou de conta): não sobrescreve.
      if (!Array.isArray(data?.conversations) || readChatView(viewerKey)?.view) return;
      saveChatView(viewerKey, {
        tab: "conversations",
        filter: "all",
        clientStatus: "",
        search: "",
        searchInput: "",
        scopedBroker: null,
        // Mesma regra da tela: Particular só na própria aba.
        conversations: data.conversations.filter((item) => !item.private),
        listHasMore: data.conversations.length >= 100,
        selectedId: "",
        brokers: [],
        mySlots: []
      });
    })
    .catch(() => {});
}

// Números do Desempenho (só leitura; mesma API e mesmo período padrão da tela) — a tela abre já com eles e atualiza.
function warmPerformance(viewerKey) {
  if (readViewerData(viewerKey, PERFORMANCE_CACHE_NAME)) return;
  fetch("/api/performance-overview?period=month", { cache: "no-store" })
    .then((response) => (response.ok ? response.json() : null))
    .then((payload) => {
      if (payload?.overview && !readViewerData(viewerKey, PERFORMANCE_CACHE_NAME)) saveViewerData(viewerKey, PERFORMANCE_CACHE_NAME, payload.overview);
    })
    .catch(() => {});
}

// Lista de Clientes na visão padrão (só leitura; mesma API e mesmos parâmetros da tela) — a lista abre já preenchida.
function warmClients(viewerKey) {
  if (readViewerData(viewerKey, CLIENTS_CACHE_NAME)) return;
  fetch(`/api/simulation-registrations/list?${CLIENTS_DEFAULT_LIST_QUERY}`, { cache: "no-store" })
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => {
      if (Array.isArray(data?.items) && !readViewerData(viewerKey, CLIENTS_CACHE_NAME)) saveViewerData(viewerKey, CLIENTS_CACHE_NAME, data);
    })
    .catch(() => {});
}

export default function AdminWarmup({ viewerKey = "", chat = false, clients = false, performance = false, fullRoutes = [], lightRoutes = [] }) {
  const router = useRouter();

  useEffect(() => {
    if (done || !viewerKey) return undefined;
    if (!window.matchMedia("(max-width: 767px)").matches || connectionTooSlow()) return undefined;
    const sessionFlag = `mm-warmup:${viewerKey}`;
    try {
      if (window.sessionStorage.getItem(sessionFlag)) return undefined;
    } catch {
      // sem armazenamento da sessão: vale o controle em memória (done)
    }

    let cancelled = false;
    let timer = null;
    let idleId = null;
    const requestIdle = window.requestIdleCallback || ((callback) => window.setTimeout(callback, 1));
    const cancelIdle = window.cancelIdleCallback || window.clearTimeout;

    function run() {
      if (cancelled || done) return;
      if (document.visibilityState !== "visible") return; // volta a tentar quando o app ficar visível
      done = true;
      try { window.sessionStorage.setItem(sessionFlag, "1"); } catch { /* opcional */ }
      for (const href of fullRoutes) router.prefetch(href, { kind: "full" });
      for (const href of lightRoutes) router.prefetch(href);
      if (chat) warmChatList(viewerKey);
      if (performance) warmPerformance(viewerKey);
      if (clients) warmClients(viewerKey);
    }
    function schedule() {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { idleId = requestIdle(run, { timeout: 5000 }); }, START_DELAY_MS);
    }
    function onVisibility() {
      if (document.visibilityState === "visible" && !done) schedule();
    }

    schedule();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (idleId !== null) cancelIdle(idleId);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // Uma vez por sessão: as listas vêm do servidor e não mudam durante a vida do layout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getAdminMenuGroups } from "@/components/AdminMenu";
import { buildWarmupPlan, isDue, MENU_WINDOW_MS, PRIMARY_WINDOW_MS } from "@/components/admin-warmup-plan.mjs";
import { onChatCacheClear, readChatView, readViewerData, saveChatView, saveViewerData } from "@/components/chat-view-cache";
import {
  CALENDAR_CACHE_PREFIX,
  calendarMonthQuery,
  CLIENTS_CACHE_NAME,
  CLIENTS_DEFAULT_LIST_QUERY,
  MARKETPLACE_DEFAULT_LIST_QUERY,
  MARKETPLACE_LIST_CACHE_PREFIX,
  PERFORMANCE_CACHE_NAME
} from "@/components/panel-cache-names";

// Pré-carrega o painel em segundo plano (celular e computador) — dono, 2026-10-12 ("o primeiro toque no Chat demora") e
// 2026-10-22 ("Todos os botões do aplicativo devem já ser pré-carregados. Carregue primeiro a aba Clientes e depois vá
// carregando tudo junto"; no computador "TODAS as opções [...] prontas para eu clicar").
// Ordem e regras de cada rota: components/admin-warmup-plan.mjs. Resumo:
// 1) Clientes (rota + 1ª página da lista na visão padrão); 2) barra inferior do perfil (decidida no servidor,
//    app/admin/layout.jsx warmupTargets) + atalhos do cabeçalho (Chat, Marketplace, Agenda) com os dados de tela que já
//    têm cache (Chat, Marketplace, Desempenho, Agenda); 3) todos os itens do menu do perfil (getAdminMenuGroups — o mesmo
//    menu lateral/"Mais"; só o que o perfil já vê).
// Cuidados: um item por vez, quando o navegador está ocioso e o app visível; nada de consulta nova (só as que a tela faria
// ao abrir); dados só se ainda não estão na memória; Meta Diária nunca é montada (MD-16); economia de dados/2G = só as
// rotas da barra, sem dados. Memória por conta real + efetiva (chat-view-cache; também no aparelho desde 2026-10-26), limpa ao sair e em "Alterar conta"
// (router.refresh() também descarta as telas guardadas pelo Next).
const START_DELAY_MS = 2000; // deixa a tela atual terminar de carregar
const AFTER_NAV_DELAY_MS = 1500;
const PRIMARY_GAP_MS = 400;
const MENU_GAP_MS = 1200;
const IDLE_TIMEOUT_MS = 3000;

function connectionTooSlow() {
  const connection = typeof navigator !== "undefined" ? navigator.connection : null;
  return Boolean(connection?.saveData) || /(^|-)2g$/.test(connection?.effectiveType || "");
}

function getJson(url) {
  return fetch(url, { cache: "no-store" })
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null);
}

function warmChatList(viewerKey) {
  if (readChatView(viewerKey)?.view) return null;
  // ?warm=1: sem recibo "entregue" nem marcar lida (app/api/admin/whatsapp-chat/conversations).
  return getJson("/api/admin/whatsapp-chat/conversations?filter=all&warm=1").then((data) => {
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
  });
}

// Guarda o resultado de uma API (mesma URL e parâmetros que a tela usa ao abrir) no cache por conta, se ainda não houver.
function warmViewerData(viewerKey, name, url, accept, wrap = (data) => data) {
  if (readViewerData(viewerKey, name)) return null;
  return getJson(url).then((data) => {
    if (accept(data) && !readViewerData(viewerKey, name)) saveViewerData(viewerKey, name, wrap(data));
  });
}

// Dados de tela que já têm ponto de cache seguro, por rota (o resto vem montado pelo servidor no próprio pré-carregamento).
const DATA_WARMERS = {
  // Lista de Clientes na visão padrão (components/clients/useClientList.js).
  "/admin/simulacoes": (key, flags) => flags.clients && warmViewerData(key, CLIENTS_CACHE_NAME, `/api/simulation-registrations/list?${CLIENTS_DEFAULT_LIST_QUERY}`, (data) => Array.isArray(data?.items)),
  "/admin/chat": (key, flags) => flags.chat && warmChatList(key),
  // Chat do Marketplace: { at, data } — a tela usa `at` para não buscar de novo logo em seguida (MarketplaceChat).
  "/admin/chat/marketplace": (key, flags) => {
    if (!flags.marketplace) return null;
    const name = `${MARKETPLACE_LIST_CACHE_PREFIX}${MARKETPLACE_DEFAULT_LIST_QUERY}`;
    return warmViewerData(key, name, `/api/admin/marketplace-chat/conversations?${MARKETPLACE_DEFAULT_LIST_QUERY}`, (data) => Array.isArray(data?.conversations), (data) => ({ at: Date.now(), data }));
  },
  // Números do Desempenho, período padrão do mês (PerformanceOverviewDashboard).
  "/admin/desempenho": (key, flags) => flags.performance && warmViewerData(key, PERFORMANCE_CACHE_NAME, "/api/performance-overview?period=month", (data) => Boolean(data?.overview), (data) => data.overview),
  // Agenda: mês atual, visão da equipe (padrão da tela; a API decide o escopo de cada perfil — ActivityCalendar).
  "/admin/calendario": (key) => {
    const query = calendarMonthQuery(new Date(), "team");
    return warmViewerData(key, `${CALENDAR_CACHE_PREFIX}${query}`, `/api/calendar-activities?${query}`, (data) => Array.isArray(data?.activities));
  }
};

// Controle por conta: { running, primaryAt, menuAt } (memória + sessionStorage, para não repetir ao recarregar a página).
const state = new Map();

const STORAGE_PREFIX = "mm-warmup:v2:";
function storageKey(viewerKey) {
  return `${STORAGE_PREFIX}${viewerKey}`;
}

// Sair da conta / "Alterar conta" limpam a memória das telas (clearChatCache): esquece também quando aqueceu, para a
// próxima conta aquecer do zero.
if (typeof window !== "undefined") {
  onChatCacheClear(() => {
    state.clear();
    try {
      for (const key of Object.keys(window.sessionStorage)) if (key.startsWith(STORAGE_PREFIX)) window.sessionStorage.removeItem(key);
    } catch {
      // opcional
    }
  });
}

function readStamps(viewerKey) {
  const current = state.get(viewerKey);
  if (current) return current;
  let stamps = { primaryAt: 0, menuAt: 0 };
  try {
    stamps = { ...stamps, ...JSON.parse(window.sessionStorage.getItem(storageKey(viewerKey)) || "{}") };
  } catch {
    // sem armazenamento da sessão: vale a memória
  }
  const fresh = { running: false, ...stamps };
  state.set(viewerKey, fresh);
  return fresh;
}

function writeStamps(viewerKey, stamps) {
  try {
    window.sessionStorage.setItem(storageKey(viewerKey), JSON.stringify({ primaryAt: stamps.primaryAt, menuAt: stamps.menuAt }));
  } catch {
    // opcional
  }
}

function waitIdle() {
  return new Promise((resolve) => {
    if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(() => resolve(), { timeout: IDLE_TIMEOUT_MS });
    else window.setTimeout(resolve, 1);
  });
}

function waitVisible() {
  if (document.visibilityState === "visible") return Promise.resolve();
  return new Promise((resolve) => {
    const onChange = () => {
      if (document.visibilityState !== "visible") return;
      document.removeEventListener("visibilitychange", onChange);
      resolve();
    };
    document.addEventListener("visibilitychange", onChange);
  });
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export default function AdminWarmup({ viewerKey = "", chat = false, clients = false, performance = false, marketplace = false, fullRoutes = [], lightRoutes = [], nav = null }) {
  const router = useRouter();
  const pathname = usePathname() || "";
  const latest = useRef({});
  const rescheduleRef = useRef(null);
  latest.current = { router, pathname, viewerKey, flags: { chat, clients, performance, marketplace }, fullRoutes, lightRoutes, nav };

  useEffect(() => {
    if (!viewerKey) return undefined;
    let cancelled = false; // troca de conta / sair desmonta ou muda viewerKey: para a fila na hora
    let timer = null;
    const isCancelled = () => cancelled || latest.current.viewerKey !== viewerKey;

    async function run() {
      const stamps = readStamps(viewerKey);
      if (stamps.running || isCancelled()) return;
      const now = Date.now();
      const primaryDue = isDue(stamps.primaryAt, now, PRIMARY_WINDOW_MS);
      const menuDue = isDue(stamps.menuAt, now, MENU_WINDOW_MS);
      if (!primaryDue && !menuDue) return;

      const { router: currentRouter, pathname: currentPath, flags, fullRoutes: full, lightRoutes: light, nav: navFlags } = latest.current;
      const slow = connectionTooSlow();
      // Atalhos do cabeçalho do computador (AdminTopBar): Chat (se o perfil vê), Chat Marketplace e Agenda.
      const headerHrefs = [...(flags.chat ? ["/admin/chat"] : []), "/admin/chat/marketplace", "/admin/calendario"];
      const menuHrefs = navFlags
        ? getAdminMenuGroups(navFlags).flatMap((group) => group.items.filter((item) => !item.fullPage).map((item) => item.href))
        : [];
      const plan = buildWarmupPlan({ primaryHrefs: [...full, ...light, ...headerHrefs], menuHrefs, currentPath, slow });

      stamps.running = true;
      if (primaryDue) stamps.primaryAt = now;
      if (menuDue && !slow) stamps.menuAt = now;
      writeStamps(viewerKey, stamps);
      try {
        const queues = [
          ...(primaryDue ? [[plan.primary, PRIMARY_GAP_MS]] : []),
          ...(menuDue ? [[plan.menu, MENU_GAP_MS]] : [])
        ];
        for (const [items, gap] of queues) {
          for (const { href, kind } of items) {
            await waitVisible();
            await waitIdle();
            if (isCancelled()) return;
            currentRouter.prefetch(href, kind === "full" ? { kind: "full" } : undefined);
            // Dados da tela (só na 1ª passagem pela rota e fora da economia de dados), um por vez.
            const warmData = !slow && href === href.split("?")[0] ? DATA_WARMERS[href] : null;
            const pending = warmData ? warmData(viewerKey, flags) : null;
            if (pending && typeof pending.then === "function") await pending;
            await sleep(gap);
          }
        }
      } finally {
        stamps.running = false;
      }
    }

    function schedule(delay) {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { run(); }, delay);
    }
    function onVisibility() {
      if (document.visibilityState === "visible") schedule(AFTER_NAV_DELAY_MS);
    }

    schedule(START_DELAY_MS);
    document.addEventListener("visibilitychange", onVisibility);
    // Troca de tela (ver efeito abaixo) também confere se a janela venceu.
    rescheduleRef.current = () => schedule(AFTER_NAV_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      rescheduleRef.current = null;
      const stamps = state.get(viewerKey);
      if (stamps) stamps.running = false;
    };
  }, [viewerKey]);

  // A cada troca de tela: se a janela de 5 min (barra) ou 30 min (menu) venceu, refaz — só com o app em uso.
  const firstPath = useRef(true);
  useEffect(() => {
    if (firstPath.current) {
      firstPath.current = false;
      return;
    }
    rescheduleRef.current?.();
  }, [pathname]);

  return null;
}

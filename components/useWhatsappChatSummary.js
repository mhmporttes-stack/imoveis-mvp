"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { onChatCacheClear } from "@/components/chat-view-cache";
import { isPageHidden, onPageVisibilityChange } from "@/components/page-visibility";

// Resumo do CHAT (não lidas) + canal de tempo real, COMPARTILHADO entre todos
// os componentes da página (menu, badge, tela do Chat): uma única busca/canal,
// mesmo com vários componentes usando o hook. O servidor manda um "ping" sem
// dados via Supabase Realtime Broadcast quando algo muda (webhook, envio,
// leitura); ao receber, refaz a busca pela API autenticada. Polling lento
// (30s, só com a aba visível) fica como rede de segurança.
const store = {
  summary: { unreadConversations: 0, unreadMessages: 0 },
  listeners: new Set(),
  changeHandlers: new Set(),
  started: false,
  stop: null
};
let summaryInFlight = null;
// Saiu ou trocou de conta: o número de não lidas da conta anterior não fica na tela nem no ícone do app.
onChatCacheClear(() => {
  setSummary({ unreadConversations: 0, unreadMessages: 0 });
  // Troca de conta: já busca a contagem da conta nova (depois de sair, a busca é recusada e fica zerado).
  if (store.started) fetchSummary();
});

function setSummary(next) {
  store.summary = next;
  for (const listener of store.listeners) listener(next);
  syncAppBadge(next.unreadMessages || 0);
}

// Ícone do app (tela inicial do celular, PWA instalado): mostra a mesma contagem
// de não lidas do Chat que já aparece no menu (Badging API — iOS 16.4+/Android
// Chrome/desktop com o app instalado; navegador comum ou versão antiga não tem
// o método, por isso o "in navigator" antes de chamar). Só corrige o número
// enquanto o app está aberto (aba ativa ou em segundo plano, com o canal em
// tempo real vivo); com o app FECHADO quem atualiza é o push (public/sw.js).
// Diagnóstico ao vivo (2026-09-27, ver docs/CHANGELOG_AI.md): a chamada sempre
// resolve com sucesso aqui, mas o iOS às vezes não pinta o ícone de verdade —
// limitação confirmada do WebKit, não deste código; nada a corrigir do lado JS.
function syncAppBadge(count) {
  try {
    if (typeof navigator === "undefined" || !("setAppBadge" in navigator)) return;
    if (count > 0) navigator.setAppBadge(count).catch(() => {});
    else navigator.clearAppBadge?.().catch(() => {});
  } catch {
    // Navegador sem suporte real por trás do "in navigator" (raro) — ignora.
  }
}

function fetchSummary() {
  if (!summaryInFlight) summaryInFlight = (async () => {
    try {
      const response = await fetch("/api/admin/whatsapp-chat/summary", { cache: "no-store" });
      const data = await response.json().catch(() => null);
      if (response.ok && data) {
        setSummary(data);
        return data;
      }
    } catch {
      // Falha de rede pontual — o próximo ciclo tenta de novo.
    }
    return null;
  })().finally(() => { summaryInFlight = null; });
  return summaryInFlight;
}

function startStore() {
  if (store.started) return;
  store.started = true;
  let cancelled = false;
  let channel = null;
  let realtimeClient = null;
  let debounce = null;

  function notify() {
    if (cancelled) return;
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      fetchSummary();
      for (const handler of store.changeHandlers) handler();
    }, 250);
  }

  // Desempenho (2026-10-12): a biblioteca do Supabase (~50 KB compactados, só usada pelo canal em tempo real) é baixada
  // DEPOIS da primeira contagem, sem atrasar o carregamento da tela — o canal já só abria depois dessa busca.
  fetchSummary().then(async (data) => {
    if (cancelled || !data?.topic) return;
    const { getSupabaseBrowserClient } = await import("@/lib/supabase-browser");
    const client = getSupabaseBrowserClient();
    if (cancelled || !client) return;
    realtimeClient = client;
    channel = client.channel(data.topic).on("broadcast", { event: "changed" }, notify).subscribe();
  }).catch((error) => {
    // Sem rede para baixar a biblioteca: fica sem o canal em tempo real; o polling de 30 s abaixo segue atualizando.
    console.warn("Chat: canal em tempo real indisponível.", error?.message || error);
  });

  const intervalId = setInterval(() => {
    if (!isPageHidden()) notify();
  }, 30000);
  // Ao VOLTAR para o app atualiza na hora; ao sair (aba/app em segundo plano, ou o app de desktop minimizado) não há o
  // que buscar.
  const stopWatchingVisibility = onPageVisibilityChange(() => {
    if (!isPageHidden()) notify();
  });

  store.stop = () => {
    cancelled = true;
    clearTimeout(debounce);
    clearInterval(intervalId);
    stopWatchingVisibility();
    if (channel) realtimeClient?.removeChannel(channel);
    store.started = false;
    store.stop = null;
  };
}

// onChange (opcional): chamado a cada ping/poll para o chamador atualizar
// lista/conversa aberta.
export function useWhatsappChatSummary(onChange) {
  const [summary, setLocalSummary] = useState(store.summary);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const listener = (next) => setLocalSummary(next);
    const handler = () => onChangeRef.current?.();
    store.listeners.add(listener);
    store.changeHandlers.add(handler);
    setLocalSummary(store.summary);
    startStore();

    return () => {
      store.listeners.delete(listener);
      store.changeHandlers.delete(handler);
      if (!store.listeners.size) store.stop?.();
    };
  }, []);

  const refresh = useCallback(() => fetchSummary(), []);
  return { summary, refresh };
}

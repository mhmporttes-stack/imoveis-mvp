"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

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
function syncAppBadge(count) {
  const supported = typeof navigator !== "undefined" && "setAppBadge" in navigator;
  try {
    if (!supported) {
      reportBadgeDebug({ supported, count, outcome: "unsupported" });
      return;
    }
    const call = count > 0 ? navigator.setAppBadge(count) : navigator.clearAppBadge?.();
    Promise.resolve(call)
      .then(() => reportBadgeDebug({ supported, count, outcome: "ok" }))
      .catch((error) => reportBadgeDebug({ supported, count, outcome: "rejected", error: String(error?.message || error) }));
  } catch (error) {
    reportBadgeDebug({ supported, count, outcome: "threw", error: String(error?.message || error) });
  }
}

// Diagnóstico TEMPORÁRIO (ver app/api/admin/tmp-badge-debug) — o dono testou no
// iPhone e o ícone não mudou; sem acesso ao console do aparelho, isto manda o
// resultado real da chamada (suporte, resolveu/rejeitou, modo de exibição) pro
// log do servidor. Fire-and-forget, nunca atrapalha a tela. Remover depois.
function reportBadgeDebug(details) {
  try {
    if (typeof fetch !== "function") return;
    const displayModeStandalone = typeof window !== "undefined" && window.matchMedia?.("(display-mode: standalone)")?.matches;
    fetch("/api/admin/tmp-badge-debug", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...details, displayModeStandalone, ua: navigator.userAgent }),
      keepalive: true
    }).catch(() => {});
  } catch {
    // Nunca deixa o diagnóstico quebrar a tela.
  }
}

async function fetchSummary() {
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
}

function startStore() {
  if (store.started) return;
  store.started = true;
  let cancelled = false;
  let channel = null;
  let debounce = null;

  function notify() {
    if (cancelled) return;
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      fetchSummary();
      for (const handler of store.changeHandlers) handler();
    }, 250);
  }

  fetchSummary().then((data) => {
    if (cancelled || !data?.topic) return;
    const client = getSupabaseBrowserClient();
    if (!client) return;
    channel = client.channel(data.topic).on("broadcast", { event: "changed" }, notify).subscribe();
  });

  const intervalId = setInterval(() => {
    if (document.visibilityState === "visible") notify();
  }, 30000);
  document.addEventListener("visibilitychange", notify);

  store.stop = () => {
    cancelled = true;
    clearTimeout(debounce);
    clearInterval(intervalId);
    document.removeEventListener("visibilitychange", notify);
    if (channel) getSupabaseBrowserClient()?.removeChannel(channel);
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

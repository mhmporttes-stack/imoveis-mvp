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

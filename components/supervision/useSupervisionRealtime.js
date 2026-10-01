"use client";

import { useEffect, useRef } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

// Tempo real das mensagens de supervisão — mesmo padrão do Chat
// (components/useWhatsappChatSummary.js): assina um tópico de Broadcast do
// Supabase que só recebe um "ping" sem dados e, a cada ping, chama
// `onChange` (que relê pela API autenticada). O tópico é por usuário e vem
// da própria API. Rede de segurança sem polling agressivo: relê ao voltar
// para a aba e a cada `fallbackMs` só com a aba visível.
export function useSupervisionRealtime(topic, onChange, { fallbackMs = 60000 } = {}) {
  const handlerRef = useRef(onChange);
  handlerRef.current = onChange;

  useEffect(() => {
    let debounceId = null;
    const notify = () => {
      if (debounceId) clearTimeout(debounceId);
      debounceId = setTimeout(() => handlerRef.current?.(), 200);
    };

    let channel = null;
    const client = topic ? getSupabaseBrowserClient() : null;
    if (client) {
      channel = client.channel(topic).on("broadcast", { event: "changed" }, notify).subscribe();
    }

    const onVisible = () => {
      if (document.visibilityState === "visible") notify();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    const intervalId = setInterval(() => {
      if (document.visibilityState === "visible") handlerRef.current?.();
    }, fallbackMs);

    return () => {
      if (debounceId) clearTimeout(debounceId);
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      if (channel && client) client.removeChannel(channel);
    };
  }, [topic, fallbackMs]);
}

export function formatSupervisionTime(value, now = Date.now()) {
  if (!value) return "";
  const date = new Date(value);
  const diff = now - date.getTime();
  if (diff < 60 * 1000) return "agora";
  if (diff < 60 * 60 * 1000) return `há ${Math.max(1, Math.floor(diff / 60000))} min`;
  const sameDay = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short" });
  const time = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(date);
  if (sameDay.format(date) === sameDay.format(new Date(now))) return time;
  const day = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" }).format(date);
  return `${day} ${time}`;
}

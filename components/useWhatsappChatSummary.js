"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

// Resumo do CHAT (não lidas) + canal de tempo real. O servidor manda um
// "ping" sem dados via Supabase Realtime Broadcast quando algo muda (webhook,
// envio, leitura); ao receber, a tela refaz a busca pela API autenticada.
// Polling lento (30s, só com a aba visível) fica como rede de segurança caso
// o canal caia. onChange é chamado a cada ping/poll para o chamador atualizar
// lista/conversa aberta.
export function useWhatsappChatSummary(onChange) {
  const [summary, setSummary] = useState({ unreadConversations: 0, unreadMessages: 0 });
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const refresh = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    let cancelled = false;
    let channel = null;
    let debounce = null;

    function notify() {
      if (cancelled) return;
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        refresh();
        onChangeRef.current?.();
      }, 250);
    }

    refresh().then((data) => {
      if (cancelled || !data?.topic) return;
      const client = getSupabaseBrowserClient();
      if (!client) return;
      channel = client.channel(data.topic).on("broadcast", { event: "changed" }, notify).subscribe();
    });

    const intervalId = setInterval(() => {
      if (document.visibilityState === "visible") notify();
    }, 30000);
    document.addEventListener("visibilitychange", notify);

    return () => {
      cancelled = true;
      clearTimeout(debounce);
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", notify);
      if (channel) getSupabaseBrowserClient()?.removeChannel(channel);
    };
  }, [refresh]);

  return { summary, refresh };
}

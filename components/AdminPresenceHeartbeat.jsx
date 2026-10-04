"use client";

import { useEffect } from "react";
import { createHeartbeatController } from "@/lib/admin-presence-heartbeat-core.mjs";

// Componente global (montado em app/admin/layout.jsx para TODO usuário
// autenticado) — sem UI própria, sem Realtime.
//
// Regra de presença: só INTERAÇÃO real conta (clique, tecla, rolagem, toque,
// movimento do mouse, carregar/voltar para a página, voltar a internet). NÃO
// existe timer periódico: um CRM aberto e abandonado não gera nenhum sinal,
// então em 5 min sem interagir o usuário passa a "ausente" e o tempo online
// pausa (o cálculo fica em lib/admin-presence.js). Cada sinal vale no máximo
// 1 por minuto, só com a aba visível. A lógica (1/min, checagem de resposta,
// 1 nova tentativa em falha de rede/5xx, nenhuma tentativa em 401) fica em
// lib/admin-presence-heartbeat-core.mjs (testada).
//
// O cliente NUNCA informa quem é: o POST não leva corpo nem id — o servidor
// decide a identidade pela sessão (e, em "Alterar conta", carimba o admin REAL,
// nunca o corretor emulado). A prop `userId` serve só para remontar o efeito
// quando a sessão muda. 401 (sessão expirada): não insiste; a renovação/
// redirecionamento já é feita pelo AdminSessionKeeper.
export default function AdminPresenceHeartbeat({ userId }) {
  useEffect(() => {
    if (!userId) return;

    const controller = createHeartbeatController({
      send: () => fetch("/api/admin/heartbeat", { method: "POST", credentials: "same-origin" }),
      isVisible: () => document.visibilityState === "visible"
    });
    const ping = () => controller.ping();

    ping();

    const interactionEvents = ["pointerdown", "keydown", "scroll", "touchstart", "mousemove", "wheel"];
    const options = { passive: true, capture: true };

    function handleVisibility() {
      if (document.visibilityState === "visible") ping();
    }

    for (const eventName of interactionEvents) window.addEventListener(eventName, ping, options);
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleVisibility);
    // Voltou a internet: tenta de novo (continua valendo 1/min e aba visível).
    window.addEventListener("online", handleVisibility);

    return () => {
      controller.cancel();
      for (const eventName of interactionEvents) window.removeEventListener(eventName, ping, options);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleVisibility);
      window.removeEventListener("online", handleVisibility);
    };
  }, [userId]);

  return null;
}

"use client";

import { useEffect, useRef } from "react";

// Intervalo mínimo entre heartbeats — mesmo com interação contínua, no máximo
// 1 por minuto (evita escritas excessivas).
const MIN_INTERVAL_MS = 60000;

// Componente global (montado em app/admin/layout.jsx para TODO usuário
// autenticado) — sem UI própria, sem Realtime.
//
// Regra de presença: só INTERAÇÃO real conta (clique, tecla, rolagem, toque,
// movimento do mouse, carregar/voltar para a página). NÃO existe timer
// periódico: um CRM aberto e abandonado não gera nenhum sinal, então em 5 min
// sem interagir o usuário passa a "ausente" e o tempo online pausa (o cálculo
// fica em lib/admin-presence.js). Cada sinal vale no máximo 1 por minuto.
export default function AdminPresenceHeartbeat({ userId }) {
  const lastSentRef = useRef(0);
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!userId) return;

    let cancelled = false;

    async function ping() {
      if (cancelled || inFlightRef.current) return;
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastSentRef.current < MIN_INTERVAL_MS) return;

      inFlightRef.current = true;
      lastSentRef.current = now;
      try {
        await fetch("/api/admin/heartbeat", { method: "POST" });
      } catch {
        // Falha de rede pontual — a próxima interação tenta de novo.
      } finally {
        inFlightRef.current = false;
      }
    }

    ping();

    const interactionEvents = ["pointerdown", "keydown", "scroll", "touchstart", "mousemove", "wheel"];
    const options = { passive: true, capture: true };

    function handleVisibility() {
      if (document.visibilityState === "visible") ping();
    }

    for (const eventName of interactionEvents) window.addEventListener(eventName, ping, options);
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleVisibility);

    return () => {
      cancelled = true;
      for (const eventName of interactionEvents) window.removeEventListener(eventName, ping, options);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleVisibility);
    };
  }, [userId]);

  return null;
}

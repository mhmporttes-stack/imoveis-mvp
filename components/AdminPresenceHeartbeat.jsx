"use client";

import { useEffect, useRef } from "react";

// Intervalo mínimo entre heartbeats reais (mesmo com clique/navegação
// contínuos) — evita polling agressivo/writes excessivos. Bem abaixo da
// janela "Online" (5 min) para garantir que quem está de fato usando o CRM
// nunca apareça como ausente por atraso do heartbeat.
const MIN_INTERVAL_MS = 60000;

// Componente global (montado em app/admin/layout.jsx para TODO usuário
// autenticado, não só quem vê a aba Online) — só ele precisa existir para a
// presença funcionar; a leitura/exibição fica isolada em OnlinePresenceBoard.
// Sem UI própria, sem Realtime: um heartbeat simples que só dispara quando
// existe atividade real (carga da página, volta de segundo plano, navegação,
// clique/tecla) ou o timer periódico — nunca por segundo, nunca por clique
// individual (throttle abaixo). Fechar o navegador sem logout simplesmente
// para de gerar heartbeats; o status "offline" vem sozinho pela idade do
// último heartbeat (lib/admin-presence.js), sem depender de nenhum evento de
// saída.
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
        // Falha de rede pontual — o próximo gatilho de atividade tenta de novo.
      } finally {
        inFlightRef.current = false;
      }
    }

    ping();

    function handleVisibility() {
      if (document.visibilityState === "visible") ping();
    }

    const intervalId = setInterval(ping, MIN_INTERVAL_MS);
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleVisibility);
    window.addEventListener("pointerdown", ping, { passive: true });
    window.addEventListener("keydown", ping);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleVisibility);
      window.removeEventListener("pointerdown", ping);
      window.removeEventListener("keydown", ping);
    };
  }, [userId]);

  return null;
}

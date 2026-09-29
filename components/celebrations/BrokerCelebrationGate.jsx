"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence } from "motion/react";
import CelebrationOverlay from "./CelebrationOverlay";

const POLL_INTERVAL_MS = 30 * 1000;
const RETRY_WHEN_BUSY_MS = 15 * 1000;

// Mesma checagem de "não interromper" da Mensagem do Dia (DailyMessageGate).
function hasBlockingUi() {
  if (typeof document === "undefined") return false;
  return Boolean(
    document.querySelector('[aria-modal="true"]') ||
    document.querySelector("dialog[open]") ||
    document.querySelector('[data-daily-message-hold="true"]')
  );
}

// Componente global (montado em app/admin/layout.jsx) — cada corretor só
// recebe os PRÓPRIOS eventos (o back-end já escopa por auth.profile.id).
// Fila local: se dois gatilhos coincidirem, mostra um de cada vez, na ordem
// de prioridade que a API já devolve (meta > ranking > demais).
export default function BrokerCelebrationGate({ userId }) {
  const [queue, setQueue] = useState([]);
  const busyRetryRef = useRef(null);
  const pathname = usePathname();

  const checkPending = useCallback(async () => {
    if (!userId) return;
    try {
      const response = await fetch("/api/celebrations/pending");
      if (!response.ok) return;
      const data = await response.json().catch(() => null);
      if (!data?.ok || !data.pending?.length) return;

      if (hasBlockingUi()) {
        if (busyRetryRef.current) clearTimeout(busyRetryRef.current);
        busyRetryRef.current = setTimeout(checkPending, RETRY_WHEN_BUSY_MS);
        return;
      }

      setQueue((current) => {
        const known = new Set(current.map((item) => item.id));
        const fresh = data.pending.filter((item) => !known.has(item.id));
        return fresh.length ? [...current, ...fresh] : current;
      });
    } catch {
      // Falha pontual de rede — tenta de novo no próximo checkpoint.
    }
  }, [userId]);

  useEffect(() => {
    checkPending();
    const intervalId = setInterval(checkPending, POLL_INTERVAL_MS);
    return () => {
      clearInterval(intervalId);
      if (busyRetryRef.current) clearTimeout(busyRetryRef.current);
    };
  }, [checkPending]);

  // Checkpoint seguro adicional: troca de rota.
  useEffect(() => {
    if (!queue.length) checkPending();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  function handleDismiss() {
    const current = queue[0];
    setQueue((rest) => rest.slice(1));
    if (current) {
      fetch(`/api/celebrations/${current.id}/seen`, { method: "POST" }).catch(() => {});
    }
  }

  const active = queue[0];
  return (
    <AnimatePresence>
      {active ? (
        <CelebrationOverlay
          key={active.id}
          message={active.message}
          animation={active.animation}
          triggerKey={active.trigger_key}
          onDismiss={handleDismiss}
        />
      ) : null}
    </AnimatePresence>
  );
}

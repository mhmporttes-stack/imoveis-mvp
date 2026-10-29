"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence } from "motion/react";
import CelebrationOverlay from "./CelebrationOverlay";
import { useHenryFullscreen } from "@/components/henry/useHenryFullscreen";
import { isPageHidden, onPageVisibilityChange } from "@/components/page-visibility";

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
// userName/userPhotoUrl (opcionais): foto e nome do corretor no anel da cena (sem foto: iniciais).
export default function BrokerCelebrationGate({ userId, userName = "", userPhotoUrl = "" }) {
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
    // Desempenho (2026-10-20): pausa com a aba/app oculto (e com o app de desktop minimizado, 2026-10-23); ao voltar a
    // ficar visível checa na hora.
    const intervalId = setInterval(() => {
      if (!isPageHidden()) checkPending();
    }, POLL_INTERVAL_MS);
    const stopWatchingVisibility = onPageVisibilityChange(() => {
      if (!isPageHidden()) checkPending();
    });
    return () => {
      clearInterval(intervalId);
      stopWatchingVisibility();
      if (busyRetryRef.current) clearTimeout(busyRetryRef.current);
    };
  }, [checkPending]);

  // Checkpoint seguro adicional: troca de rota.
  useEffect(() => {
    if (!queue.length) checkPending();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Tela cheia do Henry aberta (dono, 2026-10-23): a fila fica guardada e a cena só aparece quando ela fechar.
  const henryOpen = useHenryFullscreen({ onClose: checkPending });

  function handleDismiss() {
    const current = queue[0];
    setQueue((rest) => rest.slice(1));
    if (current) {
      fetch(`/api/celebrations/${current.id}/seen`, { method: "POST" }).catch(() => {});
    }
  }

  const active = queue[0];
  if (henryOpen) return null; // sem a saída animada por cima do Henry
  return (
    <AnimatePresence>
      {active ? (
        <CelebrationOverlay
          key={active.id}
          message={active.message}
          animation={active.animation}
          triggerKey={active.trigger_key}
          eventDate={active.event_date}
          userName={userName}
          userPhotoUrl={userPhotoUrl}
          onDismiss={handleDismiss}
        />
      ) : null}
    </AnimatePresence>
  );
}

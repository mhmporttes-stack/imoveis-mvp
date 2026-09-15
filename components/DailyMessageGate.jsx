"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import DailyMessageExperience from "./DailyMessageExperience";

const POLL_INTERVAL_MS = 5 * 60 * 1000;
const RETRY_WHEN_BUSY_MS = 20 * 1000;
const COOLDOWN_BETWEEN_MESSAGES_MS = 900;

// Existe uma pendência para ser mostrada, mas o CRM está em algo que não
// pode ser interrompido: modal aberto (aria-modal, <dialog open>) ou um
// elemento explicitamente marcado com data-daily-message-hold (formulários
// críticos podem usar esse atributo para segurar a experiência até
// terminarem um salvamento/envio). Sem essa infraestrutura em cada
// formulário do CRM hoje, a checagem em pontos seguros — montagem da
// página e troca de rota, nunca no meio de uma digitação — já cobre a
// grande maioria dos casos descritos no item 20.
function hasBlockingUi() {
  if (typeof document === "undefined") return false;
  return Boolean(
    document.querySelector('[aria-modal="true"]') ||
    document.querySelector("dialog[open]") ||
    document.querySelector('[data-daily-message-hold="true"]')
  );
}

// Componente global (montado em app/admin/layout.jsx) — funciona para
// qualquer usuário autenticado do CRM, inclusive quem não tem acesso a
// Gestão > Automações (lá só se configura/dispara; aqui é onde a
// experiência é efetivamente exibida para o destinatário certo).
export default function DailyMessageGate({ userId }) {
  const [pending, setPending] = useState(null);
  const busyRetryRef = useRef(null);
  const pathname = usePathname();

  const checkPending = useCallback(async () => {
    if (!userId) return;
    try {
      const response = await fetch("/api/daily-message/pending");
      if (!response.ok) return;
      const data = await response.json().catch(() => null);
      if (!data?.ok) return;
      if (data.pending) {
        if (hasBlockingUi()) {
          if (busyRetryRef.current) clearTimeout(busyRetryRef.current);
          busyRetryRef.current = setTimeout(checkPending, RETRY_WHEN_BUSY_MS);
          return;
        }
        setPending(data.pending);
      }
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

  // Checkpoint seguro adicional: troca de rota (o usuário concluiu uma
  // navegação, não está no meio de preencher algo).
  useEffect(() => {
    if (!pending) checkPending();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  async function handleComplete() {
    const historyId = pending?.historyId;
    setPending(null);
    if (historyId) {
      try {
        await fetch(`/api/daily-message/${historyId}/complete`, { method: "POST" });
      } catch {
        // Best-effort: se falhar, a próxima checagem de pendência mostra a
        // mesma mensagem de novo (mesmo card, já materializado) em vez de
        // travar o usuário fora do CRM por causa de uma falha de rede.
      }
    }
    setTimeout(checkPending, COOLDOWN_BETWEEN_MESSAGES_MS);
  }

  if (!pending) return null;
  return <DailyMessageExperience card={pending.card} font={pending.card.font} onComplete={handleComplete} />;
}

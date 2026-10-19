"use client";

import { useEffect, useState } from "react";
import Badge from "@/components/ui/Badge";

// Aviso "Cliente transferido para você" da fila de reativação (FUN-15l, dono 2026-10-19): contagem regressiva do prazo
// para mandar a 1ª mensagem; ao vencer (ou se o servidor já devolveu o cliente) vira "Prazo encerrado — o cliente voltou
// para a fila". `reactivation` vem do servidor (attachReactivationNoticeStates, lib/cooled-clients-reactivation.js):
// { state: "pending" | "expired" | "requeued" | "kept", deadlineAt }. "kept" (mandou mensagem / saiu por outro motivo) = nada.
export default function ReactivationNoticeStatus({ reactivation, className = "" }) {
  const deadline = Date.parse(reactivation?.deadlineAt || "");
  const counting = reactivation?.state === "pending" && Number.isFinite(deadline);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!counting) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [counting]);

  if (!reactivation || reactivation.state === "kept") return null;
  const remaining = counting ? Math.max(0, deadline - now) : 0;
  if (counting && remaining > 0) {
    const totalSeconds = Math.ceil(remaining / 1000);
    const clock = `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
    return (
      <Badge tone="warning" className={`whitespace-normal ${className}`}>
        <span role="timer" aria-live="off">Envie uma mensagem em {clock}</span>
      </Badge>
    );
  }
  return (
    <Badge tone="danger" className={`whitespace-normal ${className}`}>
      Prazo encerrado — o cliente voltou para a fila
    </Badge>
  );
}

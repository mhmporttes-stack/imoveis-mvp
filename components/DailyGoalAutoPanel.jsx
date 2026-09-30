"use client";

import { useEffect, useState } from "react";
import { Zap } from "lucide-react";

// Painel de STATUS (somente leitura) da automação da Meta Diária pelo
// WhatsApp individual do corretor. Até 2026-09-30 o corretor podia ligar/
// pausar isso sozinho (botões Automatizar/Pausar/Retomar/Desligar) — pedido
// do dono, 2026-09-30: essa decisão passou a ser só do admin/gestor (aba
// Gestão > Meta Diária > Automação), depois de um caso real (Caroline
// relatou mensagem marcada como "enviada" pela automação que nunca chegou
// no WhatsApp dela de verdade) — o corretor não deve poder ligar algo que
// ainda está sendo estabilizado, nem desligar escondido do gestor. Some da
// tela se a automação nunca foi configurada pro corretor (nada a mostrar).
export default function DailyGoalAutoPanel() {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/daily-goal/auto").then((r) => r.json()).then((data) => { if (!cancelled) setStatus(data); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (!status || !status.enabled) return null;

  return (
    <div className="rounded-2xl border border-line bg-mist/40 px-4 py-3">
      <div className="flex items-center gap-2">
        <Zap className="h-4 w-4 text-brand" aria-hidden="true" />
        <div>
          <p className="text-sm font-black text-navy">Automação da Meta Diária</p>
          <p className="text-[11px] font-bold text-muted">
            {status.paused ? "Pausada pela gestão." : "Manda sozinho a 1ª, 2ª e 3ª tentativa de cada contato pelo seu WhatsApp, dentro do horário configurado pela gestão."}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] font-bold text-muted">
        <span>Enviadas hoje: <strong className="text-navy">{status.sentToday}</strong></span>
        <span>Na fila: <strong className="text-navy">{status.pendingToday}</strong></span>
        <span className={status.sessionConnected ? "text-emerald-700" : "text-red-700"}>
          {status.sessionConnected ? "WhatsApp conectado" : "WhatsApp desconectado — nada será enviado até reconectar"}
        </span>
        {status.paused ? <span className="text-red-700">Pausado: {status.pausedReason}</span> : null}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { LoaderCircle, Pause, Play, Zap } from "lucide-react";

// Painel de opt-in da automação da Meta Diária pelo WhatsApp individual
// (pedido do dono, 2026-09-29): manda sozinho a 1ª mensagem de cada contato
// novo, ao longo do dia, só pela sessão pessoal do corretor (QR code) — os
// follow-ups (2ª/3ª tentativa) continuam manuais. Desligado por padrão.
export default function DailyGoalAutoPanel() {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/daily-goal/auto").then((r) => r.json()).then((data) => { if (!cancelled) setStatus(data); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  async function act(action) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/daily-goal/auto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível atualizar a automação.");
      setStatus(data);
    } catch (actError) {
      setError(actError.message || "Não foi possível atualizar a automação.");
    } finally {
      setBusy(false);
    }
  }

  if (!status) return null;

  return (
    <div className="rounded-2xl border border-line bg-mist/40 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-brand" aria-hidden="true" />
          <div>
            <p className="text-sm font-black text-navy">Automação da Meta Diária</p>
            <p className="text-[11px] font-bold text-muted">Manda sozinho a 1ª, 2ª e 3ª tentativa de cada contato pelo seu WhatsApp, entre 06h30 e 19h.</p>
          </div>
        </div>

        {!status.enabled ? (
          <button type="button" className="premium-button-primary" disabled={busy} onClick={() => act("enable")}>
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />} Automatizar minha meta de hoje
          </button>
        ) : status.paused ? (
          <button type="button" className="premium-button-secondary" disabled={busy} onClick={() => act("resume")}>
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Retomar
          </button>
        ) : (
          <button type="button" className="premium-button-secondary" disabled={busy} onClick={() => act("pause")}>
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Pause className="h-4 w-4" />} Pausar
          </button>
        )}
      </div>

      {status.enabled ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] font-bold text-muted">
          <span>Enviadas hoje: <strong className="text-navy">{status.sentToday}</strong></span>
          <span>Na fila: <strong className="text-navy">{status.pendingToday}</strong></span>
          <span className={status.sessionConnected ? "text-emerald-700" : "text-red-700"}>
            {status.sessionConnected ? "WhatsApp conectado" : "WhatsApp desconectado — nada será enviado até reconectar"}
          </span>
          {status.paused ? <span className="text-red-700">Pausado: {status.pausedReason}</span> : null}
          {status.enabled ? (
            <button type="button" className="text-brand underline-offset-2 hover:underline" disabled={busy} onClick={() => act("disable")}>
              Desligar automação
            </button>
          ) : null}
        </div>
      ) : null}

      {error ? <p className="mt-2 text-[11px] font-bold text-red-700">{error}</p> : null}
    </div>
  );
}

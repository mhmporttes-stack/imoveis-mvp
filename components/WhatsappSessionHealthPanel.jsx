"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, RefreshCw } from "lucide-react";
import Badge from "@/components/ui/Badge";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import { SkeletonList } from "@/components/ui/Skeleton";

// Saúde por número do WhatsApp (WA-21, dono 2026-10-10): status atual, último "conectou", último erro, quedas por dia
// nos últimos 7 dias e fila pendente da Meta Diária. SOMENTE LEITURA — o recorte de equipe é feito no servidor
// (/api/admin/whatsapp-individual/health); a tela só apresenta. Fica na aba Automação da gestão da Meta Diária.
const STATUS = {
  connected: { label: "Conectado", tone: "success" },
  reconnecting: { label: "Reconectando", tone: "warning" },
  connecting: { label: "Conectando", tone: "warning" },
  qr_required: { label: "Aguardando QR", tone: "warning" },
  pairing_code_required: { label: "Aguardando código", tone: "warning" },
  disconnected: { label: "Desconectado", tone: "danger" },
  error: { label: "Parou de reconectar", tone: "danger" }
};
const POLL_MS = 60_000;

const timeFormat = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
const formatWhen = (iso) => (iso ? timeFormat.format(new Date(iso)).replace(",", " às") : "—");
const dayLabel = (day) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

export default function WhatsappSessionHealthPanel() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/whatsapp-individual/health", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Não foi possível carregar a saúde dos números.");
      setData(body);
      setError("");
    } catch (loadError) {
      setError(loadError.message || "Não foi possível carregar a saúde dos números.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, POLL_MS);
    return () => clearInterval(interval);
  }, [load]);

  const rows = data?.rows || [];
  const attention = rows.filter((row) => row.needsAttention).length;

  return (
    <Card as="section" aria-labelledby="wa-health-title" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="wa-health-title" className="flex items-center gap-2 text-base font-semibold text-navy">
            <Activity className="h-4 w-4 text-brand" aria-hidden="true" />Saúde dos números do WhatsApp
          </h2>
          <p className="mt-0.5 text-sm text-ink-2" aria-live="polite">
            {data ? (attention ? `${attention} de ${rows.length} números precisam de atenção.` : `${rows.length} números, nenhum com problema agora.`) : "Quedas dos últimos 7 dias, por número."}
          </p>
        </div>
        <button type="button" onClick={load} disabled={loading} className="inline-flex min-h-touch items-center gap-2 rounded-control border border-line px-3 text-sm font-medium text-navy hover:bg-mist disabled:opacity-60">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true" />Atualizar
        </button>
      </div>

      {error ? <EmptyState tone="danger" title="Não foi possível carregar" description={error} className="py-6" /> : null}
      {!error && !data ? <SkeletonList rows={3} label="Carregando a saúde dos números…" /> : null}
      {!error && data && !rows.length ? <EmptyState icon={Activity} title="Nenhum número conectado ainda" description="Quando um corretor da equipe conectar o WhatsApp, ele aparece aqui." className="py-6" /> : null}

      {rows.length ? (
        <ul className="divide-y divide-line">
          {rows.map((row) => {
            const info = STATUS[row.status] || { label: row.status, tone: "neutral" };
            const max = Math.max(1, ...row.drops.map((item) => item.count));
            return (
              <li key={row.key} className="grid gap-3 py-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_auto] lg:items-center">
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold text-navy">{row.brokerName} <span className="font-normal text-ink-2">· {row.slotName}</span></p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Badge tone={info.tone} dot>{info.label}</Badge>
                    {row.drops24h >= 3 ? <Badge tone="warning">{row.drops24h} quedas em 24 h</Badge> : null}
                  </div>
                  <p className="mt-1 text-xs text-ink-2">Conectou pela última vez: {formatWhen(row.lastConnectedAt)}</p>
                </div>
                <div className="min-w-0 text-xs text-ink-2">
                  <p className="break-words">
                    Último erro: {row.lastErrorLabel || row.lastErrorReason ? [row.lastErrorLabel, row.lastErrorReason].filter(Boolean).join(" · ") : "nenhum"}
                    {row.lastErrorAt && (row.lastErrorLabel || row.lastErrorReason) ? ` (${formatWhen(row.lastErrorAt)})` : ""}
                  </p>
                  <p className="mt-1">Fila da Meta Diária do corretor (todos os números): <span className="font-semibold tabular-nums text-navy">{row.queuePending ?? "—"}</span></p>
                </div>
                <div className="flex items-end gap-1" role="img" aria-label={`Quedas por dia nos últimos 7 dias: ${row.drops.map((item) => `${dayLabel(item.day)}: ${item.count}`).join(", ")}. Total ${row.dropsTotal}.`}>
                  {row.drops.map((item) => (
                    <div key={item.day} className="flex w-7 flex-col items-center gap-0.5">
                      <span className="text-xs font-semibold tabular-nums text-navy">{item.count}</span>
                      <span className={`block w-full rounded-chip ${item.count ? (item.count >= 3 ? "bg-danger-strong" : "bg-warning-strong") : "bg-neutral-soft"}`} style={{ height: `${4 + Math.round((item.count / max) * 20)}px` }} />
                      <span className="text-2xs tabular-nums text-ink-2">{dayLabel(item.day)}</span>
                    </div>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </Card>
  );
}

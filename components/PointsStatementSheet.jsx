"use client";

import { useEffect, useState } from "react";
import Sheet from "@/components/ui/Sheet";

// Extrato dos pontos de UM corretor no período da tela (Meta Diária da equipe). Só apresenta o que a API
// (/api/daily-goal/team-overview/[id]/points-statement) devolve; nenhuma fórmula de pontuação aqui.
// `statement`/`initialError` existem só para a vitrine de design (sem rede).
export default function PointsStatementSheet({ broker, period, periodLabel = "", expectedPoints = null, onClose, statement: preset = null, initialError = "" }) {
  const [statement, setStatement] = useState(preset);
  const [error, setError] = useState(initialError);
  const [loading, setLoading] = useState(!preset && !initialError);

  useEffect(() => {
    if (preset || initialError || !broker?.brokerId) return undefined;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setStatement(null);
    fetch(`/api/daily-goal/team-overview/${encodeURIComponent(broker.brokerId)}/points-statement?period=${encodeURIComponent(period)}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.error || "Não foi possível carregar o extrato.");
        setStatement(payload.statement);
      })
      .catch((requestError) => {
        if (requestError.name !== "AbortError") setError(requestError.message || "Não foi possível carregar o extrato.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [broker?.brokerId, period, preset, initialError]);

  const mismatch = statement && Number.isFinite(expectedPoints) && statement.total !== expectedPoints;

  return (
    <Sheet
      open
      onClose={onClose}
      title={`Extrato dos pontos — ${broker?.name || "Corretor"}`}
      description={periodLabel ? `Período: ${periodLabel}${statement?.range?.label && statement.range.label.toLowerCase() !== periodLabel.toLowerCase() ? ` · ${statement.range.label}` : ""}` : ""}
    >
      {loading ? <p className="py-6 text-center text-sm font-bold text-muted">Carregando extrato…</p> : null}
      {error ? <p className="rounded-control border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p> : null}

      {statement ? (
        <div className="space-y-4">
          <div className="flex items-baseline justify-between gap-3 rounded-control bg-blue-50 px-4 py-3">
            <span className="text-sm font-extrabold text-navy">Total do período</span>
            <span className="text-2xl font-black text-brand" data-testid="statement-total">{statement.total} pts</span>
          </div>
          {mismatch ? (
            <p className="rounded-control border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-800">
              O selo mostra {expectedPoints} pts e o extrato soma {statement.total} pts. Isso acontece se algo mudou há instantes: feche e abra de novo.
            </p>
          ) : null}

          {!statement.lines.length ? (
            <p className="py-6 text-center text-sm font-bold text-muted">Nenhum lançamento de pontos neste período.</p>
          ) : null}

          {statement.days.map((day) => (
            <section key={day.day} aria-label={day.label}>
              <h3 className="flex items-baseline justify-between border-b border-line pb-1 text-xs font-black uppercase tracking-wide text-muted">
                <span>{day.label}</span>
                <span className={day.total < 0 ? "text-red-700" : "text-navy"}>{formatPoints(day.total)} pts no dia</span>
              </h3>
              <ul className="divide-y divide-line">
                {day.lines.map((line) => (
                  <li key={line.id} className="flex items-start gap-3 py-2.5">
                    <span className="w-11 shrink-0 pt-0.5 text-xs font-bold tabular-nums text-muted">{line.time}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-extrabold text-navy [overflow-wrap:anywhere]">{line.label}</p>
                      <p className="mt-0.5 text-xs font-semibold text-ink-2 [overflow-wrap:anywhere]">
                        {line.category}
                        {line.person ? ` · ${line.person}` : ""}
                      </p>
                      {line.note ? (
                        <p className={`mt-1 text-xs font-semibold [overflow-wrap:anywhere] ${line.kind === "manual_adjustment" ? "rounded-control bg-amber-50 px-2 py-1 text-amber-900" : "text-muted"}`}>
                          {line.kind === "manual_adjustment" ? `Nota: ${line.note}` : line.note}
                        </p>
                      ) : null}
                    </div>
                    <span className={`shrink-0 text-sm font-black tabular-nums ${line.points > 0 ? "text-emerald-700" : line.points < 0 ? "text-red-700" : "text-muted"}`}>
                      {formatPoints(line.points)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {statement.truncated ? (
            <p className="rounded-control bg-mist p-3 text-xs font-bold text-muted">
              Mostrando os {statement.shownCount} lançamentos mais recentes. Outros {statement.hiddenCount} lançamentos mais antigos ({formatPoints(statement.hiddenPoints)} pts) estão somados no total acima.
            </p>
          ) : null}
        </div>
      ) : null}
    </Sheet>
  );
}

function formatPoints(value) {
  const number = Number(value) || 0;
  return number > 0 ? `+${number}` : String(number);
}

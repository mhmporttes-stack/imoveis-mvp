"use client";

import { useEffect, useState } from "react";

// Rótulos/agrupamento só para EXIBIÇÃO — espelham METRIC_GROUPS/METRIC_META
// de lib/attendance-audit.js (server-only, não pode ser importado aqui).
// Qualquer métrica nova precisa ser adicionada nos dois lugares.
const METRIC_GROUPS = [
  { key: "volume", label: "VOLUME", items: ["clientsAttended", "conversations", "messagesSent", "messagesReceived"] },
  { key: "prospeccao", label: "PROSPECÇÃO", items: ["prospecting", "prospectingResponded", "prospectingResponseRate"] },
  { key: "conversao", label: "CONVERSÃO", items: ["service", "simulation", "documentation", "approvalPending", "approval", "meeting", "sale", "conversionProspectToSale"] },
  { key: "velocidade", label: "VELOCIDADE", items: ["firstResponseMinutes", "avgResponseMinutes", "medianResponseMinutes"] },
  { key: "followup", label: "FOLLOW-UP", items: ["completedActivities", "awaitingAction", "noFutureActivity", "conversationsWithoutContinuity"] }
];

const METRIC_LABELS = {
  clientsAttended: "Clientes atendidos", conversations: "Conversas", messagesSent: "Mensagens enviadas", messagesReceived: "Mensagens recebidas",
  prospecting: "Prospecções", prospectingResponded: "Respostas às prospecções", prospectingResponseRate: "Taxa de resposta",
  service: "Atendimentos", simulation: "Simulações", documentation: "Documentação", approvalPending: "Aguardando aprovação",
  approval: "Aprovações", meeting: "Reuniões", sale: "Vendas", conversionProspectToSale: "Conversão Prospecção → Venda",
  firstResponseMinutes: "Primeira resposta", avgResponseMinutes: "Tempo médio de resposta", medianResponseMinutes: "Tempo mediano de resposta",
  completedActivities: "Atividades/follow-ups", awaitingAction: "Aguardando ação", noFutureActivity: "Sem atividade futura", conversationsWithoutContinuity: "Sem continuidade"
};

const PERCENT_KEYS = new Set(["prospectingResponseRate", "conversionProspectToSale"]);
const MINUTE_KEYS = new Set(["firstResponseMinutes", "avgResponseMinutes", "medianResponseMinutes"]);

function formatMetricValue(key, value) {
  if (value === null || value === undefined) return "—";
  if (PERCENT_KEYS.has(key)) return `${value.toFixed(1)}%`;
  if (MINUTE_KEYS.has(key)) return value >= 60 ? `${Math.floor(value / 60)}h${String(Math.round(value % 60)).padStart(2, "0")}` : `${Math.round(value)}m`;
  return new Intl.NumberFormat("pt-BR").format(value);
}

const STATUS_STYLE = {
  melhorou: "bg-emerald-50 text-emerald-700 border-emerald-200",
  piorou: "bg-red-50 text-red-700 border-red-200",
  manteve: "bg-slate-50 text-slate-600 border-slate-200",
  sem_dado_anterior: "bg-slate-50 text-slate-400 border-slate-200"
};
const STATUS_LABEL = { melhorou: "melhorou", piorou: "piorou", manteve: "manteve", sem_dado_anterior: "—" };

function todayPlainDate() {
  return new Date().toISOString().slice(0, 10);
}

export default function AttendanceAuditDashboard({ brokers }) {
  const [brokerId, setBrokerId] = useState(brokers[0]?.id || "");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState(todayPlainDate());
  const [history, setHistory] = useState([]);
  const [result, setResult] = useState(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!brokerId) return;
    let active = true;
    setLoadingHistory(true);
    setResult(null);
    fetch(`/api/admin/desempenho/auditoria?brokerId=${encodeURIComponent(brokerId)}`)
      .then((response) => response.json())
      .then((payload) => {
        if (!active) return;
        setHistory(payload.history || []);
        if (payload.suggestedRange) {
          setStartDate(payload.suggestedRange.startDate);
          setEndDate(payload.suggestedRange.endDate);
        }
      })
      .catch(() => active && setHistory([]))
      .finally(() => active && setLoadingHistory(false));
    return () => { active = false; };
  }, [brokerId]);

  async function handleGenerate() {
    if (!brokerId || !startDate || !endDate) return;
    setGenerating(true);
    setError("");
    try {
      const response = await fetch("/api/admin/desempenho/auditoria", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brokerId, startDate, endDate })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Não foi possível gerar a auditoria.");
      setResult(payload.audit);
      setHistory((current) => [payload.audit, ...current]);
    } catch (auditError) {
      setError(auditError.message || "Não foi possível gerar a auditoria.");
    } finally {
      setGenerating(false);
    }
  }

  const brokerName = brokers.find((broker) => broker.id === brokerId)?.name || "";

  return (
    <section className="container-page space-y-6">
      <div className="rounded-3xl border border-navy/[0.08] bg-white p-6 shadow-[0_1px_2px_rgba(13,59,102,0.04)]">
        <div className="grid gap-4 md:grid-cols-[2fr_1fr_1fr_auto] md:items-end">
          <label className="block">
            <span className="mb-1 block text-xs font-black uppercase tracking-wide text-muted">Corretor</span>
            <select value={brokerId} onChange={(event) => setBrokerId(event.target.value)} className="w-full rounded-xl border border-navy/15 px-3 py-2.5 text-sm font-bold text-navy">
              {brokers.map((broker) => <option key={broker.id} value={broker.id}>{broker.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-black uppercase tracking-wide text-muted">Data inicial</span>
            <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="w-full rounded-xl border border-navy/15 px-3 py-2.5 text-sm font-bold text-navy" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-black uppercase tracking-wide text-muted">Data final</span>
            <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="w-full rounded-xl border border-navy/15 px-3 py-2.5 text-sm font-bold text-navy" />
          </label>
          <button type="button" onClick={handleGenerate} disabled={generating || !brokerId} className="rounded-full bg-brand px-6 py-2.5 text-sm font-black text-white transition hover:-translate-y-0.5 hover:shadow-soft disabled:opacity-50">
            {generating ? "Gerando…" : "Gerar auditoria"}
          </button>
        </div>
        {error ? <p className="mt-3 text-sm font-bold text-red-600">{error}</p> : null}
      </div>

      {result ? <AuditResult result={result} brokerName={result.brokerName || brokerName} /> : null}

      <div className="rounded-3xl border border-navy/[0.08] bg-white p-6 shadow-[0_1px_2px_rgba(13,59,102,0.04)]">
        <h2 className="text-lg font-black text-navy">Histórico de auditorias</h2>
        {loadingHistory ? <p className="mt-3 text-sm text-muted">Carregando…</p> : null}
        {!loadingHistory && !history.length ? <p className="mt-3 text-sm text-muted">Nenhuma auditoria gerada ainda para este corretor.</p> : null}
        <ul className="mt-4 divide-y divide-navy/[0.06]">
          {history.map((audit) => (
            <li key={audit.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <span className="text-sm font-bold text-navy">{formatBR(audit.periodStart)} a {formatBR(audit.periodEnd)}</span>
              <span className="text-xs text-muted">Gerada em {formatBR(audit.generatedAt?.slice(0, 10))}</span>
              <button type="button" onClick={() => setResult(audit)} className="rounded-full border border-brand/30 px-4 py-1.5 text-xs font-black text-brand hover:bg-brand/5">
                Ver relatório
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function formatBR(plainDate) {
  if (!plainDate) return "—";
  const [year, month, day] = plainDate.split("-");
  return `${day}/${month}/${year}`;
}

function AuditResult({ result, brokerName }) {
  const comparisonByKey = new Map((result.comparison || []).map((entry) => [entry.key, entry]));
  const ai = result.aiResult || {};

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-navy/[0.08] bg-white p-6 shadow-[0_1px_2px_rgba(13,59,102,0.04)]">
        <h2 className="text-xl font-black text-navy">{brokerName} — {formatBR(result.periodStart)} a {formatBR(result.periodEnd)}</h2>
        {ai.resumo ? <p className="mt-2 text-sm leading-6 text-slate">{ai.resumo}</p> : null}
      </div>

      {METRIC_GROUPS.map((group) => (
        <div key={group.key} className="rounded-3xl border border-navy/[0.08] bg-white p-6 shadow-[0_1px_2px_rgba(13,59,102,0.04)]">
          <h3 className="text-sm font-black uppercase tracking-[0.14em] text-brand">{group.label}</h3>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {group.items.map((key) => {
              const comparison = comparisonByKey.get(key);
              return (
                <div key={key} className="rounded-2xl border border-navy/[0.06] bg-mist/40 p-3">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-muted">{METRIC_LABELS[key]}</p>
                  <p className="mt-1 text-2xl font-black text-navy">{formatMetricValue(key, result.metrics?.[key])}</p>
                  {comparison ? (
                    <p className={`mt-1 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-black ${STATUS_STYLE[comparison.status]}`}>
                      {comparison.previousValue != null ? formatMetricValue(key, comparison.previousValue) : "—"} → {STATUS_LABEL[comparison.status]}
                      {comparison.changePercent != null ? ` (${comparison.changePercent > 0 ? "+" : ""}${comparison.changePercent.toFixed(0)}%)` : ""}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div className="rounded-3xl border border-navy/[0.08] bg-white p-6 shadow-[0_1px_2px_rgba(13,59,102,0.04)]">
        <h3 className="text-sm font-black uppercase tracking-[0.14em] text-brand">QUALIDADE</h3>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <QualityList title="Pontos fortes" items={ai.pontosFortes} tone="text-emerald-700" />
          <QualityList title="Pontos fracos" items={ai.pontosFracos} tone="text-amber-700" />
          <EvidenceList title="Erros encontrados" items={ai.erros} evidenceIndex={result.evidenceIndex} tone="text-red-700" />
          <EvidenceList title="Oportunidades perdidas" items={ai.oportunidadesPerdidas} evidenceIndex={result.evidenceIndex} tone="text-red-700" />
          <QualityList title="Recomendações" items={ai.recomendacoes} tone="text-navy" />
          <QualityList title="Prioridades de melhoria" items={ai.prioridadesMelhoria} tone="text-navy" />
        </div>
        {ai.cruzamentoQualidadeResultado?.length ? (
          <div className="mt-4 border-t border-navy/[0.06] pt-4">
            <p className="text-xs font-black uppercase tracking-wide text-muted">Qualidade × resultado (indicadores observados, não causalidade)</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate">
              {ai.cruzamentoQualidadeResultado.map((item, index) => <li key={index}>{item}</li>)}
            </ul>
          </div>
        ) : null}
      </div>

      {ai.comparacaoQualitativa && (ai.comparacaoQualitativa.evoluiu?.length || ai.comparacaoQualitativa.piorou?.length || ai.comparacaoQualitativa.novaPrioridade) ? (
        <div className="rounded-3xl border border-navy/[0.08] bg-white p-6 shadow-[0_1px_2px_rgba(13,59,102,0.04)]">
          <h3 className="text-sm font-black uppercase tracking-[0.14em] text-brand">Comparação com a auditoria anterior</h3>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <QualityList title="Evoluiu" items={ai.comparacaoQualitativa.evoluiu} tone="text-emerald-700" />
            <QualityList title="Piorou" items={ai.comparacaoQualitativa.piorou} tone="text-red-700" />
            <QualityList title="Permanece" items={ai.comparacaoQualitativa.permanece} tone="text-slate-600" />
            <QualityList title="Problemas corrigidos" items={ai.comparacaoQualitativa.problemasCorrigidos} tone="text-emerald-700" />
            <QualityList title="Problemas recorrentes" items={ai.comparacaoQualitativa.problemasRecorrentes} tone="text-amber-700" />
          </div>
          {ai.comparacaoQualitativa.novaPrioridade ? <p className="mt-4 text-sm font-bold text-navy">Nova prioridade de treinamento: {ai.comparacaoQualitativa.novaPrioridade}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function QualityList({ title, items, tone }) {
  if (!items?.length) return null;
  return (
    <div>
      <p className={`text-xs font-black uppercase tracking-wide ${tone}`}>{title}</p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate">
        {items.map((item, index) => <li key={index}>{item}</li>)}
      </ul>
    </div>
  );
}

function EvidenceList({ title, items, evidenceIndex, tone }) {
  if (!items?.length) return null;
  return (
    <div>
      <p className={`text-xs font-black uppercase tracking-wide ${tone}`}>{title}</p>
      <ul className="mt-2 space-y-2 text-sm text-slate">
        {items.map((item, index) => {
          const evidence = evidenceIndex?.[item.conversationId];
          return (
            <li key={index} className="flex flex-wrap items-center gap-2">
              <span>{item.descricao}</span>
              {evidence?.clientId ? (
                <a href={`/admin/chat?client=${encodeURIComponent(evidence.clientId)}`} target="_blank" rel="noreferrer" className="rounded-full border border-brand/30 px-2 py-0.5 text-[10px] font-black text-brand hover:bg-brand/5">
                  Ver conversa
                </a>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

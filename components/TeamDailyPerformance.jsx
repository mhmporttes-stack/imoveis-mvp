"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import Avatar from "@/components/Avatar";

const PERIODS = [
  { value: "today", label: "Hoje" },
  { value: "yesterday", label: "Ontem" },
  { value: "last7", label: "7 dias" },
  { value: "last30", label: "30 dias" }
];

const RADIUS = 40;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function progressColor(percent) {
  if (percent >= 100) return { stroke: "#059669", text: "text-emerald-600" };
  if (percent >= 50) return { stroke: "#ea580c", text: "text-orange-600" };
  return { stroke: "#dc2626", text: "text-red-600" };
}

// Painel gerencial exclusivo do administrador principal — visão consolidada
// da equipe na Meta Diária. Reaproveita a mesma rota /admin/meta-diaria; o
// corretor continua vendo o componente DailyGoalDashboard, intocado.
export default function TeamDailyPerformance({ initialOverview, initialError = "" }) {
  const [period, setPeriod] = useState(initialOverview?.range?.period || "today");
  const [overview, setOverview] = useState(initialOverview);
  const [error, setError] = useState(initialError);
  const [loading, setLoading] = useState(false);
  const [selectedBrokerId, setSelectedBrokerId] = useState("");
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");

    fetch(`/api/daily-goal/team-overview?period=${period}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error || "Não foi possível carregar o painel.");
        setOverview(payload);
      })
      .catch((requestError) => {
        if (requestError.name !== "AbortError") setError(requestError.message || "Não foi possível carregar o painel.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [period]);

  return (
    <section className="container-page space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {PERIODS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setPeriod(option.value)}
            className={`min-h-10 rounded-full border px-4 text-sm font-extrabold transition ${
              period === option.value ? "border-brand bg-blue-50 text-brand" : "border-navy/10 bg-white text-navy hover:border-brand"
            }`}
          >
            {option.label}
          </button>
        ))}
        {loading ? <span className="text-xs font-bold text-muted">Atualizando…</span> : null}
      </div>

      {error ? <div className="rounded-3xl border border-red-200 bg-red-50 p-5 text-sm font-bold text-red-700">{error}</div> : null}

      {overview ? (
        <>
          <TeamSummary summary={overview.summary} />

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {overview.brokers.map((broker) => (
              <BrokerCard key={broker.brokerId} broker={broker} onClick={() => setSelectedBrokerId(broker.brokerId)} />
            ))}
          </div>

          {!overview.brokers.length ? (
            <p className="rounded-[24px] border border-line bg-white p-8 text-center font-bold text-muted shadow-soft">
              Nenhum corretor ativo com Meta Diária no período selecionado.
            </p>
          ) : null}
        </>
      ) : null}

      {selectedBrokerId ? (
        <BrokerDetailDrawer brokerId={selectedBrokerId} period={period} onClose={() => setSelectedBrokerId("")} />
      ) : null}
    </section>
  );
}

function TeamSummary({ summary }) {
  const items = [
    { label: "Meta da equipe", value: formatPercent(summary.metaPercent) },
    { label: "Atividades", value: `${summary.atividadesDone} / ${summary.atividadesTotal}` },
    { label: "Contatos", value: summary.contatos },
    { label: "Atendimentos", value: summary.atendimentos },
    { label: "Simulações", value: summary.simulacoes }
  ];

  return (
    <div className="grid grid-cols-2 gap-2.5 rounded-[24px] border border-navy/10 bg-white p-5 shadow-soft sm:grid-cols-3 lg:grid-cols-5">
      {items.map((item) => (
        <div key={item.label} className="rounded-2xl bg-mist/40 px-3 py-3 text-center">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-muted">{item.label}</p>
          <p className="mt-1 text-xl font-black text-navy">{item.value}</p>
        </div>
      ))}
    </div>
  );
}

function BrokerCard({ broker, onClick }) {
  const colors = progressColor(broker.meta.percent);

  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-[22px] border border-line bg-white p-5 text-left shadow-[0_12px_30px_rgba(13,59,102,0.06)] transition hover:-translate-y-0.5 hover:border-brand/40"
    >
      <div className="flex items-center gap-3">
        <Avatar name={broker.name} photoUrl={broker.photoUrl} size={44} />
        <h3 className="min-w-0 truncate text-base font-black text-navy">{broker.name}</h3>
      </div>

      <div className="mt-4 flex items-center justify-center">
        <div className="relative h-24 w-24 motion-reduce:[&_circle]:!transition-none">
          <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
            <circle cx="50" cy="50" r={RADIUS} fill="none" stroke="#E5EAF1" strokeWidth="8" />
            <circle
              cx="50" cy="50" r={RADIUS} fill="none"
              stroke={colors.stroke} strokeWidth="8" strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={CIRCUMFERENCE * (1 - Math.min(100, broker.meta.percent) / 100)}
              style={{ transition: "stroke-dashoffset 0.7s ease-out, stroke 0.4s ease-out" }}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className={`text-xl font-black ${colors.text}`}>{broker.meta.percent}%</span>
          </div>
        </div>
      </div>

      <p className="mt-2 text-center text-xs font-bold text-muted">
        {broker.meta.done} / {broker.meta.total} atividades
      </p>

      {broker.wallet ? (
        <p className={`mt-2 text-center text-xs font-extrabold ${broker.wallet.atLimit ? "text-red-600" : "text-muted"}`}>
          Carteira ativa {broker.wallet.current}/{broker.wallet.limit}
          <span className="ml-1 font-bold text-muted">(1ª:{broker.wallet.byAttempt.first} · 2ª:{broker.wallet.byAttempt.second} · 3ª:{broker.wallet.byAttempt.third})</span>
        </p>
      ) : null}

      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <MiniStat label="Contatos" value={broker.funnel.contatos} />
        <MiniStat label="Atend." value={broker.funnel.atendimentos} />
        <MiniStat label="Simul." value={broker.funnel.simulacoes} />
      </div>

      <p className="mt-3 text-center text-xs font-extrabold uppercase tracking-[0.08em] text-brand">
        Conversão {formatRate(broker.conversao)}
      </p>
    </button>
  );
}

function MiniStat({ label, value }) {
  return (
    <div>
      <p className="text-[10px] font-extrabold uppercase tracking-[0.06em] text-muted">{label}</p>
      <p className="text-sm font-black text-navy">{value}</p>
    </div>
  );
}

function BrokerDetailDrawer({ brokerId, period, onClose }) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setDetail(null);
    setError("");

    fetch(`/api/daily-goal/team-overview/${brokerId}?period=${period}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error || "Não foi possível carregar o detalhamento.");
        setDetail(payload);
      })
      .catch((requestError) => {
        if (requestError.name !== "AbortError") setError(requestError.message || "Não foi possível carregar o detalhamento.");
      });

    return () => controller.abort();
  }, [brokerId, period]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-navy/40 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-[28px] bg-white p-6 shadow-2xl sm:rounded-[28px]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm font-black uppercase tracking-[0.14em] text-brand">Desempenho de hoje</p>
          <button type="button" onClick={onClose} className="icon-button" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>

        {error ? <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</p> : null}

        {!detail && !error ? <p className="text-sm font-bold text-muted">Carregando…</p> : null}

        {detail ? (
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <Avatar name={detail.broker.name} photoUrl={detail.broker.photoUrl} size={56} />
              <div>
                <h3 className="text-xl font-black text-navy">{detail.broker.name}</h3>
                <p className="text-sm font-bold text-muted">Meta: {detail.broker.meta.done} / {detail.broker.meta.total} ({formatPercent(detail.broker.meta.percent)})</p>
              </div>
            </div>

            <div>
              <h4 className="mb-3 text-xs font-black uppercase tracking-[0.14em] text-navy">Contatos por tentativa</h4>
              <AttemptBreakdown porMensagem={detail.broker.porMensagem} totalContatos={detail.broker.funnel.contatos} />
            </div>

            <div>
              <h4 className="mb-3 text-xs font-black uppercase tracking-[0.14em] text-navy">Funil do dia</h4>
              <FunnelStep label="Contatos realizados" value={detail.broker.funnel.contatos} />
              <FunnelArrow rate={detail.broker.funnel.taxaAtendimento} />
              <FunnelStep label="Atendimentos" value={detail.broker.funnel.atendimentos} />
              <FunnelArrow rate={detail.broker.funnel.taxaSimulacao} />
              <FunnelStep label="Simulações" value={detail.broker.funnel.simulacoes} />
            </div>

            <div>
              <h4 className="mb-3 text-xs font-black uppercase tracking-[0.14em] text-navy">Média da equipe</h4>
              <div className="grid gap-2.5 sm:grid-cols-3">
                <CompareRow label="Taxa de atendimento" brokerValue={detail.broker.funnel.taxaAtendimento} teamValue={detail.teamRates.taxaAtendimento} />
                <CompareRow label="Taxa de simulação" brokerValue={detail.broker.funnel.taxaSimulacao} teamValue={detail.teamRates.taxaSimulacao} />
                <CompareRow label="Conversão" brokerValue={detail.broker.conversao} teamValue={detail.teamRates.conversao} />
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

const ATTEMPT_LABELS = { 1: "1ª tentativa", 2: "2ª tentativa", 3: "3ª tentativa" };

// Reaproveita porMensagem, já calculado no backend (getDailyGoalPerformance)
// a partir de daily_goal_attempts — respeita o mesmo período selecionado no
// topo da tela (Hoje/Ontem/7 dias/30 dias), sem cálculo próprio aqui.
function AttemptBreakdown({ porMensagem, totalContatos }) {
  const attempts = [1, 2, 3].map((number) => ({ number, ...(porMensagem?.[number] || { abordados: 0, convertidos: 0 }) }));
  const abordadosSoma = attempts.reduce((sum, item) => sum + item.abordados, 0);
  // Contatos via Prospecção manual (fora da cadência estruturada de 3
  // tentativas) também entram em "Contatos realizados" — mostrados à parte
  // para o total continuar batendo com o funil abaixo.
  const manualProspeccao = Math.max(0, (totalContatos || 0) - abordadosSoma);

  return (
    <div className="space-y-2">
      {attempts.map((attempt) => (
        <div key={attempt.number} className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-mist/40 px-4 py-3">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.06em] text-muted">{ATTEMPT_LABELS[attempt.number]}</p>
            <p className="text-lg font-black text-navy">{attempt.abordados} contatos</p>
          </div>
          <div className="text-right">
            <p className="text-xs font-extrabold uppercase tracking-[0.06em] text-muted">Conversão</p>
            <p className="text-sm font-black text-brand">{attempt.convertidos} ({formatRate(attempt.abordados ? attempt.convertidos / attempt.abordados : null)})</p>
          </div>
        </div>
      ))}
      {manualProspeccao > 0 ? (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-white px-4 py-3">
          <p className="text-xs font-extrabold uppercase tracking-[0.06em] text-muted">Prospecção manual (fora da cadência)</p>
          <p className="text-lg font-black text-navy">{manualProspeccao}</p>
        </div>
      ) : null}
    </div>
  );
}

function FunnelStep({ label, value }) {
  return (
    <div className="rounded-2xl border border-line bg-mist/40 px-4 py-3">
      <p className="text-xs font-extrabold uppercase tracking-[0.06em] text-muted">{label}</p>
      <p className="text-2xl font-black text-navy">{value}</p>
    </div>
  );
}

function FunnelArrow({ rate }) {
  return (
    <div className="flex items-center gap-2 px-4 py-1 text-xs font-black text-brand">
      <span>↓</span>
      <span>{formatRate(rate)}</span>
    </div>
  );
}

function CompareRow({ label, brokerValue, teamValue }) {
  return (
    <div className="rounded-2xl border border-line bg-white px-3 py-2.5 text-center shadow-[0_6px_16px_rgba(13,59,102,0.05)]">
      <p className="text-[10px] font-extrabold uppercase tracking-[0.06em] text-muted">{label}</p>
      <p className="mt-1 text-sm font-black text-navy">{formatRate(brokerValue)}</p>
      <p className="text-[11px] font-bold text-muted">Equipe {formatRate(teamValue)}</p>
    </div>
  );
}

function formatPercent(value) {
  const number = Number(value);
  return `${Number.isFinite(number) ? number : 0}%`;
}

// Protege contra divisão por zero: valor nulo (denominador zero) vira "—",
// nunca NaN/Infinity.
function formatRate(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 }).format(value);
}

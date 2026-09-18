"use client";

import { useEffect, useState } from "react";
import { Save } from "lucide-react";

const TABS = [
  { key: "config", label: "Configurações" },
  { key: "messages", label: "Mensagens" },
  { key: "performance", label: "Desempenho" }
];

const MESSAGE_FIELDS = [
  { key: "message1", label: "Mensagem 1 — Primeiro contato" },
  { key: "message2", label: "Mensagem 2 — Pós-atendimento" },
  { key: "message3", label: "Mensagem 3 — Última tentativa" }
];

export default function DailyGoalAdmin({ initialSettings }) {
  const [tab, setTab] = useState("config");
  const [settings, setSettings] = useState(initialSettings);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <section className="container-page space-y-6">
      <div className="mx-auto flex w-full max-w-xl flex-wrap justify-center rounded-2xl border border-navy/[0.07] bg-white p-0.5 shadow-[0_1px_2px_rgba(13,59,102,0.04)]">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={`min-w-[110px] flex-1 rounded-xl px-4 py-2 text-center text-[13px] font-extrabold transition duration-200 ${
              tab === item.key ? "bg-navy text-white shadow-soft" : "text-navy hover:bg-brand/10 hover:text-brand"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {feedback ? <p role="status" className="rounded-2xl border border-line bg-white px-4 py-3 text-sm font-bold text-navy">{feedback}</p> : null}

      {tab === "config" ? (
        <ConfigTab settings={settings} setSettings={setSettings} busy={busy} setBusy={setBusy} setFeedback={setFeedback} />
      ) : null}
      {tab === "messages" ? (
        <MessagesTab settings={settings} setSettings={setSettings} busy={busy} setBusy={setBusy} setFeedback={setFeedback} />
      ) : null}
      {tab === "performance" ? <PerformanceTab /> : null}
    </section>
  );
}

async function saveSettings(payload, setBusy, setFeedback, setSettings) {
  setBusy(true);
  setFeedback("");
  try {
    const response = await fetch("/api/daily-goal/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    setSettings(data);
    setFeedback("Configurações salvas.");
  } catch (error) {
    setFeedback(error.message || "Não foi possível salvar.");
  } finally {
    setBusy(false);
  }
}

function ConfigTab({ settings, setSettings, busy, setBusy, setFeedback }) {
  const [quota, setQuota] = useState(settings?.quota || 30);
  const [walletLimit, setWalletLimit] = useState(settings?.wallet?.walletLimit ?? 100);
  const [blockOnLimit, setBlockOnLimit] = useState(settings?.wallet?.blockOnLimit ?? true);

  return (
    <div className="space-y-6">
      <div className="rounded-[28px] border border-line bg-white p-6 shadow-soft md:p-8">
        <h2 className="text-xl font-black text-navy">Novos clientes por corretor/dia</h2>
        <p className="mt-1 text-sm font-bold text-muted">Padrão: 30. Alterar aqui só afeta as próximas gerações de Meta Diária.</p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="text-sm font-black text-navy">
            Quantidade diária
            <input
              className="mt-2 h-12 w-40 rounded-2xl border border-line bg-white px-4 font-bold text-navy outline-none focus:border-brand"
              max={500}
              min={1}
              onChange={(event) => setQuota(event.target.value)}
              type="number"
              value={quota}
            />
          </label>
          <button
            className="premium-button-primary"
            disabled={busy}
            onClick={() => saveSettings({ quota: Number(quota) }, setBusy, setFeedback, setSettings)}
            type="button"
          >
            <Save className="h-4 w-4" /> Salvar
          </button>
        </div>
        <div className="mt-6 rounded-2xl border border-line bg-mist/40 p-4">
          <p className="text-sm font-black text-navy">Retorno à fila após: 30 dias</p>
          <p className="mt-1 text-sm font-bold text-muted">
            Reaproveita a mesma trava de 30 dias já usada na fila de Prospecção — um cliente que completa a cadência
            sem conversão só volta a ficar disponível (no final da fila) depois desse período.
          </p>
        </div>
      </div>

      <div className="rounded-[28px] border border-line bg-white p-6 shadow-soft md:p-8">
        <h2 className="text-xl font-black text-navy">Carteira ativa</h2>
        <p className="mt-1 text-sm font-bold text-muted">
          Total de clientes que um corretor pode ter aguardando 1ª, 2ª e 3ª tentativa AO MESMO TEMPO (soma das três
          etapas). A distribuição diária nunca ultrapassa o espaço disponível: novos clientes = mínimo entre a cota
          diária e (limite − carteira ativa atual).
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="text-sm font-black text-navy">
            Limite máximo da carteira ativa
            <input
              className="mt-2 h-12 w-40 rounded-2xl border border-line bg-white px-4 font-bold text-navy outline-none focus:border-brand"
              max={5000}
              min={1}
              onChange={(event) => setWalletLimit(event.target.value)}
              type="number"
              value={walletLimit}
            />
          </label>
          <label className="flex items-center gap-2 text-sm font-black text-navy">
            <input checked={blockOnLimit} onChange={(event) => setBlockOnLimit(event.target.checked)} type="checkbox" />
            Bloquear novas prospecções ao atingir o limite
          </label>
          <button
            className="premium-button-primary"
            disabled={busy}
            onClick={() => saveSettings({ wallet: { walletLimit: Number(walletLimit), blockOnLimit } }, setBusy, setFeedback, setSettings)}
            type="button"
          >
            <Save className="h-4 w-4" /> Salvar
          </button>
        </div>
        <p className="mt-4 text-xs font-bold text-muted">
          Com o bloqueio desligado, a carteira nunca impede novas prospecções (o limite deixa de ser aplicado).
        </p>
      </div>
    </div>
  );
}

function MessagesTab({ settings, setSettings, busy, setBusy, setFeedback }) {
  const [drafts, setDrafts] = useState(settings?.messages || {});

  function update(key, patch) {
    setDrafts((current) => ({ ...current, [key]: { ...current[key], ...patch } }));
  }

  return (
    <div className="space-y-4">
      {MESSAGE_FIELDS.map((field) => (
        <div key={field.key} className="rounded-[24px] border border-line bg-white p-6 shadow-soft">
          <h3 className="text-lg font-black text-navy">{field.label}</h3>
          <textarea
            className="mt-3 w-full rounded-2xl border border-line p-4 font-normal text-navy outline-none focus:border-brand"
            rows={4}
            value={drafts[field.key]?.text || ""}
            onChange={(event) => update(field.key, { text: event.target.value })}
          />
          <p className="mt-2 text-xs font-bold text-muted">
            Variáveis disponíveis: {"{saudacao} {primeiro_nome} {nome_corretor} {codigo_cliente}"}
          </p>
          <label className="mt-3 flex items-center gap-2 text-sm font-bold text-navy">
            <input
              type="checkbox"
              checked={Boolean(drafts[field.key]?.allowPersonalization)}
              onChange={(event) => update(field.key, { allowPersonalization: event.target.checked })}
            />
            Permitir personalização pelo corretor
          </label>
        </div>
      ))}
      <button
        className="premium-button-primary"
        disabled={busy}
        onClick={() => saveSettings({ messages: drafts }, setBusy, setFeedback, setSettings)}
        type="button"
      >
        <Save className="h-4 w-4" /> Salvar mensagens
      </button>
    </div>
  );
}

const PERIODS = [
  { value: "today", label: "Hoje" },
  { value: "last7", label: "7 dias" },
  { value: "last30", label: "30 dias" }
];

function PerformanceTab() {
  const [period, setPeriod] = useState("today");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  async function load(signal) {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/daily-goal/performance?period=${period}`, { signal });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setData(payload);
    } catch (requestError) {
      if (requestError.name !== "AbortError") setError(requestError.message || "Não foi possível carregar o desempenho.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {PERIODS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setPeriod(option.value)}
            className={`min-h-11 rounded-full border px-4 text-sm font-extrabold transition ${
              period === option.value ? "border-brand bg-blue-50 text-brand" : "border-line bg-white text-navy hover:border-brand"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {error ? <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</p> : null}
      {loading || !data ? (
        <p className="rounded-[24px] border border-line bg-white p-8 text-center font-bold text-muted">Carregando…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric label="Previstas" value={data.summary.previstas} />
            <Metric label="Realizadas" value={data.summary.realizadas} />
            <Metric label="% Meta Diária" value={formatPercent(data.summary.execucao)} />
            <Metric label="Taxa de reativação" value={formatPercent(data.summary.taxaReativacao)} />
          </div>

          <div className="rounded-[24px] border border-line bg-white p-6 shadow-soft">
            <h3 className="text-lg font-black text-navy">Conversão por mensagem</h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {data.summary.porMensagem.map((row) => (
                <div key={row.attemptNumber} className="rounded-2xl border border-line bg-mist/40 p-4">
                  <p className="text-xs font-extrabold uppercase tracking-[0.1em] text-muted">{row.attemptNumber}ª mensagem</p>
                  <p className="mt-1 text-sm font-bold text-navy">{row.abordados} abordados</p>
                  <p className="text-sm font-bold text-navy">{row.convertidos} convertidos</p>
                  <p className="mt-1 text-xl font-black text-brand">{formatPercent(row.taxa)}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto rounded-[24px] border border-line bg-white p-6 shadow-soft">
            <h3 className="text-lg font-black text-navy">Desempenho por corretor</h3>
            <table className="mt-4 w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-muted">
                  <th className="pb-2">Corretor</th>
                  <th className="pb-2">Meta executada</th>
                  <th className="pb-2">1ª msg</th>
                  <th className="pb-2">2ª msg</th>
                  <th className="pb-2">3ª msg</th>
                  <th className="pb-2">Conversão total</th>
                </tr>
              </thead>
              <tbody>
                {data.team.map((row) => (
                  <tr key={row.brokerId} className="border-t border-line">
                    <td className="py-2 font-black text-navy">{row.brokerName}</td>
                    <td className="py-2 font-bold text-navy">{formatPercent(row.execucao)}</td>
                    <td className="py-2 font-bold text-muted">{formatPercent(rate(row.porMensagem[1]))}</td>
                    <td className="py-2 font-bold text-muted">{formatPercent(rate(row.porMensagem[2]))}</td>
                    <td className="py-2 font-bold text-muted">{formatPercent(rate(row.porMensagem[3]))}</td>
                    <td className="py-2 font-black text-brand">{formatPercent(row.conversaoTotal)}</td>
                  </tr>
                ))}
                {!data.team.length ? (
                  <tr><td className="py-4 text-center font-bold text-muted" colSpan={6}>Nenhum dado para o período.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <PointsLedger period={period} team={data.team} />
        </>
      )}
    </div>
  );
}

// EXTRATO DE PONTOS — mesma tela de Desempenho (nunca um item novo no menu
// principal), consumindo a mesma fonte de eventos do ranking
// (getPointsLedger em lib/performance-overview.js) — nenhum ponto aqui pode
// existir sem uma linha correspondente, e a soma de cada corretor bate
// exatamente com o total que ele tem no Ranking do mesmo período.
function PointsLedger({ period, team }) {
  const [brokerId, setBrokerId] = useState("");
  const [activityFilter, setActivityFilter] = useState("all");
  const [ledger, setLedger] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      setLoading(true);
      setError("");
      try {
        const query = new URLSearchParams({ period, withReconciliation: "1" });
        if (brokerId) query.set("brokerId", brokerId);
        const response = await fetch(`/api/performance-overview/points-ledger?${query.toString()}`, { signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error);
        setLedger(payload.ledger);
      } catch (requestError) {
        if (requestError.name !== "AbortError") setError(requestError.message || "Não foi possível carregar o extrato.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [period, brokerId]);

  const activityOptions = Array.from(new Set((ledger?.rows || []).map((row) => row.origin)));
  const visibleRows = (ledger?.rows || []).filter((row) => activityFilter === "all" || row.origin === activityFilter);

  return (
    <div className="overflow-x-auto rounded-[24px] border border-line bg-white p-6 shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-black text-navy">Extrato de Pontos</h3>
        <div className="flex flex-wrap gap-2">
          <select className="h-10 rounded-xl border border-line bg-white px-3 text-sm font-bold text-navy" onChange={(event) => setBrokerId(event.target.value)} value={brokerId}>
            <option value="">Todos os corretores</option>
            {team.map((row) => <option key={row.brokerId} value={row.brokerId}>{row.brokerName}</option>)}
          </select>
          <select className="h-10 rounded-xl border border-line bg-white px-3 text-sm font-bold text-navy" onChange={(event) => setActivityFilter(event.target.value)} value={activityFilter}>
            <option value="all">Todas as origens</option>
            {activityOptions.map((origin) => <option key={origin} value={origin}>{origin}</option>)}
          </select>
        </div>
      </div>

      {error ? <p className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</p> : null}

      {ledger?.reconciliation?.length ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {ledger.reconciliation.filter((entry) => !brokerId || entry.brokerId === brokerId).map((entry) => (
            <span key={entry.brokerId} className={`rounded-full px-3 py-1 text-xs font-extrabold ${entry.reconciled ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
              {entry.brokerName}: {entry.reconciled ? "✓ Conferido" : `⚠ Divergência (extrato ${entry.ledgerPoints} × ranking ${entry.rankingPoints})`}
            </span>
          ))}
        </div>
      ) : null}

      {loading ? (
        <p className="mt-4 text-center font-bold text-muted">Carregando…</p>
      ) : (
        <table className="mt-4 w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-muted">
              <th className="pb-2">Corretor</th>
              <th className="pb-2">Cliente</th>
              <th className="pb-2">Ação</th>
              <th className="pb-2">Pontos</th>
              <th className="pb-2">Data</th>
              <th className="pb-2">Horário</th>
              <th className="pb-2">Origem</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, index) => (
              <tr key={index} className="border-t border-line">
                <td className="py-2 font-black text-navy">{row.brokerName}</td>
                <td className="py-2 font-bold text-muted">{row.clientName}</td>
                <td className="py-2 font-bold text-navy">{row.action}</td>
                <td className={`py-2 font-black ${row.points >= 0 ? "text-brand" : "text-red-600"}`}>{row.points >= 0 ? `+${row.points}` : row.points}</td>
                <td className="py-2 font-bold text-muted">{formatDate(row.occurredAt)}</td>
                <td className="py-2 font-bold text-muted">{formatTime(row.occurredAt)}</td>
                <td className="py-2 font-bold text-muted">{row.origin}</td>
              </tr>
            ))}
            {!visibleRows.length ? (
              <tr><td className="py-4 text-center font-bold text-muted" colSpan={7}>Nenhum evento de pontuação neste período.</td></tr>
            ) : null}
          </tbody>
        </table>
      )}
    </div>
  );
}

function formatDate(value) {
  return value ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(new Date(value)) : "—";
}
function formatTime(value) {
  return value ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "—";
}

function rate(entry) {
  if (!entry || !entry.abordados) return null;
  return entry.convertidos / entry.abordados;
}

function Metric({ label, value }) {
  return (
    <div className="rounded-2xl border border-line bg-white p-4 text-center shadow-soft">
      <p className="text-2xl font-black text-navy">{value}</p>
      <p className="mt-1 text-xs font-bold text-muted">{label}</p>
    </div>
  );
}

function formatPercent(value) {
  if (value === null || value === undefined) return "—";
  return `${Math.round(value * 100)}%`;
}

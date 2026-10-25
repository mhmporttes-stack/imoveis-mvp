"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Button from "@/components/ui/Button";
import { pickBestBrowserVoice, pronounceForSpeech } from "@/lib/henry-voice-providers.mjs";
import { analyzeHenryTraining } from "@/lib/henry-training-core.mjs";

// Modo treino do Henry (dono, 2026-10-24 — docs/BUSINESS_RULES.md HENRY-1 "Modo treino", PENDENTE DE VALIDAÇÃO). Só o
// dono (a rota /api/admin/henry/treino recusa os demais; para eles o cartão nem aparece). Um "dono simulado" conversa com
// o MESMO Henry, cenário por cenário; as respostas saem em TEXTO (nenhuma voz paga) e o relatório aponta repetições e
// falas erradas. Voz opcional: só a do navegador, por botão.
// Treinos anteriores (dono, 2026-10-25): cada rodada fica guardada no servidor (últimas 20) e aparece na lista abaixo.
const usd = (value) => `US$ ${Number(value || 0).toFixed(3)}`;
const whenFormat = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const when = (iso) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : whenFormat.format(date);
};

export default function HenryTrainingCard() {
  const [info, setInfo] = useState(null);
  const [selected, setSelected] = useState([]);
  const [simulateOwner, setSimulateOwner] = useState(true);
  const [exchanges, setExchanges] = useState([]);
  const [running, setRunning] = useState("");
  const [error, setError] = useState("");
  const [costUsd, setCostUsd] = useState(0);
  const [saveError, setSaveError] = useState("");
  const [history, setHistory] = useState(null);
  const [historyError, setHistoryError] = useState("");
  const [openId, setOpenId] = useState("");
  const [openRound, setOpenRound] = useState(null);
  const [openError, setOpenError] = useState("");
  const stopRef = useRef(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/admin/henry/treino", { cache: "no-store" })
      .then(async (response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!alive || !data) return;
        setInfo(data);
        setHistory(Array.isArray(data.history) ? data.history : null);
        setHistoryError(data.historyError || "");
        setSelected(data.scenarios.map((scenario) => scenario.id));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!info) return null;

  const plannedSteps = Math.min(info.maxExchanges, info.scenarios.filter((scenario) => selected.includes(scenario.id)).reduce((sum, scenario) => sum + scenario.steps, 0));
  const perExchange = (simulateOwner ? info.estimate.withOwnerUsd : info.estimate.withoutOwnerUsd) / Math.max(1, info.estimate.exchanges);
  const estimate = perExchange * plannedSteps;

  const run = async () => {
    stopRef.current = false;
    setExchanges([]);
    setCostUsd(0);
    setError("");
    setSaveError("");
    let roundId = "";
    let sandbox = null;
    let used = 0;
    let all = [];
    for (const scenario of info.scenarios.filter((item) => selected.includes(item.id))) {
      if (stopRef.current) break;
      if (used + scenario.steps > info.maxExchanges) break;
      setRunning(scenario.label);
      try {
        const response = await fetch("/api/admin/henry/treino", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scenarioId: scenario.id, roundId, sandbox, usedExchanges: used, simulateOwner })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data?.error || "Falha no treino.");
        sandbox = data.sandbox || null;
        roundId = data.roundId || roundId;
        if (Array.isArray(data.history)) setHistory(data.history);
        if (data.saveError) setSaveError(data.saveError);
        used += data.exchanges.length;
        all = [...all, ...data.exchanges.map((item) => ({ ...item, label: scenario.label }))];
        setExchanges(all);
        setCostUsd((current) => current + (Number(data.costUsd) || 0));
      } catch (runError) {
        setError(runError.message);
        break;
      }
    }
    setRunning("");
  };

  const openHistory = async (id) => {
    if (openId === id) {
      setOpenId("");
      setOpenRound(null);
      return;
    }
    setOpenId(id);
    setOpenRound(null);
    setOpenError("");
    try {
      const response = await fetch(`/api/admin/henry/treino?round=${encodeURIComponent(id)}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Não consegui abrir este treino.");
      setOpenRound(data.round);
    } catch (openFailure) {
      setOpenError(openFailure.message);
    }
  };

  const speak = (text) => {
    if (!window.speechSynthesis || !text) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(pronounceForSpeech(text));
    utterance.lang = "pt-BR";
    const voice = pickBestBrowserVoice(window.speechSynthesis.getVoices());
    if (voice) utterance.voice = voice;
    window.speechSynthesis.speak(utterance);
  };

  return (
    <section className="container-page mt-8 rounded-panel border border-line bg-white p-6">
      <div className="max-w-2xl">
        <p className="text-base font-black text-navy">Treino do Henry</p>
        <p className="mt-1 text-sm text-muted">
          Um dono simulado conversa com o Henry de verdade (o mesmo jeito de responder e as mesmas leituras do CRM), mas tudo fica só nesta
          rodada: nada entra na conversa de hoje, nenhuma música toca e nenhuma voz paga é usada. Respostas em texto; para ouvir, use a voz
          do navegador (grátis).
        </p>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {info.scenarios.map((scenario) => {
          const active = selected.includes(scenario.id);
          return (
            <button
              key={scenario.id}
              type="button"
              disabled={Boolean(running)}
              onClick={() => setSelected((current) => (active ? current.filter((id) => id !== scenario.id) : [...current, scenario.id]))}
              className={`rounded-control border px-3 py-1.5 text-[13px] font-bold ${active ? "border-accent-line bg-accent-soft text-ink" : "border-line text-muted"}`}
              title={scenario.sample.join(" · ")}
            >
              {scenario.label} ({scenario.steps})
            </button>
          );
        })}
      </div>

      <label className="mt-3 flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" checked={simulateOwner} disabled={Boolean(running)} onChange={(event) => setSimulateOwner(event.target.checked)} />
        Variar as falas do dono com IA (sem isso, usa as frases fixas do roteiro)
      </label>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {running ? (
          <Button variant="secondary" onClick={() => (stopRef.current = true)}>Parar depois deste cenário</Button>
        ) : (
          <Button onClick={run} disabled={!plannedSteps}>Rodar treino</Button>
        )}
        <span className="text-sm text-muted">
          {plannedSteps} trocas (teto {info.maxExchanges}) · custo estimado {usd(estimate)}
          {exchanges.length ? ` · gasto desta rodada ${usd(costUsd)}` : ""}
        </span>
      </div>
      {running ? <p className="mt-2 text-sm text-muted">Rodando: {running}…</p> : null}
      {error ? <p className="mt-2 text-sm font-bold text-danger">{error}</p> : null}
      {saveError ? <p className="mt-2 text-sm font-bold text-danger">{saveError}</p> : null}
      {exchanges.length ? <TrainingReport exchanges={exchanges} onSpeak={speak} /> : null}

      <TrainingHistory history={history} historyError={historyError} openId={openId} openRound={openRound} openError={openError} onOpen={openHistory} onSpeak={speak} />
    </section>
  );
}

// Relatório de uma rodada (a que acabou de rodar ou uma dos Treinos anteriores): resumo, repetições do dia e as trocas
// dono↔Henry com os achados de cada uma destacados. Achados sempre por analyzeHenryTraining (mesma regra).
function TrainingReport({ exchanges, onSpeak }) {
  const report = useMemo(() => analyzeHenryTraining(exchanges), [exchanges]);
  const issuesAt = (index) => report.issues.filter((issue) => issue.index === index);
  const dayIssues = report.issues.filter((issue) => issue.index === undefined);
  return (
    <div className="mt-6 border-t border-line pt-5">
      <p className="text-sm font-black text-navy">
        Relatório: {report.totals.issues} ponto(s) em {report.totals.exchanges} trocas · média {report.totals.averageChars} caracteres · maior {report.totals.longest}
      </p>
      {dayIssues.length ? (
        <ul className="mt-2 space-y-1 text-sm text-ink">
          {dayIssues.map((issue, index) => (
            <li key={index} className="break-words">
              <span className="font-bold">{issue.label}:</span> “{issue.text}”
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted">Nenhuma repetição no dia.</p>
      )}
      <ol className="mt-4 space-y-3">
        {exchanges.map((item, index) => {
          const found = issuesAt(index);
          return (
            <li key={index} className={`rounded-card border p-3 text-sm ${found.length ? "border-danger-line" : "border-line"}`}>
              <p className="text-xs font-bold text-muted">{item.label} · {Math.round((item.ms || 0) / 100) / 10} s{item.tools ? " · com ferramentas" : ""}{item.navigate ? ` · abriria ${item.navigate}` : ""}</p>
              <p className="mt-1 break-words text-ink"><span className="font-bold">Dono:</span> {item.owner}</p>
              <p className="mt-1 break-words text-ink">
                <span className="font-bold">Henry:</span> {item.error ? <span className="text-danger">{item.error}</span> : item.reply}
                {item.reply ? (
                  <button type="button" onClick={() => onSpeak(item.reply)} className="ml-2 text-xs font-bold text-accent-strong underline">ouvir</button>
                ) : null}
              </p>
              {found.map((issue, issueIndex) => (
                <p key={issueIndex} className="mt-1 text-xs font-bold text-danger">Atenção: {issue.label}</p>
              ))}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function TrainingHistory({ history, historyError, openId, openRound, openError, onOpen, onSpeak }) {
  return (
    <div className="mt-6 border-t border-line pt-5">
      <p className="text-sm font-black text-navy">Treinos anteriores</p>
      {historyError ? <p className="mt-2 text-sm font-bold text-danger">{historyError}</p> : null}
      {!historyError && !history?.length ? <p className="mt-2 text-sm text-muted">Nenhum treino guardado ainda. Ao rodar um, ele aparece aqui.</p> : null}
      {history?.length ? (
        <ul className="mt-3 space-y-2">
          {history.map((round) => {
            const open = openId === round.id;
            return (
              <li key={round.id} className="rounded-card border border-line">
                <button type="button" onClick={() => onOpen(round.id)} aria-expanded={open} className="flex w-full flex-col gap-1 p-3 text-left text-sm sm:flex-row sm:items-center sm:justify-between">
                  <span className="font-bold text-ink">{when(round.startedAt)} · {round.exchanges} trocas · {usd(round.costUsd)}</span>
                  <span className={round.issues ? "text-xs font-bold text-danger" : "text-xs font-bold text-muted"}>
                    {round.issues ? `${round.issues} ponto(s)` : "Nenhum ponto"} · {open ? "fechar" : "abrir"}
                  </span>
                </button>
                {round.issueCounts?.length ? (
                  <p className="px-3 pb-3 text-xs text-muted">{round.issueCounts.map((entry) => `${entry.label}: ${entry.count}`).join(" · ")}</p>
                ) : null}
                {open ? (
                  <div className="px-3 pb-3">
                    {openError ? <p className="text-sm font-bold text-danger">{openError}</p> : null}
                    {!openError && !openRound ? <p className="text-sm text-muted">Abrindo…</p> : null}
                    {openRound?.id === round.id ? (
                      <>
                        <p className="text-xs text-muted">Cenários: {openRound.scenarios.join(", ") || "—"}{openRound.simulateOwner ? " · falas do dono variadas com IA" : " · frases fixas do roteiro"}</p>
                        <TrainingReport exchanges={openRound.exchanges} onSpeak={onSpeak} />
                      </>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

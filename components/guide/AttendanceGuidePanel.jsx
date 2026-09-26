"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, BookOpen, CalendarClock, Check, ChevronRight, CircleCheck, Copy, Info, Loader2, RotateCcw, Pencil } from "lucide-react";
import { PHASES, RULE_PHASES, advance, fillPlaceholders, findUnresolvedPlaceholders, getOutputPorts, goBack, startState } from "@/lib/attendance-guide-core.mjs";

// Guia de Atendimento ao lado do Chat: árvore de decisão para o corretor. O guia certo abre sozinho conforme a
// origem do cliente (Prospecção / Lead / Orgânico) e o progresso é salvo por cliente — ao voltar, continua
// exatamente onde parou. Só USA a versão publicada; quem edita é Gestão (Guia de Atendimento).

const PHASE_LABEL = Object.fromEntries(PHASES.map((phase) => [phase.key, phase.label]));

function pad(value) {
  return String(value).padStart(2, "0");
}

// "yyyy-MM-ddTHH:mm" no fuso do navegador, para o <input type="datetime-local">.
function toLocalInput(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultReturnDate(days) {
  const date = new Date();
  date.setDate(date.getDate() + Math.max(0, Number(days) || 0));
  date.setHours(10, 0, 0, 0);
  if (date.getTime() < Date.now()) date.setTime(Date.now() + 60 * 60 * 1000);
  return toLocalInput(date);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Alguns navegadores (ou páginas sem HTTPS) bloqueiam a área de transferência: cai no método antigo.
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

// onInsert(texto): coloca a mensagem no campo do Chat DESTA conversa (o corretor revisa e envia). canInsert = janela de
// 24h aberta (fora dela só modelo aprovado).
export default function AttendanceGuidePanel({ conversationId, className = "", onInsert = null, canInsert = true }) {
  const [session, setSession] = useState(null);
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saveWarning, setSaveWarning] = useState("");
  const saveTimer = useRef(null);
  const sessionRef = useRef(null);
  sessionRef.current = session;
  const scrollRef = useRef(null);

  const load = useCallback(async (guideId = "") => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ conversationId });
      if (guideId) params.set("guideId", guideId);
      const response = await fetch(`/api/admin/attendance-guides/session?${params.toString()}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível abrir o guia de atendimento.");
      setSession(data);
      setState(data.state);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    load();
    return () => clearTimeout(saveTimer.current);
  }, [load]);

  const graphs = useMemo(() => new Map(Object.entries(session?.graphs || {})), [session]);

  const persist = useCallback((next) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const current = sessionRef.current;
      if (!current?.guide) return;
      try {
        const response = await fetch("/api/admin/attendance-guides/session", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId, guideId: current.guide.id, state: next })
        });
        if (!response.ok) throw new Error();
        setSaveWarning("");
      } catch {
        setSaveWarning("Não foi possível salvar o ponto do atendimento agora.");
      }
    }, 300);
  }, [conversationId]);

  function update(next) {
    if (!next) return;
    setState(next);
    persist(next);
    scrollRef.current?.scrollTo({ top: 0 });
  }

  const node = state ? graphs.get(state.guideId)?.nodes.find((item) => item.id === state.nodeId) : null;
  const inLibrary = Boolean(state && session?.guide && state.guideId !== session.guide.id);

  async function restart() {
    if (!session?.guide) return;
    if (state?.path?.length && !window.confirm("Recomeçar o guia deste cliente do primeiro card?")) return;
    clearTimeout(saveTimer.current);
    await fetch(`/api/admin/attendance-guides/session?conversationId=${encodeURIComponent(conversationId)}&guideId=${encodeURIComponent(session.guide.id)}`, { method: "DELETE" }).catch(() => {});
    const fresh = startState(graphs, session.guide.id);
    setState(fresh);
    scrollRef.current?.scrollTo({ top: 0 });
  }

  return (
    <div className={`flex min-h-0 flex-col bg-white ${className}`} data-attendance-guide>
      <header className="border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-blue-50 text-brand"><BookOpen className="h-4 w-4" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-black text-navy">Guia de Atendimento</p>
            {session ? <p className="truncate text-[11px] font-bold text-muted">Atendimento: {session.kindLabel}{session.resumed ? " · continuando de onde parou" : ""}</p> : null}
          </div>
          {session?.guide ? (
            <>
              <button type="button" onClick={() => update(goBack(state))} disabled={!state?.path?.length} className="grid h-8 w-8 place-items-center rounded-full border border-line text-navy hover:bg-mist disabled:opacity-40" title="Voltar um passo" aria-label="Voltar um passo"><ArrowLeft className="h-4 w-4" /></button>
              <button type="button" onClick={restart} className="grid h-8 w-8 place-items-center rounded-full border border-line text-navy hover:bg-mist" title="Recomeçar o guia" aria-label="Recomeçar o guia"><RotateCcw className="h-4 w-4" /></button>
            </>
          ) : null}
        </div>
        {session && session.guides.length > 1 ? (
          <select
            value={session.guide?.id || ""}
            onChange={(event) => load(event.target.value)}
            aria-label="Trocar de guia"
            className="mt-2 h-9 w-full rounded-xl border border-line bg-white px-2 text-xs font-extrabold text-navy outline-none focus:border-brand"
          >
            {session.guides.map((guide) => <option key={guide.id} value={guide.id}>{guide.name}{guide.id === session.autoGuideId ? " (sugerido)" : ""}</option>)}
          </select>
        ) : null}
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {loading && !session ? <p className="flex items-center justify-center gap-2 p-6 text-sm font-bold text-muted"><Loader2 className="h-4 w-4 animate-spin" />Abrindo o guia…</p> : null}
        {error ? (
          <div className="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm font-bold text-red-700">
            {error}
            <button type="button" onClick={() => load()} className="mt-2 block rounded-full border border-red-200 bg-white px-3 py-1 text-xs font-extrabold text-red-700">Tentar novamente</button>
          </div>
        ) : null}
        {session && !session.guide ? (
          <p className="rounded-2xl border border-dashed border-line p-5 text-center text-sm font-bold text-muted">Nenhum guia de atendimento está ativo. A Gestão pode criar e publicar um em Gestão → Guia de Atendimento.</p>
        ) : null}
        {session?.guide && !node && !loading ? (
          <p className="rounded-2xl border border-dashed border-line p-5 text-center text-sm font-bold text-muted">Este guia ainda não tem cards ligados ao início.</p>
        ) : null}
        {saveWarning ? <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">{saveWarning}</p> : null}
        {session?.formFilledAt ? (
          <p className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-extrabold leading-4 text-emerald-800" data-form-filled>
            <Check className="mr-1 inline h-3.5 w-3.5" />Este cliente já preencheu o formulário ({formatAgo(session.formFilledAt)}). Não peça o link de novo: use a simulação dele.
          </p>
        ) : null}

        {session?.guide && node ? (
          <GuideStep
            key={`${state.guideId}:${node.id}`}
            node={node}
            graph={graphs.get(state.guideId)}
            state={state}
            inLibrary={inLibrary}
            session={session}
            onInsert={onInsert}
            canInsert={canInsert}
            onPick={(portId) => update(advance(state, graphs, portId))}
          />
        ) : null}
      </div>
    </div>
  );
}

function PhaseStrip({ phase }) {
  const index = RULE_PHASES.indexOf(phase);
  if (index === -1) {
    return <span className="inline-block rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-slate-600">{PHASE_LABEL[phase] || "Etapa"}</span>;
  }
  return (
    <ol className="flex flex-wrap items-center gap-x-1 gap-y-1" aria-label="Etapa da regra central">
      {RULE_PHASES.map((key, position) => (
        <li key={key} className="flex items-center gap-1">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${position === index ? "bg-brand text-white" : position < index ? "bg-blue-50 text-brand" : "bg-slate-100 text-slate-400"}`}>{PHASE_LABEL[key]}</span>
          {position < RULE_PHASES.length - 1 ? <ChevronRight className="h-3 w-3 text-slate-300" aria-hidden="true" /> : null}
        </li>
      ))}
    </ol>
  );
}

function formatAgo(value) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `há ${hours} h` : `há ${Math.round(hours / 24)} dias`;
}

function InsertMessage({ text, onInsert, disabled }) {
  const [done, setDone] = useState(false);
  return (
    <div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => { onInsert(text); setDone(true); setTimeout(() => setDone(false), 2500); }}
        className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-full bg-brand text-sm font-extrabold text-white transition hover:bg-navy disabled:opacity-50"
        data-insert-message
      >
        {done ? <><Check className="h-4 w-4" />Inserida — revise e envie</> : <><Pencil className="h-4 w-4" />Inserir no chat</>}
      </button>
      {disabled ? <p className="mt-1 text-[11px] font-bold text-muted">Janela de 24h fechada: use um modelo aprovado no Chat.</p> : null}
    </div>
  );
}

function CopyMessage({ text, secondary = false }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    if (await copyText(text)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      className={`inline-flex h-10 w-full items-center justify-center gap-2 rounded-full text-sm font-extrabold transition ${copied ? "bg-emerald-500 text-white" : secondary ? "border border-navy/20 bg-white text-navy hover:border-brand" : "bg-navy text-white hover:bg-[#082f55]"}`}
    >
      {copied ? <><Check className="h-4 w-4" />Mensagem copiada!</> : <><Copy className="h-4 w-4" />Copiar mensagem</>}
    </button>
  );
}

function GuideStep({ node, graph, state, inLibrary, session, onInsert, canInsert, onPick }) {
  const data = node.data || {};
  const fill = (text) => fillPlaceholders(text, { clientName: session.client?.name, brokerName: session.broker?.name, simulationLink: session.broker?.simulationLink, brokerVars: session.broker?.vars });
  const ports = getOutputPorts(node);
  // Saída sem ligação não leva a lugar nenhum: no card de retorno ela some (fim do atendimento).
  const linkedPorts = ports.filter((port) => (graph?.edges || []).some((edge) => edge.from === node.id && edge.port === port.id));
  const trail = (state.path || []).slice(-3).map((item) => item.label).filter(Boolean);
  const message = fill(data.message);
  const unresolved = findUnresolvedPlaceholders(message);
  const asksForLink = /\[link\]/i.test(String(data.message || ""));

  return (
    <div className="space-y-3">
      {node.type === "card" ? <PhaseStrip phase={data.phase} /> : null}
      {trail.length ? <p className="text-[11px] font-bold leading-4 text-muted">{trail.join("  ›  ")}</p> : null}
      {inLibrary ? <p className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-violet-700"><BookOpen className="h-3 w-3" />Banco de objeções</p> : null}

      <h3 className="text-lg font-black leading-6 text-navy">{data.title}</h3>

      {node.type === "end" ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="flex items-center gap-2 text-sm font-black text-emerald-800"><CircleCheck className="h-4 w-4" />{data.outcome || "Atendimento encerrado"}</p>
        </div>
      ) : null}

      {data.guidance ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50/70 p-3.5">
          <p className="mb-1 flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wide text-amber-800"><Info className="h-3.5 w-3.5" />Orientação (só você vê)</p>
          <p className="whitespace-pre-wrap text-sm font-semibold leading-5 text-amber-950">{data.guidance}</p>
        </section>
      ) : null}

      {data.argument ? (
        <section className="rounded-2xl border border-line bg-mist/50 p-3.5">
          <p className="mb-1 text-[11px] font-black uppercase tracking-wide text-slate-500">Argumento sugerido</p>
          <p className="whitespace-pre-wrap text-sm font-semibold leading-5 text-navy">{data.argument}</p>
        </section>
      ) : null}

      {message ? (
        <section>
          <p className="mb-1 text-[11px] font-black uppercase tracking-wide text-slate-500">Mensagem pronta</p>
          <div className="rounded-2xl rounded-tl-md border border-blue-100 bg-[#EAF2FF] p-3.5">
            <p className="whitespace-pre-wrap text-sm font-semibold leading-5 text-navy" data-guide-message>{message}</p>
          </div>
          {session.formFilledAt && asksForLink ? (
            <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">O cliente já preencheu o formulário — não envie o link de novo.</p>
          ) : null}
          {unresolved.length ? (
            <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">Falta preencher {unresolved.join(", ")} antes de enviar (edite no campo do chat).</p>
          ) : null}
          <div className="mt-2 grid gap-2">
            {onInsert ? <InsertMessage text={message} onInsert={onInsert} disabled={!canInsert} /> : null}
            <CopyMessage text={message} secondary={Boolean(onInsert)} />
          </div>
        </section>
      ) : null}

      {node.type === "followup" ? <FollowupForm node={node} session={session} ports={linkedPorts} onPick={onPick} /> : null}

      {node.type === "card" && ports.length ? (
        <section>
          <p className="mb-1.5 text-[11px] font-black uppercase tracking-wide text-slate-500">O cliente respondeu…</p>
          <div className="space-y-2">
            {ports.map((port) => (
              <button
                key={port.id}
                type="button"
                onClick={() => onPick(port.id)}
                className="flex w-full items-center justify-between gap-2 rounded-2xl border border-line bg-white px-3.5 py-2.5 text-left text-sm font-extrabold text-navy transition hover:border-brand hover:bg-blue-50/60"
              >
                <span>{port.label}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-brand" />
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

// "Todo atendimento pendente termina com próximo passo + data de retorno": cria a atividade na agenda existente.
function FollowupForm({ node, session, ports, onPick }) {
  const data = node.data || {};
  const clientId = session.client?.id || "";
  const [when, setWhen] = useState(() => defaultReturnDate(data.defaultDays));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(null);
  const [error, setError] = useState("");

  async function schedule() {
    setError("");
    const date = new Date(when);
    if (!Number.isFinite(date.getTime())) {
      setError("Escolha uma data e hora válidas.");
      return;
    }
    if (!note.trim()) {
      setError("Escreva o próximo passo combinado com o cliente.");
      return;
    }
    setSaving(true);
    try {
      const firstName = fillPlaceholders("[Nome]", { clientName: session.client?.name }).replace("[Nome]", "cliente");
      const response = await fetch("/api/calendar-activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `Retorno: ${firstName}`,
          scheduledAt: date.toISOString(),
          clientId,
          activityType: data.activityType || "follow_up",
          note: note.trim()
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível agendar o retorno.");
      setDone(date);
    } catch (scheduleError) {
      setError(scheduleError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-2xl border border-blue-200 bg-blue-50/60 p-3.5" data-followup>
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wide text-brand"><CalendarClock className="h-3.5 w-3.5" />Próximo passo + data de retorno</p>
      {!clientId ? (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">Este contato ainda não está em Clientes. Adicione-o ao CRM (Informações do contato) para agendar o retorno na agenda.</p>
      ) : done ? (
        <p className="rounded-xl bg-emerald-100 px-3 py-2 text-sm font-black text-emerald-800"><Check className="mr-1 inline h-4 w-4" />Retorno agendado para {done.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}. Está na sua agenda.</p>
      ) : (
        <div className="space-y-2">
          <label className="block text-xs font-black text-navy">
            Próximo passo combinado
            <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} placeholder="Ex.: enviar simulação com entrada facilitada" className="mt-1 h-10 w-full rounded-xl border border-line bg-white px-3 text-sm font-bold text-navy outline-none focus:border-brand" />
          </label>
          <label className="block text-xs font-black text-navy">
            Data e hora do retorno
            <input type="datetime-local" value={when} onChange={(event) => setWhen(event.target.value)} className="mt-1 h-10 w-full rounded-xl border border-line bg-white px-3 text-sm font-bold text-navy outline-none focus:border-brand" />
          </label>
          {error ? <p className="text-xs font-bold text-red-700">{error}</p> : null}
          <button type="button" onClick={schedule} disabled={saving} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-full bg-brand text-sm font-extrabold text-white transition hover:bg-navy disabled:opacity-60">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}Agendar retorno
          </button>
        </div>
      )}
      {ports.length && (done || !clientId) ? (
        <div className="mt-3 space-y-2">
          {ports.map((port) => (
            <button key={port.id} type="button" onClick={() => onPick(port.id)} className="flex w-full items-center justify-between rounded-2xl border border-line bg-white px-3.5 py-2.5 text-left text-sm font-extrabold text-navy hover:border-brand">
              <span>{port.label}</span><ChevronRight className="h-4 w-4 text-brand" />
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

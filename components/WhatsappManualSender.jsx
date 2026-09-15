"use client";

import { useEffect, useState } from "react";
import { Check, CheckCircle2, ChevronDown, ChevronUp, Clipboard, ExternalLink, History, LoaderCircle, MessageCircle, Send, Sparkles, Users } from "lucide-react";
import { buildWhatsAppUrl, toWhatsAppDigits } from "@/lib/phone-utils";

const PERIOD_OPTIONS = [
  { value: "today", label: "Diário" },
  { value: "last7", label: "Semanal" },
  { value: "last30", label: "Mensal" }
];

const ACTION_LABEL = { opened: "WhatsApp aberto", marked_sent: "Marcado manualmente como enviado" };

// Único ponto que abre o WhatsApp de verdade — usado tanto pelo modo "Um
// corretor" quanto por cada linha do modo "Todos", pra nunca duplicar essa
// lógica. Reaproveita o MESMO endpoint de histórico já existente (só
// registra "opened"; "enviado de fato" o CRM nunca sabe).
//
// Usa api.whatsapp.com/send em vez de wa.me: o encurtador wa.me faz um
// redirect 302 que corrompe emoji fora do plano básico (🚀🔥👏💪 etc,
// 4 bytes em UTF-8) para o caractere de substituição U+FFFD durante o
// próprio redirecionamento — confirmado direto no cabeçalho Location da
// Meta (acentos sobrevivem, só o emoji quebra). Chamar api.whatsapp.com/send
// direto pula esse salto e entrega o texto intacto; encodeURIComponent
// continua sendo aplicado uma única vez, aqui, e nada mais no fluxo
// decodifica/recodifica a mensagem antes disso.
function openWhatsappAndLog({ brokerId, phone, message, period }) {
  const digits = toWhatsAppDigits(phone);
  if (!digits) return false;
  // Proteção adicional: nunca abrir o WhatsApp com um caractere de
  // substituição já presente na mensagem (sinal de que algo, em algum
  // ponto anterior, corrompeu um emoji) — a causa raiz é corrigida acima,
  // isto é só uma rede de segurança.
  if (/�/.test(message)) return false;

  fetch("/api/admin/whatsapp-master/manual-log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ brokerId, summaryType: period, action: "opened" })
  }).catch(() => {});
  window.open(`https://api.whatsapp.com/send?phone=${digits}&text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
  return true;
}

export default function WhatsappManualSender({ brokers = [] }) {
  const [period, setPeriod] = useState("today");
  const [mode, setMode] = useState("single");
  const [brokerId, setBrokerId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [single, setSingle] = useState(null);
  const [allItems, setAllItems] = useState(null);
  const [showHistory, setShowHistory] = useState(false);

  function resetResults() {
    setSingle(null);
    setAllItems(null);
    setError("");
  }

  async function generate() {
    setError("");
    setLoading(true);
    try {
      if (mode === "all") {
        const response = await fetch(`/api/admin/whatsapp-master/manual-summary?all=true&period=${encodeURIComponent(period)}`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "Não foi possível gerar os resumos.");
        setSingle(null);
        setAllItems(payload);
      } else {
        if (!brokerId) throw new Error("Selecione um corretor.");
        const response = await fetch(`/api/admin/whatsapp-master/manual-summary?brokerId=${encodeURIComponent(brokerId)}&period=${encodeURIComponent(period)}`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "Não foi possível gerar o resumo.");
        setAllItems(null);
        setSingle(payload);
      }
    } catch (generateError) {
      setError(generateError.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="container-page mt-6 space-y-5 rounded-[28px] border border-line bg-white p-6 shadow-soft">
      <div>
        <p className="inline-flex items-center gap-2 text-sm font-black uppercase tracking-[0.12em] text-navy">
          <MessageCircle className="h-4 w-4" />WhatsApp Manual
        </p>
        <p className="mt-1 text-sm text-muted">
          Gera a mensagem com dados reais e abre seu próprio WhatsApp já com o texto pronto — você quem confere e envia.
          Independente do WhatsApp Master: não depende de conexão, template ou aprovação da Meta.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-2 text-sm font-black text-navy">Período</p>
          <div className="grid grid-cols-3 gap-1.5 rounded-2xl border border-line bg-mist/40 p-1">
            {PERIOD_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => { setPeriod(option.value); resetResults(); }}
                className={`rounded-xl px-2 py-2 text-sm font-black transition ${period === option.value ? "bg-navy text-white" : "text-navy hover:bg-white"}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-black text-navy">Destinatário</p>
          <div className="grid grid-cols-2 gap-1.5 rounded-2xl border border-line bg-mist/40 p-1">
            <button type="button" onClick={() => { setMode("single"); resetResults(); }} className={`rounded-xl px-2 py-2 text-sm font-black transition ${mode === "single" ? "bg-navy text-white" : "text-navy hover:bg-white"}`}>
              Um corretor
            </button>
            <button type="button" onClick={() => { setMode("all"); resetResults(); }} className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-sm font-black transition ${mode === "all" ? "bg-navy text-white" : "text-navy hover:bg-white"}`}>
              <Users className="h-4 w-4" />Todos
            </button>
          </div>
        </div>
      </div>

      {mode === "single" ? (
        <label className="block text-sm font-black text-navy">
          Corretor
          <select className="mt-1 min-h-12 w-full rounded-2xl border border-line bg-white px-4" value={brokerId} onChange={(event) => { setBrokerId(event.target.value); resetResults(); }}>
            <option value="">Selecione um corretor</option>
            {brokers.map((item) => (
              <option key={item.id} value={item.id}>{item.name}{!item.phone ? " (sem WhatsApp cadastrado)" : ""}</option>
            ))}
          </select>
        </label>
      ) : null}

      <button type="button" onClick={generate} disabled={loading || (mode === "single" && !brokerId)} className="premium-button-primary">
        {loading ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
        Gerar mensagem{mode === "all" ? " para todos" : ""}
      </button>

      {error ? <p className="rounded-2xl bg-red-50 px-4 py-3 font-bold text-red-700">{error}</p> : null}

      {single ? <SingleMessageCard result={single} period={period} brokerId={brokerId} /> : null}
      {allItems ? <AllMessagesList data={allItems} period={period} /> : null}

      <div className="flex flex-wrap gap-2 border-t border-line pt-4">
        <button type="button" onClick={() => setShowHistory((value) => !value)} className="premium-button-secondary">
          <History className="h-5 w-5" />Histórico
        </button>
      </div>

      {showHistory ? <RecentHistory /> : null}
    </section>
  );
}

// Modo "Um corretor" — inalterado nesta rodada (prévia editável, copiar,
// abrir no WhatsApp, marcar como enviado).
function SingleMessageCard({ result, period, brokerId }) {
  const [text, setText] = useState(result.message);
  const [copied, setCopied] = useState(false);
  const [opened, setOpened] = useState(false);
  const [markedSent, setMarkedSent] = useState(false);
  const hasPhone = Boolean(buildWhatsAppUrl(result.phone));
  const hasInvalidChar = /�/.test(text);

  useEffect(() => { setText(result.message); setOpened(false); setMarkedSent(false); }, [result]);

  async function copyMessage() {
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function openWhatsapp() {
    if (openWhatsappAndLog({ brokerId, phone: result.phone, message: text, period })) setOpened(true);
  }

  async function markSent() {
    await fetch("/api/admin/whatsapp-master/manual-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brokerId, summaryType: period, action: "marked_sent" })
    }).catch(() => {});
    setMarkedSent(true);
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-black uppercase tracking-wide text-muted">{result.periodLabel} — {result.brokerName}, pode editar antes de enviar</p>
      <textarea className="min-h-40 w-full rounded-2xl border border-line p-4 font-normal" value={text} onChange={(event) => setText(event.target.value)} />
      {!hasPhone ? <p className="text-sm font-bold text-muted">WhatsApp não cadastrado para este corretor.</p> : null}
      {hasInvalidChar ? <p className="text-sm font-bold text-red-700">A mensagem tem um caractere inválido (�) — corrija o texto antes de abrir o WhatsApp.</p> : null}
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={copyMessage} className="premium-button-secondary">
          {copied ? <Check className="h-5 w-5" /> : <Clipboard className="h-5 w-5" />}
          {copied ? "Mensagem copiada." : "Copiar mensagem"}
        </button>
        <button type="button" onClick={openWhatsapp} disabled={!hasPhone || hasInvalidChar} className="premium-button-primary">
          <ExternalLink className="h-5 w-5" />Abrir no WhatsApp
        </button>
        {opened && !markedSent ? (
          <button type="button" onClick={markSent} className="premium-button-secondary">Marcar como enviado</button>
        ) : null}
        {markedSent ? <span className="inline-flex items-center gap-1.5 self-center text-sm font-bold text-emerald-700"><Check className="h-4 w-4" />Marcado como enviado</span> : null}
      </div>
    </div>
  );
}

// Modo "Todos" — lista de controle de envio: nome expande/recolhe a
// mensagem (uma por vez, preserva edição), botão de ação à direita
// (Enviar mensagem / ✓ Mensagem enviada / WhatsApp não cadastrado) e
// contador de progresso. Estado de "enviado" é só desta rodada (reseta
// sempre que os dados mudam — nova geração ou novo período), nunca grava
// nada além do já existente "WhatsApp aberto" no histórico.
function AllMessagesList({ data, period }) {
  const [expandedId, setExpandedId] = useState("");
  const [messages, setMessages] = useState({});
  const [sentIds, setSentIds] = useState(() => new Set());

  useEffect(() => {
    setExpandedId("");
    setSentIds(new Set());
    setMessages(Object.fromEntries(data.items.map((item) => [item.brokerId, item.message])));
  }, [data]);

  const total = data.items.length;
  const sentCount = sentIds.size;

  function send(item) {
    const message = messages[item.brokerId] ?? item.message;
    const opened = openWhatsappAndLog({ brokerId: item.brokerId, phone: item.phone, message, period });
    if (opened) setSentIds((current) => new Set(current).add(item.brokerId));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-black uppercase tracking-wide text-muted">{data.periodLabel} — {total} corretor(es)</p>
        <p className="text-sm font-black text-navy">
          {total > 0 && sentCount === total ? "✓ Todos os corretores foram processados." : `${sentCount} de ${total} enviados`}
        </p>
      </div>

      <div className="divide-y divide-line rounded-2xl border border-line">
        {data.items.map((item) => {
          const expanded = expandedId === item.brokerId;
          const sent = sentIds.has(item.brokerId);
          const hasPhone = Boolean(buildWhatsAppUrl(item.phone));
          const currentMessage = messages[item.brokerId] ?? item.message;
          const hasInvalidChar = /�/.test(currentMessage);

          return (
            <div key={item.brokerId} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setExpandedId((current) => current === item.brokerId ? "" : item.brokerId)}
                  className="inline-flex items-center gap-1 font-black text-navy"
                >
                  {item.brokerName}
                  {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>

                {!hasPhone ? (
                  <span className="rounded-full bg-mist px-3 py-1.5 text-xs font-black text-muted">WhatsApp não cadastrado</span>
                ) : sent ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-black text-emerald-700">
                    <CheckCircle2 className="h-4 w-4" />Mensagem enviada
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => send(item)}
                    disabled={hasInvalidChar}
                    title={hasInvalidChar ? "Mensagem com caractere inválido — abra e corrija antes de enviar." : undefined}
                    className="inline-flex items-center gap-1.5 rounded-full bg-navy px-3 py-1.5 text-xs font-black text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
                  >
                    <Send className="h-3.5 w-3.5" />Enviar mensagem
                  </button>
                )}
              </div>

              {expanded ? (
                <textarea
                  className="mt-3 min-h-32 w-full rounded-2xl border border-line p-3 font-normal"
                  value={messages[item.brokerId] ?? item.message}
                  onChange={(event) => setMessages((current) => ({ ...current, [item.brokerId]: event.target.value }))}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RecentHistory() {
  const [log, setLog] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/admin/whatsapp-master/manual-log?limit=20")
      .then((response) => response.json())
      .then((payload) => setLog(payload.log || []))
      .catch(() => setError("Não foi possível carregar o histórico."));
  }, []);

  if (error) return <p className="text-sm font-bold text-red-700">{error}</p>;
  if (!log) return <p className="text-sm text-muted">Carregando histórico...</p>;
  if (!log.length) return <p className="text-sm text-muted">Nenhuma ação registrada ainda.</p>;

  return (
    <div className="overflow-x-auto rounded-2xl border border-line">
      <table className="w-full text-left text-sm">
        <thead className="bg-mist text-xs font-black uppercase text-muted">
          <tr>
            <th className="px-4 py-2">Corretor</th>
            <th className="px-4 py-2">Resumo</th>
            <th className="px-4 py-2">Ação</th>
            <th className="px-4 py-2">Quando</th>
          </tr>
        </thead>
        <tbody>
          {log.map((row) => (
            <tr key={row.id} className="border-t border-line">
              <td className="px-4 py-2 font-bold text-navy">{row.brokerName}</td>
              <td className="px-4 py-2">{PERIOD_OPTIONS.find((option) => option.value === row.summaryType)?.label || row.summaryType}</td>
              <td className="px-4 py-2">{ACTION_LABEL[row.action] || row.action}</td>
              <td className="px-4 py-2">{formatDateTime(row.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatDateTime(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : value;
}

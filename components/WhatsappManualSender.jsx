"use client";

import { useState } from "react";
import { ExternalLink, LoaderCircle, MessageCircle, Sparkles } from "lucide-react";
import { buildWhatsAppUrl } from "@/lib/phone-utils";

const PERIOD_OPTIONS = [
  { value: "today", label: "Resumo diário" },
  { value: "last7", label: "Resumo semanal" },
  { value: "last30", label: "Resumo mensal" }
];

export default function WhatsappManualSender({ brokers = [] }) {
  const [brokerId, setBrokerId] = useState("");
  const [period, setPeriod] = useState("today");
  const [message, setMessage] = useState("");
  const [periodLabel, setPeriodLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const broker = brokers.find((item) => item.id === brokerId) || null;

  async function generateMessage() {
    if (!brokerId) return setError("Selecione um corretor.");
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/admin/whatsapp-master/manual-summary?brokerId=${encodeURIComponent(brokerId)}&period=${encodeURIComponent(period)}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível gerar o resumo.");
      setMessage(payload.message);
      setPeriodLabel(payload.periodLabel);
    } catch (generateError) {
      setError(generateError.message);
    } finally {
      setBusy(false);
    }
  }

  function openWhatsapp() {
    if (!broker?.phone) return setError("Este corretor não tem WhatsApp cadastrado.");
    const url = buildWhatsAppUrl(broker.phone);
    if (!url) return setError("Telefone do corretor inválido.");
    window.open(`${url}?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
  }

  return (
    <section className="container-page mt-6 space-y-5 rounded-[28px] border border-line bg-white p-6 shadow-soft">
      <div>
        <p className="inline-flex items-center gap-2 text-sm font-black uppercase tracking-[0.12em] text-navy">
          <MessageCircle className="h-4 w-4" />WhatsApp Manual
        </p>
        <p className="mt-1 text-sm text-muted">
          Escolha o corretor e o resumo, gere a mensagem e abra seu próprio WhatsApp já com o texto pronto — você quem envia.
          Não depende de aprovação da Meta.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm font-black text-navy">
          Corretor
          <select className="mt-1 min-h-12 w-full rounded-2xl border border-line bg-white px-4" value={brokerId} onChange={(event) => { setBrokerId(event.target.value); setMessage(""); }}>
            <option value="">Selecione um corretor</option>
            {brokers.map((item) => (
              <option key={item.id} value={item.id} disabled={!item.phone}>
                {item.name}{!item.phone ? " (sem WhatsApp cadastrado)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-black text-navy">
          Mensagem
          <select className="mt-1 min-h-12 w-full rounded-2xl border border-line bg-white px-4" value={period} onChange={(event) => { setPeriod(event.target.value); setMessage(""); }}>
            {PERIOD_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
      </div>

      <button type="button" onClick={generateMessage} disabled={busy || !brokerId} className="premium-button-secondary">
        {busy ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
        Gerar mensagem
      </button>

      {error ? <p className="rounded-2xl bg-red-50 px-4 py-3 font-bold text-red-700">{error}</p> : null}

      {message ? (
        <div className="space-y-3">
          <p className="text-xs font-black uppercase tracking-wide text-muted">{periodLabel} — pode editar antes de enviar</p>
          <textarea className="min-h-40 w-full rounded-2xl border border-line p-4 font-normal" value={message} onChange={(event) => setMessage(event.target.value)} />
          <button type="button" onClick={openWhatsapp} className="premium-button-primary">
            <ExternalLink className="h-5 w-5" />
            Abrir WhatsApp e enviar
          </button>
        </div>
      ) : null}
    </section>
  );
}

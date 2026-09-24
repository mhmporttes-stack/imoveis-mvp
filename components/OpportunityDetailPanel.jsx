"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { X, LoaderCircle, Phone, CalendarPlus, ExternalLink } from "lucide-react";
import { buildWhatsAppUrl, toWhatsAppDigits } from "@/lib/phone-utils";
import { resolveClientWhatsappDestination } from "@/lib/whatsapp-contact-channel";

const STAGE_LABELS = {
  service: "Atendimento",
  simulation: "Simulação",
  documentation: "Aguardando documentação",
  approval: "Aguardando aprovação",
  approved: "Cliente aprovado",
  meeting: "Reunião",
  sale: "Venda"
};

export default function OpportunityDetailPanel({ clientId, onClose, onActionCompleted }) {
  const [opportunity, setOpportunity] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [scheduling, setScheduling] = useState(false);
  const [scheduleDraft, setScheduleDraft] = useState({ date: "", time: "", note: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!clientId) return;
    load();
  }, [clientId]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/opportunities/${clientId}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Falha ao carregar oportunidade.");
      setOpportunity(payload.opportunity);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleWhatsApp() {
    if (!opportunity) return;
    const value = opportunity.phoneNormalized;
    // Dentro da janela de 24h o atendimento abre no Chat (número oficial); fora
    // dela abre o WhatsApp do próprio corretor. Em ambos os casos o botão
    // continua registrando o contato (mesma API de sempre).
    if (!toWhatsAppDigits(value)) {
      alert("Este cliente não possui um WhatsApp válido.");
      return;
    }
    const whatsappWindow = window.open("about:blank", "_blank");
    setBusy(true);
    try {
      const [response, destination] = await Promise.all([
        fetch(`/api/simulation-registrations/${opportunity.id}/whatsapp-contact`, { method: "POST" }),
        resolveClientWhatsappDestination(opportunity.id, value)
      ]);
      const whatsapp = destination.url;
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível registrar o contato.");
      if (whatsappWindow) { whatsappWindow.opener = null; whatsappWindow.location.href = whatsapp; }
      await load();
      onActionCompleted?.();
    } catch (whatsappError) {
      if (whatsappWindow) whatsappWindow.close();
      alert(whatsappError.message || "Não foi possível abrir o WhatsApp.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveSchedule() {
    const date = scheduleDraft.date.trim();
    const time = scheduleDraft.time.trim();
    const note = scheduleDraft.note.trim();
    if (!date) { alert("Selecione o dia da atividade."); return; }
    if (!time) { alert("Selecione o horário da atividade."); return; }
    if (!note) { alert("Explique rapidamente qual é a atividade."); return; }

    setBusy(true);
    try {
      const response = await fetch(`/api/simulation-registrations/${opportunity.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduledActivityDate: date, scheduledActivityTime: time, scheduledActivityType: "follow_up", scheduledActivityNote: note })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível agendar a atividade.");
      setScheduling(false);
      setScheduleDraft({ date: "", time: "", note: "" });
      await load();
      onActionCompleted?.();
    } catch (scheduleError) {
      alert(scheduleError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex justify-end bg-navy/40" role="dialog" aria-modal="true" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="flex h-full w-full max-w-md flex-col overflow-y-auto bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm font-black uppercase tracking-[0.1em] text-navy">Detalhe da oportunidade</p>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 text-muted hover:bg-mist" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>

        {loading ? <div className="flex justify-center py-10"><LoaderCircle className="h-6 w-6 animate-spin text-brand" /></div> : null}
        {error ? <p className="rounded-2xl bg-red-50 px-4 py-3 font-bold text-red-700">{error}</p> : null}

        {!loading && opportunity ? (
          <div className="space-y-5">
            <div>
              <h2 className="text-2xl font-black text-navy">{opportunity.fullName}</h2>
              <p className="mt-1 text-sm font-bold text-muted">{STAGE_LABELS[opportunity.stage] || "Prospecção"}</p>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center">
              <Metric label="Score" value={opportunity.score} />
              <Metric label="Urgência" value={opportunity.urgency} />
              <Metric label="Prioridade" value={`${opportunity.priority}${opportunity.categoryEmoji || ""}`} />
            </div>

            <div>
              <p className="text-xs font-black uppercase tracking-wide text-muted">Por que essa prioridade?</p>
              <ul className="mt-2 space-y-1">
                {opportunity.reasons.map((reason) => (
                  <li key={reason} className="text-sm text-navy">• {reason}</li>
                ))}
              </ul>
            </div>

            <div className="rounded-2xl border border-brand/20 bg-brand/5 p-4">
              <p className="text-xs font-black uppercase tracking-wide text-brand">Próxima melhor ação</p>
              <p className="mt-1 font-bold text-navy">{opportunity.recommendedAction.label}</p>
            </div>

            {scheduling ? (
              <div className="space-y-2 rounded-2xl border border-line p-4">
                <label className="block text-sm font-bold text-navy">Data
                  <input type="date" className="mt-1 w-full rounded-lg border border-line p-2" value={scheduleDraft.date} onChange={(event) => setScheduleDraft((current) => ({ ...current, date: event.target.value }))} />
                </label>
                <label className="block text-sm font-bold text-navy">Horário
                  <input type="time" className="mt-1 w-full rounded-lg border border-line p-2" value={scheduleDraft.time} onChange={(event) => setScheduleDraft((current) => ({ ...current, time: event.target.value }))} />
                </label>
                <label className="block text-sm font-bold text-navy">Nota
                  <input type="text" className="mt-1 w-full rounded-lg border border-line p-2" value={scheduleDraft.note} onChange={(event) => setScheduleDraft((current) => ({ ...current, note: event.target.value }))} />
                </label>
                <div className="flex gap-2">
                  <button type="button" disabled={busy} onClick={handleSaveSchedule} className="premium-button-primary flex-1">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}Salvar</button>
                  <button type="button" onClick={() => setScheduling(false)} className="premium-button-secondary">Cancelar</button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <ActionButton onClick={handleWhatsApp} disabled={busy} label="WhatsApp" />
                <a href={`tel:${opportunity.phoneNormalized}`} className="premium-button-secondary justify-center"><Phone className="h-4 w-4" />Ligar</a>
                <button type="button" onClick={() => setScheduling(true)} className="premium-button-secondary justify-center"><CalendarPlus className="h-4 w-4" />Agendar</button>
                <Link href={`/admin/simulacoes?clientId=${opportunity.id}`} className="premium-button-secondary justify-center"><ExternalLink className="h-4 w-4" />Abrir cliente</Link>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="rounded-2xl border border-line p-3">
      <p className="text-xl font-black text-navy">{value}</p>
      <p className="text-[11px] font-bold uppercase text-muted">{label}</p>
    </div>
  );
}

function ActionButton({ onClick, disabled, label }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="premium-button-primary justify-center">
      {disabled ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}{label}
    </button>
  );
}

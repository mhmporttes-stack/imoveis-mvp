"use client";

import { useState } from "react";
import { BellPlus, Loader2, Sparkles, X } from "lucide-react";
import { reminderScheduledAt, reminderTitle, replySuggestionBlocked } from "@/lib/whatsapp-chat-assist-core.mjs";

// Barra de apoio do compositor do Chat (WA-37, dono, 2026-10-30):
// - "Sugerir resposta": a IA PREENCHE a caixa com um rascunho; quem envia é o corretor (nunca envio automático).
// - "Me lembre": cria uma atividade na Agenda (calendar_activities, rota de sempre) vinculada ao cliente da conversa;
//   o aviso no horário é o mesmo das atividades agendadas. Nada é enviado ao cliente.
export default function WhatsappChatAssistBar({ conversation, disabled = false, onSuggestion }) {
  const [suggesting, setSuggesting] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [notice, setNotice] = useState(null); // { tone: "ok" | "error", text }
  // Mesma régua do servidor (replySuggestionBlocked); telefone "Não contactar" de outro cadastro o servidor recusa (409).
  const suggestionOff = !conversation.summaryAvailable || replySuggestionBlocked({ clientStatus: conversation.client?.status || "", isGroup: Boolean(conversation.isGroup) });

  async function suggest() {
    setSuggesting(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/admin/whatsapp-chat/conversations/${conversation.id}/suggest-reply`, { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.text) throw new Error(data.error || "Não foi possível sugerir uma resposta.");
      onSuggestion(data.text);
      setNotice({ tone: "ok", text: "Rascunho da IA na caixa — revise antes de enviar." });
    } catch (error) {
      setNotice({ tone: "error", text: error.message });
    } finally {
      setSuggesting(false);
    }
  }

  return (
    <div className="mb-1.5">
      <div className="flex flex-wrap items-center gap-1.5 px-1">
        {!suggestionOff ? (
          <button type="button" onClick={suggest} disabled={disabled || suggesting} className="inline-flex min-h-8 items-center gap-1 rounded-full border border-line bg-white px-3 text-xs font-extrabold text-navy hover:border-brand disabled:opacity-50">
            {suggesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}
            {suggesting ? "Sugerindo…" : "Sugerir resposta"}
          </button>
        ) : null}
        <button type="button" onClick={() => { setReminderOpen((value) => !value); setNotice(null); }} aria-expanded={reminderOpen} className="inline-flex min-h-8 items-center gap-1 rounded-full border border-line bg-white px-3 text-xs font-extrabold text-navy hover:border-brand">
          <BellPlus className="h-3.5 w-3.5" aria-hidden="true" />Me lembre
        </button>
        {notice ? <span role="status" className={`text-[11px] font-bold ${notice.tone === "error" ? "text-red-700" : "text-[#0A5C30]"}`}>{notice.text}</span> : null}
      </div>
      {reminderOpen ? <ReminderForm conversation={conversation} onClose={() => setReminderOpen(false)} onDone={(text) => { setReminderOpen(false); setNotice({ tone: "ok", text }); }} /> : null}
    </div>
  );
}

const QUICK = [
  { key: "in_1h", label: "Em 1 hora" },
  { key: "today_18", label: "Hoje 18h" },
  { key: "tomorrow_9", label: "Amanhã 9h" },
  { key: "custom", label: "Escolher" }
];

function ReminderForm({ conversation, onClose, onDone }) {
  const [choice, setChoice] = useState("in_1h");
  const [custom, setCustom] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const contactName = conversation.client?.name || conversation.name || conversation.phone || "";

  async function save(event) {
    event.preventDefault();
    const scheduledAt = reminderScheduledAt(choice, { custom });
    if (!scheduledAt) { setError("Escolha um horário no futuro."); return; }
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/calendar-activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: reminderTitle(contactName),
          scheduledAt,
          clientId: conversation.client?.id || null,
          activityType: "follow_up",
          note: [note.trim(), "Lembrete criado no Chat do WhatsApp."].filter(Boolean).join(" — ")
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível criar o lembrete.");
      const when = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(scheduledAt));
      onDone(`Lembrete na Agenda para ${when.replace(",", " às")}.`);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="mx-1 mt-1.5 rounded-2xl border border-line bg-white p-3 text-xs text-navy shadow-soft">
      <div className="flex items-center justify-between gap-2">
        <p className="font-black">Me lembre de voltar nesta conversa</p>
        <button type="button" onClick={onClose} aria-label="Fechar" className="grid h-8 w-8 place-items-center"><X className="h-4 w-4" /></button>
      </div>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {QUICK.map((item) => (
          <button key={item.key} type="button" aria-pressed={choice === item.key} onClick={() => setChoice(item.key)} className={`min-h-8 rounded-full border px-3 font-extrabold ${choice === item.key ? "border-navy bg-navy text-white" : "border-line bg-white text-navy"}`}>{item.label}</button>
        ))}
      </div>
      {choice === "custom" ? <input type="datetime-local" value={custom} onChange={(event) => setCustom(event.target.value)} className="mt-2 min-h-9 w-full rounded-xl border border-line px-2" aria-label="Data e hora do lembrete" /> : null}
      <input type="text" value={note} maxLength={300} onChange={(event) => setNote(event.target.value)} placeholder="Anotação (opcional)" className="mt-2 min-h-9 w-full rounded-xl border border-line px-2" aria-label="Anotação do lembrete" />
      <p className="mt-1.5 text-[11px] font-semibold text-muted">Vai para a sua Agenda e você recebe o aviso no horário. Nada é enviado ao cliente.</p>
      {error ? <p role="alert" className="mt-1 font-bold text-red-700">{error}</p> : null}
      <button type="submit" disabled={saving} className="mt-2 inline-flex min-h-9 items-center gap-1 rounded-full bg-navy px-4 font-extrabold text-white disabled:opacity-50">
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}Criar lembrete
      </button>
    </form>
  );
}

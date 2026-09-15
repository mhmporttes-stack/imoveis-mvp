"use client";

import { useState } from "react";
import { Check, MessageCircle, Pencil } from "lucide-react";

// Vermelho/laranja/verde: exceção semântica só deste indicador — o resto da
// tela continua usando a identidade azul/navy padrão do CRM.
function progressColor(percent) {
  if (percent >= 100) return { stroke: "#059669", ring: "text-emerald-600", chip: "bg-emerald-50 text-emerald-700" };
  if (percent >= 50) return { stroke: "#ea580c", ring: "text-orange-600", chip: "bg-orange-50 text-orange-700" };
  return { stroke: "#dc2626", ring: "text-red-600", chip: "bg-red-50 text-red-700" };
}

const RADIUS = 45;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const GROUPS = [
  { key: "new", title: "Novos contatos", chipLabel: "Novos" },
  { key: "second", title: "2º contato", chipLabel: "2º contato" },
  { key: "third", title: "Última tentativa", chipLabel: "Última tentativa" }
];

export default function DailyGoalDashboard({ initialGoal }) {
  const [goal, setGoal] = useState(initialGoal);
  const [error, setError] = useState("");

  if (!goal) {
    return (
      <section className="container-page rounded-[24px] border border-line bg-white p-10 text-center shadow-soft">
        <p className="font-bold text-muted">Não foi possível carregar sua Meta Diária agora.</p>
      </section>
    );
  }

  const colors = progressColor(goal.percent);

  async function handleAttempt(roundId, message) {
    setError("");
    const response = await fetch("/api/daily-goal/attempt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roundId, message })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(data.error || "Não foi possível registrar a tentativa.");
      return;
    }
    if (data.whatsappUrl) window.open(data.whatsappUrl, "_blank", "noopener,noreferrer");
    const refreshed = await fetch("/api/daily-goal");
    if (refreshed.ok) setGoal(await refreshed.json());
  }

  // Salvar o texto editado como padrão pessoal do corretor é uma ação própria,
  // separada de enviar — sem isso, só saberíamos que a edição "pegou" enviando
  // de verdade, o que não dá pra testar antes de decidir.
  async function handleSaveTemplate(roundId, text) {
    setError("");
    const response = await fetch("/api/daily-goal/message-override", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roundId, text })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(data.error || "Não foi possível salvar a mensagem.");
      return false;
    }
    const refreshed = await fetch("/api/daily-goal");
    if (refreshed.ok) setGoal(await refreshed.json());
    return true;
  }

  return (
    <section className="container-page space-y-8">
      <div className="rounded-[28px] border border-navy/10 bg-white p-6 shadow-soft md:p-8">
        <div className="flex flex-col items-center gap-3">
          <div className="relative h-40 w-40 motion-reduce:[&_circle]:!transition-none">
            <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
              <circle cx="50" cy="50" r={RADIUS} fill="none" stroke="#E5EAF1" strokeWidth="9" />
              <circle
                cx="50" cy="50" r={RADIUS} fill="none"
                stroke={colors.stroke} strokeWidth="9" strokeLinecap="round"
                strokeDasharray={CIRCUMFERENCE}
                strokeDashoffset={CIRCUMFERENCE * (1 - Math.min(100, goal.percent) / 100)}
                style={{ transition: "stroke-dashoffset 0.7s ease-out, stroke 0.4s ease-out" }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={`text-3xl font-black ${colors.ring}`}>{goal.percent}%</span>
            </div>
          </div>
          <p className="text-center text-sm font-bold text-muted">
            {goal.done} de {goal.total} atividades concluídas
          </p>
          {goal.percent >= 100 ? (
            <p className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-4 py-1.5 text-sm font-black text-emerald-700">
              Meta diária concluída ✓
            </p>
          ) : null}
        </div>

        <div className="mt-6 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          {GROUPS.map((group) => (
            <div key={group.key} className="rounded-2xl border border-line bg-mist/40 px-4 py-3 text-center">
              <p className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-muted">{group.chipLabel}</p>
              <p className="mt-1 text-xl font-black text-navy">{goal.groups[group.key].done} / {goal.groups[group.key].total}</p>
              {group.key === "new" && goal.groups.new.pendingCarriedOver > 0 ? (
                <p className="mt-1 text-[11px] font-bold text-muted">
                  {goal.groups.new.pendingToday} de hoje · {goal.groups.new.pendingCarriedOver} de dias anteriores
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      {error ? <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</p> : null}

      {GROUPS.map((group) => (
        <ClientGroup key={group.key} title={group.title} clients={goal.groups[group.key].clients} onSend={handleAttempt} onSaveTemplate={handleSaveTemplate} />
      ))}
    </section>
  );
}

function ClientGroup({ title, clients, onSend, onSaveTemplate }) {
  return (
    <div>
      <h2 className="mb-3 text-lg font-black uppercase tracking-[0.08em] text-navy">{title}</h2>
      {clients.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {clients.map((client) => (
            <ClientCard key={client.roundId} client={client} onSend={onSend} onSaveTemplate={onSaveTemplate} />
          ))}
        </div>
      ) : (
        <p className="rounded-[20px] border border-line bg-white p-5 text-center text-sm font-bold text-muted">
          {emptyStateLabel(title)}
        </p>
      )}
    </div>
  );
}

function emptyStateLabel(title) {
  if (title === "Novos contatos") return "Nenhum novo cliente disponível para distribuição no momento.";
  if (title === "2º contato") return "Nenhum 2º contato pendente hoje.";
  return "Nenhuma última tentativa pendente hoje.";
}

function ClientCard({ client, onSend, onSaveTemplate }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(client.previewMessage);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function send() {
    setBusy(true);
    try {
      await onSend(client.roundId, editing ? text : undefined);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      const ok = await onSaveTemplate(client.roundId, text);
      if (ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="rounded-[18px] border border-line bg-white p-4 shadow-[0_12px_30px_rgba(13,59,102,0.06)]">
      <h3 className="truncate text-base font-black text-navy">{client.fullName}</h3>
      <p className="text-xs font-bold text-muted">{client.clientCode}</p>
      <p className="mt-2 text-[11px] font-extrabold uppercase tracking-[0.1em] text-brand">{client.attemptNumber}º contato</p>

      {editing ? (
        <>
          <textarea
            className="mt-3 w-full rounded-xl border border-line p-3 text-sm font-normal text-navy outline-none focus:border-brand"
            rows={4}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <button
            className="mt-2 inline-flex items-center gap-1.5 text-xs font-extrabold text-brand disabled:opacity-50"
            disabled={saving || !text.trim()}
            onClick={save}
            type="button"
          >
            {saved ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : null}
            {saved ? "Salvo como seu padrão" : saving ? "Salvando…" : "Salvar como meu padrão"}
          </button>
        </>
      ) : null}

      <div className="mt-3 flex items-center gap-2">
        <button
          className="premium-button-secondary flex-1"
          disabled={busy}
          onClick={send}
          type="button"
        >
          <MessageCircle className="h-4 w-4" /> WhatsApp
        </button>
        {client.allowPersonalization ? (
          <button
            aria-label="Editar mensagem"
            className="icon-button"
            onClick={() => setEditing((current) => !current)}
            type="button"
          >
            <Pencil className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    </article>
  );
}

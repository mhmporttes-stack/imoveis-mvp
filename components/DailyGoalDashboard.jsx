"use client";

import { useState } from "react";
import { Check, MessageCircle, Pencil } from "lucide-react";
import RevealCard from "@/components/motion/RevealCard";
import AnimatedRing from "@/components/motion/AnimatedRing";
import AnimatedNumber from "@/components/motion/AnimatedNumber";
import { StaggerContainer, StaggerItem } from "@/components/motion/StaggerReveal";
import DailyGoalAutoPanel from "@/components/DailyGoalAutoPanel";

// Vermelho/laranja/verde: exceção semântica só deste indicador — o resto da
// tela continua usando a identidade azul/navy padrão do CRM. A cor do anel e
// do percentual acompanha o valor em tempo real durante a animação (0%
// vermelho, 50% laranja, 100% verde), não só o resultado final.
const PROGRESS_COLOR_STOPS = ["#dc2626", "#ea580c", "#059669"];
const PROGRESS_COLOR_POSITIONS = [0, 50, 100];

const RADIUS = 45;

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

  // Devolve a URL pro chamador abrir (nunca abre aqui) — quem chama já
  // abriu uma aba em branco de forma síncrona, no clique, antes deste fetch;
  // window.open só depois do fetch resolver é bloqueado como pop-up em
  // vários navegadores (mesmo padrão de correção já usado em
  // ClientJourneyActions.jsx).
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
      return null;
    }
    const refreshed = await fetch("/api/daily-goal");
    if (refreshed.ok) setGoal(await refreshed.json());
    return data.whatsappUrl || null;
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
      <RevealCard className="rounded-[28px] border border-navy/10 bg-white p-6 shadow-soft md:p-8">
        <div className="flex flex-col items-center gap-3">
          <div className="relative h-40 w-40">
            <AnimatedRing
              percent={goal.percent}
              radius={RADIUS}
              colorStops={PROGRESS_COLOR_STOPS}
              colorStopPositions={PROGRESS_COLOR_POSITIONS}
              introOvershoot
              introDuration={3}
              className="h-full w-full"
            />
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <AnimatedNumber
                value={goal.percent}
                format={(n) => `${Math.round(n)}%`}
                introOvershoot
                introDuration={3}
                colorStops={PROGRESS_COLOR_STOPS}
                colorStopPositions={PROGRESS_COLOR_POSITIONS}
                className="text-3xl font-black"
              />
            </div>
          </div>
          <ul className="w-full max-w-xs space-y-1.5">
            <GoalLine
              label="Prospecção"
              done={goal.prospecting?.done ?? goal.realizedToday ?? goal.done}
              total={goal.prospecting?.target ?? goal.quota ?? goal.total}
              completed={goal.prospecting?.completed ?? goal.percent >= 100}
            />
            {goal.pending?.total > 0 ? (
              <GoalLine
                label="Pendentes"
                done={goal.pending.done}
                total={goal.pending.total}
                completed={goal.pending.completed}
                remaining={goal.pending.remaining}
              />
            ) : null}
          </ul>
          {goal.pending?.remaining > 0 ? (
            <a href="/admin/simulacoes?pending=1" className="text-xs font-black text-brand underline-offset-2 hover:underline">
              Ver clientes pendentes
            </a>
          ) : null}
          {goal.pending?.total > 0 ? (
            <p className="text-center text-[11px] font-bold text-muted">
              A meta de hoje soma prospecção + pendentes ({goal.totalRequired} atividades). Pendentes de hoje ficam fixos até amanhã.
            </p>
          ) : null}
          {goal.percent >= 100 ? (
            <p className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-4 py-1.5 text-sm font-black text-emerald-700">
              Meta diária concluída ✓
            </p>
          ) : null}
        </div>

        {goal.wallet ? (
          <div className="mt-5 rounded-2xl border border-line bg-mist/40 px-4 py-3">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-muted">Carteira ativa</p>
              <p className={`text-sm font-black ${goal.wallet.atLimit ? "text-red-600" : "text-navy"}`}>{goal.wallet.current}/{goal.wallet.limit}</p>
            </div>
            <p className="mt-1 text-[11px] font-bold text-muted">
              1ª: {goal.wallet.byAttempt.first} · 2ª: {goal.wallet.byAttempt.second} · 3ª: {goal.wallet.byAttempt.third}
            </p>
            {goal.wallet.atLimit ? (
              <p className="mt-2 text-xs font-bold text-red-700">
                Sua carteira atingiu o limite configurado ({goal.wallet.limit}). Conclua ou encerre atendimentos pendentes para liberar espaço para novos contatos.
              </p>
            ) : null}
          </div>
        ) : null}

        <StaggerContainer className="mt-6 grid grid-cols-1 gap-2.5 sm:grid-cols-3" delayChildren={0.15}>
          {GROUPS.map((group) => (
            <StaggerItem key={group.key} className="rounded-2xl border border-line bg-mist/40 px-4 py-3 text-center">
              <p className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-muted">{group.chipLabel}</p>
              <p className="mt-1 text-xl font-black text-navy">{goal.groups[group.key].done} / {goal.groups[group.key].total}</p>
              {group.key === "new" && goal.groups.new.pendingCarriedOver > 0 ? (
                <p className="mt-1 text-[11px] font-bold text-muted">
                  {goal.groups.new.pendingToday} de hoje · {goal.groups.new.pendingCarriedOver} de dias anteriores
                </p>
              ) : null}
            </StaggerItem>
          ))}
        </StaggerContainer>
      </RevealCard>

      <DailyGoalAutoPanel />

      {goal.prospectingBlocked ? (
        <p role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
          <span>Conecte seu WhatsApp para receber novos clientes de Prospecção e executar a Meta Diária.</span>
          <button type="button" className="rounded-full bg-amber-600 px-3 py-1.5 text-xs font-black text-white" onClick={() => window.dispatchEvent(new CustomEvent("crm:open-whatsapp-connect"))}>Conectar WhatsApp</button>
        </p>
      ) : null}
      {error ? <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</p> : null}

      <StaggerContainer className="space-y-8" staggerChildren={0.08} delayChildren={0.2}>
        {GROUPS.map((group) => (
          <StaggerItem key={group.key}>
            <ClientGroup
              title={group.title}
              clients={goal.groups[group.key].clients}
              doneToday={goal.groups[group.key].doneToday}
              onSend={handleAttempt}
              onSaveTemplate={handleSaveTemplate}
            />
          </StaggerItem>
        ))}
      </StaggerContainer>
    </section>
  );
}

// Uma obrigação do dia: "Prospecção 80/100" ou "Pendentes 20/30 · faltam 10";
// quando concluída ganha o ✓ (ex.: "✓ Prospecção 104/100"). Pode passar do total
// na prospecção (cada contato extra vale +1%); pendente nunca passa de 100%.
function GoalLine({ label, done, total, completed, remaining = 0 }) {
  return (
    <li className={`flex items-center justify-center gap-1.5 text-sm font-black ${completed ? "text-emerald-700" : "text-navy"}`}>
      {completed ? <Check className="h-4 w-4" aria-label="concluído" /> : null}
      <span>{label} {done}/{total}</span>
      {!completed && remaining > 0 ? <span className="text-xs font-bold text-muted">· faltam {remaining}</span> : null}
    </li>
  );
}

// Sugestão do dono: quem já recebeu a tentativa de hoje não deve sumir nem
// pular de seção — fica visível aqui mesmo, com um "realizado hoje", e só
// migra pra próxima etapa amanhã (regra que já existia no cálculo de
// pendências, ver lib/daily-goal.js — isto só deixa o resultado visível).
function ClientGroup({ title, clients, doneToday = [], onSend, onSaveTemplate }) {
  const hasAny = clients.length > 0 || doneToday.length > 0;
  return (
    <div>
      <h2 className="mb-3 text-lg font-black uppercase tracking-[0.08em] text-navy">{title}</h2>
      {hasAny ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {doneToday.map((client) => (
            <DoneTodayCard key={client.roundId} client={client} />
          ))}
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

function DoneTodayCard({ client }) {
  return (
    <article className="rounded-[18px] border border-dashed border-emerald-200 bg-emerald-50/50 p-4">
      <h3 className="truncate text-base font-black text-navy">{client.fullName}</h3>
      <p className="text-xs font-bold text-muted">{client.clientCode}</p>
      <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-[0.1em] text-emerald-700">
        <Check className="h-3.5 w-3.5" /> {client.attemptNumber}º contato realizado hoje
      </p>
      <p className="mt-1 text-[11px] font-bold text-muted">Segue pra próxima etapa amanhã.</p>
    </article>
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
    // Abre a aba em branco AGORA, no clique — ainda sincronamente ligado ao
    // gesto do usuário — e só troca a URL dela depois que a tentativa for
    // registrada. Abrir só depois do fetch é bloqueado como pop-up em vários
    // navegadores (é o que fazia o botão "não abrir o WhatsApp" na Meta
    // Diária, ao contrário do card de Prospecção que abre de outro jeito).
    const popup = window.open("about:blank", "_blank");
    if (popup) popup.opener = null;
    setBusy(true);
    try {
      const whatsappUrl = await onSend(client.roundId, editing ? text : undefined);
      if (whatsappUrl) {
        if (popup) popup.location.href = whatsappUrl;
        else window.location.assign(whatsappUrl);
      } else {
        popup?.close();
      }
    } catch (error) {
      popup?.close();
      throw error;
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

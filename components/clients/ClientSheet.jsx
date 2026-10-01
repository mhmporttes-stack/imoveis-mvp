"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  Calculator,
  CalendarPlus,
  Check,
  ChevronDown,
  Clock,
  ExternalLink,
  FileText,
  MessageCircle,
  Pencil,
  Phone,
  Plus,
  Trash2,
  TriangleAlert,
  X
} from "lucide-react";
import CcaStatusCard from "@/components/CcaStatusCard";
import ClientDocumentsModal from "@/components/ClientDocumentsModal";
import ClientJourneyActions from "@/components/ClientJourneyActions";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { inputClasses } from "@/components/ui/Field";
import Sheet from "@/components/ui/Sheet";
import { cx } from "@/components/ui/cx";
import { CLIENT_STATUS } from "@/lib/client-status";
import { getDoNotContactReasonOptions } from "@/lib/do-not-contact-reasons";
import { getPropertyPreferenceDetails, getPropertyPreferenceSummary } from "@/lib/property-preferences";
import {
  booleanLabel,
  calculateFamilyIncome,
  formatCurrency,
  formatDateBR,
  formatDateTimeBR,
  hasSimulationData,
  incomeTypeLabel,
  maritalStatusLabel,
  realBirthDate,
  simulationTypeLabel
} from "@/lib/simulation-registration-format";
import { formatMoneyBR } from "@/lib/simulation-list-utils";
import StatusOptions from "./StatusOptions";
import { ACTIVITY_TYPE_OPTIONS, TAG_COLORS, clientPhone, formatAgo, formatFullDateTime, formatWhen, getScheduleDraft, getUrgencySignal } from "./client-format";

const DO_NOT_CONTACT_REASONS = getDoNotContactReasonOptions();

// `focus` abre a ficha já no ponto pedido pelo card: "agenda" (formulário de
// agendamento aberto), "tags" (editor aberto) ou "documents" (modal).
export default function ClientSheet({ client, list, open, onClose, canManage, canReturnAssignedProspecting, isOwner, responsibleName, focus = "" }) {
  const [showDocuments, setShowDocuments] = useState(false);
  useEffect(() => {
    if (!open || !focus) return undefined;
    if (focus === "documents") {
      setShowDocuments(true);
      return undefined;
    }
    const timer = setTimeout(() => {
      document.getElementById(`ficha-${focus}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 80);
    return () => clearTimeout(timer);
  }, [open, focus, client?.id]);
  if (!client) return <Sheet open={false} onClose={onClose} title="" />;

  const activities = list.activitiesFor(client);
  const busy = list.busyClientId === client.id;
  const registration = client.registration;
  const urgency = getUrgencySignal(client, activities);
  const tags = Array.isArray(client.tags) ? client.tags : [];
  const phone = clientPhone(client);

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        side="auto"
        className="ui-sheet-wide"
        title={client.name || "Cliente sem nome"}
        description={[registration?.clientCode, phone].filter(Boolean).join(" · ")}
      >
        <div className="space-y-6" aria-busy={busy || undefined}>
          {/* Ações principais */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Button className="col-span-2 sm:col-span-3" onClick={() => list.openWhatsApp(client)} disabled={busy}>
              <MessageCircle className="h-4 w-4" aria-hidden="true" /> WhatsApp
            </Button>
            <Button variant="secondary" onClick={() => setShowDocuments(true)} disabled={busy || !registration?.id}>
              <FileText className="h-4 w-4" aria-hidden="true" /> Documentos
            </Button>
            <Button variant="secondary" onClick={() => list.openSimulation(client)} disabled={busy}>
              <ExternalLink className="h-4 w-4" aria-hidden="true" /> Empreendimentos
            </Button>
            <Button variant="secondary" className="col-span-2 sm:col-span-1" onClick={() => list.openValues(client)} disabled={busy}>
              <Calculator className="h-4 w-4" aria-hidden="true" /> Valores
            </Button>
          </div>

          {/* Situação */}
          <Section title="Situação">
            <div className="grid gap-3 sm:grid-cols-2">
              <StatusSelect client={client} busy={busy} onChange={(status) => list.updateClientStatus(client, status)} />
              {canManage ? (
                <LabeledSelect
                  label="Responsável"
                  value={registration?.responsibleUserId || ""}
                  disabled={busy}
                  onChange={(value) => list.updateClientResponsibleUser(client, value)}
                >
                  <option value="">Sem corretor</option>
                  {list.responsibleProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                </LabeledSelect>
              ) : (
                <div>
                  <p className="text-xs font-medium text-muted">Responsável</p>
                  <p className="mt-1 flex min-h-touch items-center text-sm font-medium text-ink">{responsibleName}</p>
                </div>
              )}
            </div>
            {urgency ? (
              <Badge tone={urgency.tone} icon={TriangleAlert} className="mt-3">{urgency.label}</Badge>
            ) : null}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {registration ? <CcaStatusCard clientId={registration.id} clientStatus={client.status} canManage={canManage} /> : null}
            </div>
            {registration ? <ClientJourneyActions registration={registration} canManage={canManage} responsibleName={responsibleName} tags={tags} /> : null}
          </Section>

          <ProspectingActions client={client} busy={busy} list={list} canReturnAssignedProspecting={canReturnAssignedProspecting} />

          {/* Agenda */}
          <Section title="Agenda do cliente" anchor="ficha-agenda">
            <AgendaPanel client={client} activities={activities} busy={busy} list={list} autoStart={focus === "agenda"} />
          </Section>

          {/* Simulação */}
          <Section title="Simulação">
            <SimulationSummary client={client} />
          </Section>

          {/* Tags */}
          <Section title="Tags" anchor="ficha-tags">
            <TagsPanel client={client} tags={tags} busy={busy} list={list} autoEdit={focus === "tags"} />
          </Section>

          {/* Cadastro */}
          <Section title="Cadastro">
            <RegistrationDetails client={client} />
          </Section>

          {isOwner ? (
            <Section title="Zona de exclusão">
              <p className="text-sm text-ink-2">Exclui o cadastro e a simulação vinculada. Não pode ser desfeito.</p>
              <Button
                variant="danger-ghost"
                className="mt-2 -ml-3"
                disabled={busy}
                onClick={async () => { if (await list.removeClient(client)) onClose(); }}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" /> Excluir cliente
              </Button>
            </Section>
          ) : null}
        </div>
      </Sheet>

      {showDocuments && registration?.id ? (
        <ClientDocumentsModal
          client={{ id: registration.id, fullName: client.name || "Cliente" }}
          canSendToCca={canManage}
          canManage={canManage}
          canEditRules={isOwner}
          onClose={() => setShowDocuments(false)}
        />
      ) : null}

      <DoNotContactDialog
        client={list.dncTarget}
        onCancel={list.cancelDoNotContact}
        onConfirm={list.confirmDoNotContact}
      />

      <ReceivedDateDialog
        target={list.receivedDateTarget}
        onCancel={list.cancelReceivedDate}
        onConfirm={list.confirmReceivedDate}
      />
    </>
  );
}

function Section({ title, anchor, children }) {
  const id = useId();
  return (
    <section id={anchor} aria-labelledby={id} className="scroll-mt-2 border-t border-line pt-5 first:border-t-0 first:pt-0">
      <h3 id={id} className="mb-3 text-2xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
      {children}
    </section>
  );
}

function LabeledSelect({ label, value, disabled, onChange, children }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="text-xs font-medium text-muted">{label}</label>
      <div className="relative mt-1">
        <select id={id} className={cx(inputClasses, "appearance-none pr-9 font-medium")} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
      </div>
    </div>
  );
}

function StatusSelect({ client, busy, onChange }) {
  return (
    <LabeledSelect label="Etapa" value={client.status} disabled={busy} onChange={onChange}>
      <StatusOptions current={client.status} />
    </LabeledSelect>
  );
}

function ProspectingActions({ client, busy, list, canReturnAssignedProspecting }) {
  const registration = client.registration;
  if (!registration?.prospectingContactId) return null;
  const pending = registration.prospectingAssignedPending;
  const awaitingReturn = client.status === CLIENT_STATUS.AWAITING_RETURN;
  const canReturn = canReturnAssignedProspecting && registration.prospectingAssignedByUserId;
  if (!pending && !awaitingReturn && !(client.status === CLIENT_STATUS.IN_SERVICE && canReturn)) return null;

  return (
    <div className="rounded-card border border-info-line bg-info-soft p-4">
      <p className="text-sm font-semibold text-ink">Contato da prospecção</p>
      <p className="mt-0.5 text-[13px] text-ink-2">{pending ? "Atribuído a você e ainda não prospectado." : "Aguardando retorno do cliente."}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {pending ? <Button size="sm" disabled={busy} onClick={() => list.handleProspectingAction(client, "prospect")}>Prospectar</Button> : null}
        {pending || awaitingReturn ? <Button size="sm" variant="secondary" disabled={busy} onClick={() => list.handleProspectingAction(client, "in_service")}>Em atendimento</Button> : null}
        {awaitingReturn ? <Button size="sm" variant="danger-ghost" disabled={busy} onClick={() => list.handleProspectingAction(client, "do_not_contact")}>Não contactar novamente</Button> : null}
        {canReturn ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => list.handleProspectingAction(client, "return_to_queue")}>Devolver à fila</Button> : null}
      </div>
    </div>
  );
}

const EMPTY_DRAFT = { date: "", time: "", type: "follow_up", note: "" };

function AgendaPanel({ client, activities, busy, list, autoStart = false }) {
  const [mode, setMode] = useState(""); // "" | "main" | "extra"
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [error, setError] = useState("");
  const [showAll, setShowAll] = useState(false);
  const pending = activities.filter((activity) => activity.status === "pending")
    .sort((a, b) => new Date(a.scheduledActivityAt) - new Date(b.scheduledActivityAt));
  const now = Date.now();
  const visible = showAll ? pending : pending.slice(0, 3);
  const mainAt = client.scheduledActivityAt;
  const mainOverdue = mainAt && new Date(mainAt).getTime() < now;

  useEffect(() => {
    setError("");
    if (autoStart) start(client.scheduledActivityAt ? "extra" : "main");
    else setMode("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client.id, autoStart]);

  function start(nextMode) {
    setError("");
    setDraft(nextMode === "main" ? getScheduleDraft({ ...client.registration, scheduledActivityAt: mainAt, scheduledActivityNote: client.scheduledActivityNote || client.registration?.scheduledActivityNote }) : EMPTY_DRAFT);
    setMode(nextMode);
  }

  async function save() {
    const result = mode === "main" ? await list.saveClientSchedule(client, draft) : await list.createClientActivity(client, draft);
    if (result?.error) setError(result.error);
    else setMode("");
  }

  return (
    <div className="space-y-3">
      {/* Agendamento principal (campo único do cadastro) */}
      {mainAt ? (
        <div className={cx("flex items-start gap-3 rounded-control border px-3 py-2.5", mainOverdue ? "border-danger-line bg-danger-soft" : "border-line")}>
          <Clock className={cx("mt-0.5 h-4 w-4 shrink-0", mainOverdue ? "text-danger" : "text-brand")} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className={cx("text-sm font-semibold tabular-nums", mainOverdue ? "text-danger" : "text-ink")}>{mainOverdue ? "Atrasada · " : ""}{formatFullDateTime(mainAt)}</p>
            {client.scheduledActivityNote ? <p className="text-[13px] text-ink-2">{client.scheduledActivityNote}</p> : null}
          </div>
          <div className="flex shrink-0 gap-1">
            <IconAction label="Concluir agendamento" disabled={busy} onClick={() => list.completeClientSchedule(client)}><Check className="h-4 w-4" /></IconAction>
            <IconAction label="Editar agendamento" disabled={busy} onClick={() => start("main")}><Pencil className="h-4 w-4" /></IconAction>
            <IconAction label="Remover agendamento" tone="danger" disabled={busy} onClick={() => list.clearClientSchedule(client)}><X className="h-4 w-4" /></IconAction>
          </div>
        </div>
      ) : null}

      {/* Atividades extras */}
      {visible.length ? (
        <ul className="space-y-2">
          {visible.map((activity) => {
            const overdue = new Date(activity.scheduledActivityAt).getTime() < now;
            return (
              <li key={activity.id} className={cx("flex items-start gap-3 rounded-control border px-3 py-2.5", overdue ? "border-danger-line bg-danger-soft" : "border-line")}>
                <CalendarPlus className={cx("mt-0.5 h-4 w-4 shrink-0", overdue ? "text-danger" : "text-brand")} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className={cx("text-sm font-semibold tabular-nums", overdue ? "text-danger" : "text-ink")}>{overdue ? "Atrasada · " : ""}{formatWhen(activity.scheduledActivityAt)}</p>
                  <p className="text-[13px] text-ink-2">{activity.note || activity.title}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <IconAction label="Concluir atividade" disabled={busy} onClick={() => list.completeClientActivity(client, activity.id)}><Check className="h-4 w-4" /></IconAction>
                  <IconAction label="Cancelar atividade" tone="danger" disabled={busy} onClick={() => list.cancelClientActivity(client, activity.id)}><X className="h-4 w-4" /></IconAction>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      {pending.length > 3 ? (
        <button type="button" className="text-[13px] font-semibold text-brand hover:underline" onClick={() => setShowAll((value) => !value)}>
          {showAll ? "Ver menos" : `Ver todas (${pending.length})`}
        </button>
      ) : null}

      {!mainAt && !pending.length && !mode ? (
        <p className="text-sm text-ink-2">Nenhuma atividade agendada. Marque o próximo passo para não perder o cliente de vista.</p>
      ) : null}

      {mode ? (
        <ActivityForm draft={draft} setDraft={setDraft} busy={busy} error={error} title={mode === "main" ? (mainAt ? "Editar agendamento" : "Agendar") : "Nova atividade"} onCancel={() => setMode("")} onSave={save} />
      ) : (
        <div className="flex flex-wrap gap-2">
          {!mainAt ? <Button size="sm" variant="secondary" disabled={busy} onClick={() => start("main")}><CalendarPlus className="h-4 w-4" aria-hidden="true" /> Agendar</Button> : null}
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => start("extra")}><Plus className="h-4 w-4" aria-hidden="true" /> {mainAt || pending.length ? "Outra atividade" : "Atividade extra"}</Button>
        </div>
      )}
    </div>
  );
}

function ActivityForm({ draft, setDraft, busy, error, title, onCancel, onSave }) {
  const ids = { date: useId(), time: useId(), type: useId(), note: useId() };
  const set = (field) => (event) => setDraft((current) => ({ ...current, [field]: event.target.value }));
  return (
    <form
      className="space-y-3 rounded-card border border-line bg-mist/60 p-3"
      onSubmit={(event) => { event.preventDefault(); onSave(); }}
    >
      <p className="text-sm font-semibold text-ink">{title}</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={ids.date} className="text-xs font-medium text-muted">Dia</label>
          <input id={ids.date} type="date" className={cx(inputClasses, "mt-1")} value={draft.date} onChange={set("date")} disabled={busy} />
        </div>
        <div>
          <label htmlFor={ids.time} className="text-xs font-medium text-muted">Horário</label>
          <input id={ids.time} type="time" className={cx(inputClasses, "mt-1")} value={draft.time} onChange={set("time")} disabled={busy} />
        </div>
      </div>
      <div>
        <label htmlFor={ids.type} className="text-xs font-medium text-muted">Tipo</label>
        <select id={ids.type} className={cx(inputClasses, "mt-1")} value={draft.type || "follow_up"} onChange={set("type")} disabled={busy}>
          {ACTIVITY_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor={ids.note} className="text-xs font-medium text-muted">O que será feito?</label>
        <textarea id={ids.note} rows={2} maxLength={240} className={cx(inputClasses, "mt-1 py-2")} placeholder="Ex.: cobrar documentação, retornar ligação…" value={draft.note} onChange={set("note")} disabled={busy} />
      </div>
      {error ? <p role="alert" className="text-[13px] font-medium text-danger">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={busy}>Salvar</Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>Cancelar</Button>
      </div>
    </form>
  );
}

function IconAction({ label, onClick, disabled, tone, children }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "inline-flex h-9 w-9 items-center justify-center rounded-control border border-line bg-white transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50",
        tone === "danger" ? "text-danger hover:bg-danger-soft" : "text-ink-2 hover:bg-navy/[0.05]"
      )}
    >
      {children}
    </button>
  );
}

function SimulationSummary({ client }) {
  if (client.completed && client.summary) {
    return (
      <div>
        <p className="text-xs font-medium text-muted">Poder total de compra</p>
        <p className="mt-0.5 text-[28px] font-bold leading-9 tracking-[-0.015em] text-navy tabular-nums">{formatMoneyBR(client.summary.purchasePower)}</p>
        {client.summary.components?.length ? <p className="mt-1 text-[13px] text-ink-2 tabular-nums">{client.summary.components.join(" · ")}</p> : null}
      </div>
    );
  }
  const registration = client.registration;
  const awaiting = client.status === CLIENT_STATUS.PENDING;
  const filled = registration && hasSimulationData(registration);
  const lines = filled ? [
    Number(registration.primaryMonthlyIncome) > 0 ? `Renda ${formatCurrency(registration.primaryMonthlyIncome)}` : "",
    registration.primaryIncomeType ? incomeTypeLabel(registration.primaryIncomeType) : "",
    Number(registration.availablePurchaseResource) > 0 ? `Recurso próprio ${formatCurrency(registration.availablePurchaseResource)}` : ""
  ].filter(Boolean) : [];
  return (
    <div>
      <p className={cx("text-sm font-semibold", awaiting ? "text-warning" : "text-ink-2")}>{awaiting ? "Cliente aguardando simulação" : "Simulação ainda não realizada"}</p>
      {lines.length ? <p className="mt-1 text-[13px] text-ink-2">{lines.join(" · ")}</p> : null}
    </div>
  );
}

function TagsPanel({ client, tags, busy, list, autoEdit = false }) {
  const [editing, setEditing] = useState(autoEdit);
  useEffect(() => { if (autoEdit) setEditing(true); }, [autoEdit, client.id]);
  const [name, setName] = useState("");
  const [color, setColor] = useState(TAG_COLORS[0].value);
  const currentIds = tags.map((tag) => tag.id);
  const nameId = useId();

  function toggle(tagId) {
    const next = currentIds.includes(tagId) ? currentIds.filter((id) => id !== tagId) : [...currentIds, tagId];
    list.saveClientTags(client, next);
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((tag) => <TagChip key={tag.id} tag={tag} />)}
        {!tags.length && !editing ? <p className="text-sm text-ink-2">Sem tags.</p> : null}
        <Button size="sm" variant="ghost" onClick={() => setEditing((value) => !value)} aria-expanded={editing}>
          {editing ? "Fechar" : <><Plus className="h-4 w-4" aria-hidden="true" /> Editar tags</>}
        </Button>
      </div>
      {editing ? (
        <div className="mt-3 space-y-3 rounded-card border border-line bg-mist/60 p-3">
          {list.localTags.length ? (
            <ul className="flex flex-wrap gap-1.5" aria-label="Tags disponíveis">
              {list.localTags.map((tag) => {
                const active = currentIds.includes(tag.id);
                return (
                  <li key={tag.id} className="inline-flex overflow-hidden rounded-full border border-line bg-white">
                    <button
                      type="button"
                      aria-pressed={active}
                      disabled={busy}
                      onClick={() => toggle(tag.id)}
                      className={cx("inline-flex h-9 items-center gap-1.5 px-3 text-[13px] font-medium transition-colors", active ? "text-white" : "text-ink hover:bg-navy/[0.04]")}
                      style={active ? { backgroundColor: tag.color } : undefined}
                    >
                      {active ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tag.color }} aria-hidden="true" />}
                      {tag.name}
                    </button>
                    <button
                      type="button"
                      aria-label={`Excluir a tag ${tag.name} do sistema`}
                      title="Excluir do sistema"
                      onClick={() => list.deleteTagFromSystem(tag)}
                      className="inline-flex h-9 w-8 items-center justify-center border-l border-line text-muted hover:bg-danger-soft hover:text-danger"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : <p className="text-sm text-ink-2">Nenhuma tag criada ainda.</p>}
          <form
            className="space-y-2"
            onSubmit={async (event) => {
              event.preventDefault();
              if (await list.createTagForClient(client, name, color)) setName("");
            }}
          >
            <label htmlFor={nameId} className="text-xs font-medium text-muted">Nova tag</label>
            <div className="flex gap-2">
              <input id={nameId} className={inputClasses} placeholder="Ex.: Indicação" value={name} onChange={(event) => setName(event.target.value)} />
              <Button type="submit" variant="secondary" disabled={!name.trim() || busy}>Criar</Button>
            </div>
            <div role="radiogroup" aria-label="Cor da nova tag" className="flex flex-wrap gap-1.5">
              {TAG_COLORS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={color === option.value}
                  aria-label={option.label}
                  title={option.label}
                  onClick={() => setColor(option.value)}
                  className={cx("inline-flex h-8 w-8 items-center justify-center rounded-control border", color === option.value ? "border-navy" : "border-transparent")}
                >
                  <span className="h-5 w-5 rounded-full" style={{ backgroundColor: option.value }} />
                </button>
              ))}
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function TagChip({ tag }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-2.5 py-1 text-[13px] font-medium text-ink">
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tag.color || "#0D4F8B" }} aria-hidden="true" />
      {tag.name}
    </span>
  );
}

function RegistrationDetails({ client }) {
  const registration = client.registration;
  if (!registration) return <p className="text-sm text-ink-2">Cadastro completo ainda não localizado para este cliente.</p>;
  const filled = hasSimulationData(registration);
  const preference = registration.contactPreference;
  const preferenceSummary = getPropertyPreferenceSummary(registration.propertyPreferences);
  const preferenceDetails = getPropertyPreferenceDetails(registration.propertyPreferences);

  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <Item label="Telefone" value={clientPhone(client)} />
        <Item label="Cadastrado em" value={formatDateTimeBR(registration.createdAt)} />
        <Item label="Último contato" value={client.lastWhatsappContactAt ? formatAgo(client.lastWhatsappContactAt) : "Nunca contatado"} />
        {registration.lastFormSubmittedAt ? <Item label="Novo formulário" value={formatAgo(registration.lastFormSubmittedAt)} highlight /> : null}
        {preference === "whatsapp" || preference === "call" ? (
          <Item label="Prefere contato" value={<span className="inline-flex items-center gap-1">{preference === "call" ? <Phone className="h-3.5 w-3.5 text-brand" aria-hidden="true" /> : <MessageCircle className="h-3.5 w-3.5 text-brand" aria-hidden="true" />}{preference === "call" ? "Ligação" : "WhatsApp"}</span>} />
        ) : null}
        <Item label="Simulação vinculada" value={client.simulation?.id ? "Sim" : "Não"} />
        {filled ? (
          <>
            <Item label="Tipo de simulação" value={simulationTypeLabel(registration.simulationType)} />
            <Item label="Nascimento" value={realBirthDate(registration.oldestBirthDate) ? formatDateBR(registration.oldestBirthDate) : ""} />
            <Item label="Renda familiar" value={formatCurrency(calculateFamilyIncome(registration))} />
            <Item label="Renda do titular" value={formatCurrency(registration.primaryMonthlyIncome)} />
            <Item label="Tipo de renda" value={incomeTypeLabel(registration.primaryIncomeType)} />
            <Item label="Estado civil" value={maritalStatusLabel(registration.primaryMaritalStatus)} />
            {registration.simulationType === "joint" ? (
              <>
                <Item label="Renda da 2ª pessoa" value={formatCurrency(registration.secondaryMonthlyIncome)} />
                <Item label="Tipo de renda da 2ª pessoa" value={incomeTypeLabel(registration.secondaryIncomeType)} />
                <Item label="Estado civil da 2ª pessoa" value={maritalStatusLabel(registration.secondaryMaritalStatus)} />
              </>
            ) : null}
            <Item label="+3 anos de registro" value={booleanLabel(registration.hasOverThreeYearsRegisteredWork)} />
            <Item label="Filhos menores de 18" value={booleanLabel(registration.hasChildrenUnder18)} />
            <Item label="Imóvel no nome" value={booleanLabel(registration.hasResidentialProperty)} />
            <Item label="Recurso próprio" value={formatCurrency(registration.availablePurchaseResource)} />
          </>
        ) : (
          <p className="col-span-2 rounded-control border border-dashed border-line px-3 py-2 text-[13px] text-ink-2">O cliente ainda não preencheu os dados da simulação.</p>
        )}
        <EditableItem label="E-mail" registrationId={registration.id} field="email" initialValue={registration.email} placeholder="cliente@exemplo.com" type="email" />
        <EditableItem label="PIS" registrationId={registration.id} field="pis" initialValue={registration.pis} placeholder="Número do PIS" />
      </dl>

      <div>
        <p className="text-xs font-medium text-muted">Preferências do imóvel</p>
        {preferenceDetails.length ? (
          <>
            {preferenceSummary ? <p className="mt-1 text-sm font-medium text-ink">{preferenceSummary}</p> : null}
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              {preferenceDetails.map((item) => <Item key={item.label} label={item.label} value={item.value} />)}
            </dl>
          </>
        ) : <p className="mt-1 text-sm text-ink-2">Preferências ainda não preenchidas.</p>}
      </div>
    </div>
  );
}

function Item({ label, value, highlight = false }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={cx("mt-0.5 break-words font-medium", highlight ? "text-brand" : "text-ink")}>{value || <span className="font-normal text-faint">Não informado</span>}</dd>
    </div>
  );
}

// E-mail e PIS não vêm de nenhum formulário público — o corretor preenche
// aqui para a documentação/CCA (mesma chamada do componente antigo).
function EditableItem({ label, registrationId, field, initialValue, placeholder, type = "text" }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialValue || "");
  const [saved, setSaved] = useState(initialValue || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef(null);
  const id = useId();

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  async function save() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/simulation-registrations/${registrationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error);
      setSaved(value);
      setEditing(false);
    } catch (saveError) {
      setError(saveError.message || "Não foi possível salvar.");
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <div className="col-span-2 sm:col-span-1">
        <label htmlFor={id} className="text-xs text-muted">{label}</label>
        <input
          ref={inputRef}
          id={id}
          type={type}
          className={cx(inputClasses, "mt-1")}
          value={value}
          placeholder={placeholder}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") save();
            if (event.key === "Escape") { event.stopPropagation(); setValue(saved); setEditing(false); }
          }}
        />
        {error ? <p role="alert" className="mt-1 text-xs font-medium text-danger">{error}</p> : null}
        <div className="mt-1.5 flex gap-2">
          <Button size="sm" onClick={save} loading={busy}>Salvar</Button>
          <Button size="sm" variant="ghost" onClick={() => { setValue(saved); setEditing(false); }}>Cancelar</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5">
        <button type="button" onClick={() => { setValue(saved); setEditing(true); }} className="group inline-flex max-w-full items-center gap-1.5 break-all text-left font-medium text-ink hover:text-brand">
          {saved || <span className="font-normal text-brand">Adicionar</span>}
          <Pencil className="h-3.5 w-3.5 shrink-0 text-faint group-hover:text-brand" aria-hidden="true" />
        </button>
      </dd>
    </div>
  );
}

// Motivo obrigatório para "Não contactar novamente": ação registrada e
// auditável no servidor (lib/daily-goal-wallet.js).
function DoNotContactDialog({ client, onCancel, onConfirm }) {
  const ref = useRef(null);
  const [reasonKey, setReasonKey] = useState("client_requested");
  const [reasonText, setReasonText] = useState("");
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (client && !dialog.open) {
      setReasonKey("client_requested");
      setReasonText("");
      dialog.showModal();
    }
    if (!client && dialog.open) dialog.close();
  }, [client]);

  const invalid = reasonKey === "other" && !reasonText.trim();

  return (
    <dialog ref={ref} aria-labelledby={titleId} className="ui-confirm" onCancel={(event) => { event.preventDefault(); onCancel(); }}>
      {client ? (
        <form className="p-5 sm:p-6" onSubmit={(event) => { event.preventDefault(); if (!invalid) onConfirm(reasonKey, reasonText.trim()); }}>
          <h2 id={titleId} className="text-base font-semibold text-ink">Não contactar novamente</h2>
          <p className="mt-1 text-sm text-ink-2">Escolha o motivo para {client.name || "este cliente"}. A ação fica registrada e auditável.</p>
          <fieldset className="mt-4 space-y-1">
            <legend className="sr-only">Motivo</legend>
            {DO_NOT_CONTACT_REASONS.map((option) => (
              <label key={option.key} className="flex min-h-touch cursor-pointer items-center gap-3 rounded-control px-2 text-sm text-ink hover:bg-navy/[0.03]">
                <input type="radio" name="dnc-reason" value={option.key} checked={reasonKey === option.key} onChange={() => setReasonKey(option.key)} className="h-4 w-4 accent-brand" />
                {option.label}
              </label>
            ))}
          </fieldset>
          {reasonKey === "other" ? (
            <textarea className={cx(inputClasses, "mt-2 py-2")} rows={3} placeholder="Descreva o motivo" value={reasonText} onChange={(event) => setReasonText(event.target.value)} aria-label="Descreva o motivo" />
          ) : null}
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={onCancel}>Cancelar</Button>
            <Button type="submit" variant="danger" disabled={invalid}>Confirmar</Button>
          </div>
        </form>
      ) : null}
    </dialog>
  );
}

function todayDateInputValue() {
  const now = new Date();
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(now)
      .map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// Data do recebimento ao marcar um cliente como "Pago" (fim do pipeline de
// venda) — pedido do dono, 2026-10-01: o recebimento automático
// (lib/financial.js) precisa contar no mês certo, que nem sempre é o dia em
// que alguém mexe no CRM (ex.: lançamento atrasado, cliente pagou num dia e
// o status só foi mudado depois). Mesmo padrão de DoNotContactDialog: só
// grava depois de confirmado; "target" é { client, nextStatus }.
function ReceivedDateDialog({ target, onCancel, onConfirm }) {
  const ref = useRef(null);
  const [receivedDate, setReceivedDate] = useState(todayDateInputValue());
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (target && !dialog.open) {
      setReceivedDate(todayDateInputValue());
      dialog.showModal();
    }
    if (!target && dialog.open) dialog.close();
  }, [target]);

  return (
    <dialog ref={ref} aria-labelledby={titleId} className="ui-confirm" onCancel={(event) => { event.preventDefault(); onCancel(); }}>
      {target ? (
        <form className="p-5 sm:p-6" onSubmit={(event) => { event.preventDefault(); if (receivedDate) onConfirm(receivedDate); }}>
          <h2 id={titleId} className="text-base font-semibold text-ink">Data do recebimento</h2>
          <p className="mt-1 text-sm text-ink-2">
            {target.client?.name || "Este cliente"} vai para "Pago" — em que dia o pagamento foi recebido? Essa data é a que conta nos totais mensais do Financeiro.
          </p>
          <input
            type="date"
            className={cx(inputClasses, "mt-4")}
            value={receivedDate}
            onChange={(event) => setReceivedDate(event.target.value)}
            aria-label="Data do recebimento"
            required
          />
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={onCancel}>Cancelar</Button>
            <Button type="submit" disabled={!receivedDate}>Confirmar</Button>
          </div>
        </form>
      ) : null}
    </dialog>
  );
}

"use client";

import {
  Calculator,
  CalendarClock,
  CalendarPlus,
  Check,
  ChevronRight,
  ExternalLink,
  FileText,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Phone,
  Tag as TagIcon,
  Trash2,
  TriangleAlert,
  X
} from "lucide-react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Menu from "@/components/ui/Menu";
import StatusBadge from "@/components/ui/StatusBadge";
import { cx } from "@/components/ui/cx";
import { CLIENT_STATUS } from "@/lib/client-status";
import { hasSimulationData, incomeTypeLabel, formatCurrency } from "@/lib/simulation-registration-schema";
import { formatMoneyBR } from "@/lib/simulation-list-utils";
import { clientPhone, formatAgo, formatWhen, getUrgencySignal, initialsOf } from "./client-format";

// Card de cliente (proposta híbrida 2026-10): o conceito do card antigo —
// ver o cliente inteiro sem abrir nada — com a hierarquia e os componentes
// da Fundação. Mostra direto: etapa, urgência, responsável, próximas
// atividades (concluir/cancelar ali mesmo), poder de compra ou situação da
// simulação, contato, novo formulário, tags e as ações do dia a dia. A ficha
// continua para o secundário (cadastro completo, CCA, aviso de progresso,
// histórico, mudança de etapa).
const MAX_ACTIVITIES = 2;
const MAX_TAGS = 4;

export default function ClientCard({ client, activities, responsibleName, showResponsible, busy, selected, isOwner, canReturnAssignedProspecting, list, onOpen }) {
  const name = client.name || "Cliente sem nome";
  const registration = client.registration || {};
  const urgency = getUrgencySignal(client, activities);
  const tags = Array.isArray(client.tags) ? client.tags : [];
  const agenda = buildAgenda(client, activities);
  const lastContact = client.lastWhatsappContactAt ? formatAgo(client.lastWhatsappContactAt) : "";

  return (
    <article
      aria-labelledby={`card-${client.id}`}
      className={cx(
        "flex min-w-0 flex-col rounded-card border bg-white transition-[border-color,box-shadow] duration-150",
        selected ? "border-brand ring-1 ring-brand" : "border-line hover:border-navy/20",
        urgency?.key === "overdue" && !selected && "border-l-[3px] border-l-danger-strong",
        busy && "opacity-60"
      )}
      aria-busy={busy || undefined}
    >
      {/* Cabeçalho: quem é e em que pé está */}
      <header className="flex items-start gap-3 px-4 pt-4">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-navy/[0.06] text-[13px] font-semibold text-navy" aria-hidden="true">
          {initialsOf(name)}
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={`card-${client.id}`} className="flex min-w-0 items-baseline gap-2">
            <button type="button" onClick={() => onOpen()} className="truncate text-left text-base font-semibold text-ink hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1">
              {name}
            </button>
            {registration.clientCode ? <span className="hidden shrink-0 text-xs text-muted sm:inline">{registration.clientCode}</span> : null}
          </h2>
          <p className="mt-0.5 flex min-w-0 items-center gap-x-1.5 truncate text-xs text-muted">
            <span className="shrink-0 tabular-nums">{clientPhone(client) || "Sem telefone"}</span>
            {registration.clientCode ? <span className="shrink-0 sm:hidden">· {registration.clientCode}</span> : null}
            {showResponsible ? <><span aria-hidden="true">·</span><span className="truncate">Resp.: <span className="text-ink-2">{responsibleName}</span></span></> : null}
          </p>
        </div>
        <Button
          variant="secondary"
          size="icon"
          onClick={() => onOpen()}
          aria-label={`Abrir ficha de ${name}`}
          title="Abrir ficha"
          className="-mr-1 -mt-1 border-transparent"
        >
          <ChevronRight className="h-5 w-5" aria-hidden="true" />
        </Button>
      </header>

      <div className="flex flex-wrap items-center gap-1.5 px-4 pt-2.5">
        <StatusBadge status={client.status} />
        {urgency ? <Badge tone={urgency.tone} icon={TriangleAlert}>{urgency.label}</Badge> : null}
        {registration.lastFormSubmittedAt ? <Badge tone="info">Novo formulário {formatAgo(registration.lastFormSubmittedAt)}</Badge> : null}
      </div>

      {/* Corpo: agenda, simulação e contato */}
      <div className="mt-3 space-y-3 px-4">
        <AgendaBlock client={client} agenda={agenda} busy={busy} list={list} onOpen={onOpen} />
        <SimulationLine client={client} />
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px] text-ink-2">
          <span>Último contato <span className={lastContact ? "font-medium text-ink" : "font-medium text-warning"}>{lastContact || "nunca"}</span></span>
          <span aria-hidden="true" className="text-faint">·</span>
          <span>Cadastro {formatAgo(registration.createdAt) || "sem data"}</span>
          {registration.contactPreference === "call" || registration.contactPreference === "whatsapp" ? (
            <>
              <span aria-hidden="true" className="text-faint">·</span>
              <span className="inline-flex items-center gap-1">
                {registration.contactPreference === "call" ? <Phone className="h-3.5 w-3.5 text-brand" aria-hidden="true" /> : <MessageCircle className="h-3.5 w-3.5 text-brand" aria-hidden="true" />}
                prefere {registration.contactPreference === "call" ? "ligação" : "WhatsApp"}
              </span>
            </>
          ) : null}
        </p>
        <TagsLine tags={tags} onEdit={() => onOpen("tags")} />
      </div>

      <ProspectingStrip client={client} busy={busy} list={list} canReturnAssignedProspecting={canReturnAssignedProspecting} />
      <div className="h-4 shrink-0" aria-hidden="true" />

      {/* Ações do dia a dia */}
      <footer className="mt-auto flex items-center gap-2 border-t border-line px-4 py-3">
        <Button className="flex-1 sm:flex-none" onClick={() => list.openWhatsApp(client)} disabled={busy}>
          <MessageCircle className="h-4 w-4" aria-hidden="true" /> WhatsApp
        </Button>
        <Button variant="secondary" onClick={() => onOpen("agenda")} disabled={busy}>
          <CalendarPlus className="h-4 w-4" aria-hidden="true" /> Agendar
        </Button>
        <Menu
          label={`Mais ações para ${name}`}
          trigger={<MoreHorizontal className="h-5 w-5" aria-hidden="true" />}
          className="ml-auto"
          items={[
            { label: "Documentação", icon: FileText, onSelect: () => onOpen("documents"), hidden: !registration.id },
            { label: "Empreendimentos", icon: ExternalLink, onSelect: () => list.openSimulation(client) },
            { label: "Valores", icon: Calculator, onSelect: () => list.openValues(client) },
            { label: "Ficha completa", icon: ChevronRight, onSelect: () => onOpen() },
            { label: "Excluir cliente", icon: Trash2, tone: "danger", separatorBefore: true, hidden: !isOwner, onSelect: () => list.removeClient(client) }
          ]}
        />
      </footer>
    </article>
  );
}

// Agendamento principal + atividades extras pendentes, em ordem de data
// (atrasadas primeiro), com as mesmas ações do card antigo.
function buildAgenda(client, activities) {
  const items = [];
  if (client.scheduledActivityAt) {
    items.push({ key: "main", at: client.scheduledActivityAt, note: client.scheduledActivityNote || "", main: true });
  }
  for (const activity of activities) {
    if (activity.status !== "pending") continue;
    items.push({ key: activity.id, id: activity.id, at: activity.scheduledActivityAt, note: activity.note || activity.title || "", main: false });
  }
  const now = Date.now();
  return items
    .map((item) => ({ ...item, time: new Date(item.at || "").getTime() }))
    .filter((item) => Number.isFinite(item.time))
    .sort((a, b) => a.time - b.time)
    .map((item) => ({ ...item, overdue: item.time < now }));
}

function AgendaBlock({ client, agenda, busy, list, onOpen }) {
  if (!agenda.length) {
    return (
      <p className="flex items-center gap-2 text-[13px] text-ink-2">
        <CalendarPlus className="h-4 w-4 shrink-0 text-faint" aria-hidden="true" />
        Nenhuma atividade agendada
      </p>
    );
  }
  const visible = agenda.slice(0, MAX_ACTIVITIES);
  const hidden = agenda.length - visible.length;
  return (
    <ul className="space-y-1.5" aria-label="Próximas atividades">
      {visible.map((item) => (
        <li key={item.key} className={cx("flex items-center gap-2.5 rounded-control px-3 py-2", item.overdue ? "bg-danger-soft" : "bg-mist")}>
          <CalendarClock className={cx("h-4 w-4 shrink-0", item.overdue ? "text-danger" : "text-brand")} aria-hidden="true" />
          <p className="min-w-0 flex-1 text-[13px] leading-5">
            <span className={cx("font-semibold tabular-nums", item.overdue ? "text-danger" : "text-ink")}>{item.overdue ? "Atrasada · " : ""}{formatWhen(item.at)}</span>
            {item.note ? <span className="block truncate text-ink-2 sm:inline sm:before:content-['_·_']">{item.note}</span> : null}
          </p>
          {item.main ? (
            <SmallAction label="Editar agendamento" onClick={() => onOpen("agenda")} disabled={busy}><Pencil className="h-3.5 w-3.5" /></SmallAction>
          ) : (
            <>
              <SmallAction label="Concluir atividade" onClick={() => list.completeClientActivity(client, item.id)} disabled={busy}><Check className="h-4 w-4" /></SmallAction>
              <SmallAction label="Cancelar atividade" tone="danger" onClick={() => list.cancelClientActivity(client, item.id)} disabled={busy}><X className="h-4 w-4" /></SmallAction>
            </>
          )}
        </li>
      ))}
      {hidden > 0 ? (
        <li>
          <button type="button" onClick={() => onOpen("agenda")} className="px-1 text-[13px] font-semibold text-brand hover:underline">+{hidden} {hidden === 1 ? "atividade" : "atividades"}</button>
        </li>
      ) : null}
    </ul>
  );
}

function SmallAction({ label, onClick, disabled, tone, children }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-chip transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50",
        tone === "danger" ? "text-danger hover:bg-white" : "text-ink-2 hover:bg-white hover:text-ink"
      )}
    >
      {children}
    </button>
  );
}

function SimulationLine({ client }) {
  if (client.completed && client.summary) {
    return (
      <div className="min-w-0">
        <p className="text-[13px] text-ink-2">
          Poder de compra <span className="ml-1 text-lg font-bold tracking-[-0.01em] text-navy tabular-nums">{formatMoneyBR(client.summary.purchasePower)}</span>
        </p>
        {client.summary.components?.length ? <p className="truncate text-xs text-muted tabular-nums" title={client.summary.components.join(" · ")}>{client.summary.components.join(" · ")}</p> : null}
      </div>
    );
  }
  const registration = client.registration;
  const awaiting = client.status === CLIENT_STATUS.PENDING;
  const filled = registration && hasSimulationData(registration);
  const details = filled ? [
    Number(registration.primaryMonthlyIncome) > 0 ? `Renda ${formatCurrency(registration.primaryMonthlyIncome)}` : "",
    registration.primaryIncomeType ? incomeTypeLabel(registration.primaryIncomeType) : "",
    Number(registration.availablePurchaseResource) > 0 ? `Recurso ${formatCurrency(registration.availablePurchaseResource)}` : ""
  ].filter(Boolean) : [];
  return (
    <div className="min-w-0">
      <p className={cx("text-[13px] font-medium", awaiting ? "text-warning" : "text-ink-2")}>{awaiting ? "Simulação a fazer" : "Simulação ainda não realizada"}</p>
      {details.length ? <p className="truncate text-xs text-muted">{details.join(" · ")}</p> : null}
    </div>
  );
}

function TagsLine({ tags, onEdit }) {
  const visible = tags.slice(0, MAX_TAGS);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {visible.map((tag) => (
        <span key={tag.id} className="inline-flex max-w-[11rem] items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-xs font-medium text-ink">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: tag.color || "#0D4F8B" }} aria-hidden="true" />
          <span className="truncate">{tag.name}</span>
        </span>
      ))}
      {tags.length > MAX_TAGS ? <span className="text-xs font-medium text-muted">+{tags.length - MAX_TAGS}</span> : null}
      <button type="button" onClick={onEdit} className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-xs font-semibold text-brand hover:bg-info-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
        <TagIcon className="h-3.5 w-3.5" aria-hidden="true" /> {tags.length ? "Tags" : "Adicionar tag"}
      </button>
    </div>
  );
}

// Mesmas condições e ações do card antigo para contatos vindos da prospecção.
function ProspectingStrip({ client, busy, list, canReturnAssignedProspecting }) {
  const registration = client.registration;
  if (!registration?.prospectingContactId) return null;
  const pending = registration.prospectingAssignedPending;
  const awaitingReturn = client.status === CLIENT_STATUS.AWAITING_RETURN;
  const canReturn = canReturnAssignedProspecting && registration.prospectingAssignedByUserId;
  if (!pending && !awaitingReturn && !(client.status === CLIENT_STATUS.IN_SERVICE && canReturn)) return null;
  return (
    <div className="mx-4 mt-3 flex flex-wrap items-center gap-2 rounded-control bg-info-soft px-3 py-2">
      <span className="mr-auto text-xs font-semibold text-info">Prospecção</span>
      {pending ? <Button size="sm" disabled={busy} onClick={() => list.handleProspectingAction(client, "prospect")}>Prospectar</Button> : null}
      {pending || awaitingReturn ? <Button size="sm" variant="secondary" disabled={busy} onClick={() => list.handleProspectingAction(client, "in_service")}>Em atendimento</Button> : null}
      {awaitingReturn ? <Button size="sm" variant="danger-ghost" disabled={busy} onClick={() => list.handleProspectingAction(client, "do_not_contact")}>Não contactar</Button> : null}
      {canReturn ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => list.handleProspectingAction(client, "return_to_queue")}>Devolver à fila</Button> : null}
    </div>
  );
}
